import { CfnOutput, Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secrets from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { MiroirDataStack } from './data-stack';

export interface MiroirAppProps extends StackProps {
  data: MiroirDataStack;
  repository: ecr.IRepository;
  imageTag: string;
  bedrockModelId: string;
}

/**
 * Application : un seul conteneur NestJS sur ECS Fargate, derrière un ALB et CloudFront (HTTPS).
 *  - 1 tâche : le flux temps réel de la vue admin est en mémoire (EventsService) ; passer à plusieurs
 *    tâches demanderait EventBridge + AppSync Events (KIRO_HANDOFF §4.6, non retenu pour la démo).
 *  - Pas de NAT : sous-réseaux publics, mais la tâche n'accepte que le trafic de l'ALB,
 *    et l'ALB que celui de CloudFront (liste de préfixes gérée par AWS).
 *  - Rôle IAM au moindre privilège : modèle Bedrock précis, 3 tables, bucket (écriture : corpus seulement),
 *    actions Cognito d'administration sur ce User Pool uniquement.
 */
export class MiroirAppStack extends Stack {
  constructor(scope: Construct, id: string, props: MiroirAppProps) {
    super(scope, id, props);
    const { data } = props;

    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2, natGateways: 0,
      subnetConfiguration: [{ name: 'public', subnetType: ec2.SubnetType.PUBLIC }],
    });
    const cluster = new ecs.Cluster(this, 'Cluster', { vpc, containerInsightsV2: ecs.ContainerInsights.ENABLED });

    // Mot de passe admin généré et conservé dans Secrets Manager, jamais dans le dépôt.
    const adminPassword = new secrets.Secret(this, 'AdminPassword', {
      secretName: 'miroir/admin-password',
      generateSecretString: { passwordLength: 20, excludePunctuation: true, requireEachIncludedType: true },
    });

    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'Service', {
      cluster,
      desiredCount: 1,
      minHealthyPercent: 100, // la nouvelle tâche démarre avant l'arrêt de l'ancienne
      cpu: 512,
      memoryLimitMiB: 1024,
      assignPublicIp: true,
      taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      openListener: false,
      publicLoadBalancer: true,
      circuitBreaker: { rollback: true },
      healthCheckGracePeriod: Duration.seconds(60),
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.X86_64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
      taskImageOptions: {
        image: ecs.ContainerImage.fromEcrRepository(props.repository, props.imageTag),
        containerPort: 3000,
        logDriver: ecs.LogDrivers.awsLogs({ streamPrefix: 'miroir', logRetention: logs.RetentionDays.ONE_MONTH }),
        environment: {
          AWS_REGION: this.region,
          STORAGE_DRIVER: 'dynamodb',
          AUTH_DRIVER: 'cognito',
          NEWS_DRIVER: 'bedrock',
          EXPLAINER_DRIVER: 'bedrock',
          INFLUENCE_DRIVER: 'bedrock',
          BEDROCK_MODEL_ID: props.bedrockModelId,
          DATA_BUCKET: data.bucket.bucketName,
          COGNITO_USER_POOL_ID: data.userPool.userPoolId,
          COGNITO_CLIENT_ID: data.userPoolClient.userPoolClientId,
          ADMIN_EMAIL: 'admin@miroir.local',
        },
        secrets: { ADMIN_PASSWORD: ecs.Secret.fromSecretsManager(adminPassword) },
      },
    });
    service.targetGroup.configureHealthCheck({ path: '/', healthyHttpCodes: '200' });
    service.targetGroup.setAttribute('deregistration_delay.timeout_seconds', '15');
    service.loadBalancer.setAttribute('idle_timeout.timeout_seconds', '120');

    // L'ALB n'accepte que CloudFront.
    const cloudfrontPrefixList = ec2.PrefixList.fromLookup(this, 'CloudFrontPrefixList', {
      prefixListName: 'com.amazonaws.global.cloudfront.origin-facing',
    });
    service.loadBalancer.connections.allowFrom(ec2.Peer.prefixList(cloudfrontPrefixList.prefixListId), ec2.Port.tcp(80), 'CloudFront');

    // --- Droits de la tâche (moindre privilège) ---------------------------------------------
    const role = service.taskDefinition.taskRole;
    for (const table of data.tables) table.grantReadWriteData(role);
    data.bucket.grantRead(role);
    data.bucket.grantPut(role, 'data/news/*');
    const modelName = props.bedrockModelId.replace(/^(us|global)\./, '');
    role.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${props.bedrockModelId}`,
        // Le profil « us. » route vers us-east-1, us-east-2 ou us-west-2.
        `arn:aws:bedrock:*::foundation-model/${modelName}`,
      ],
    }));
    role.addToPrincipalPolicy(new iam.PolicyStatement({
      actions: [
        'cognito-idp:AdminGetUser', 'cognito-idp:AdminCreateUser', 'cognito-idp:AdminSetUserPassword',
        'cognito-idp:AdminAddUserToGroup', 'cognito-idp:AdminConfirmSignUp', 'cognito-idp:AdminInitiateAuth',
      ],
      resources: [data.userPool.userPoolArn],
    }));

    // --- CloudFront : HTTPS public (certificat *.cloudfront.net), aucune mise en cache de l'API ---
    const distribution = new cloudfront.Distribution(this, 'Cdn', {
      comment: 'Miroir',
      defaultBehavior: {
        origin: new origins.LoadBalancerV2Origin(service.loadBalancer, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          readTimeout: Duration.seconds(60),
          keepaliveTimeout: Duration.seconds(60),
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
      },
    });

    new CfnOutput(this, 'Url', { value: `https://${distribution.distributionDomainName}` });
    new CfnOutput(this, 'AdminPasswordSecret', { value: adminPassword.secretName });
  }
}
