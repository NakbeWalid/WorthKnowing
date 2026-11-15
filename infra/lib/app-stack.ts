import { CfnOutput, Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secrets from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { MiroirDataStack } from './data-stack';

const BANK_PORT = 3001;
/** Port de l'ALB réservé à la plateforme de courtage (le port 80 sert Miroir). */
const BANK_ALB_PORT = 8080;

export interface MiroirAppProps extends StackProps {
  data: MiroirDataStack;
  repository: ecr.IRepository;
  imageTag: string;
  bedrockModelId: string;
}

/**
 * Deux applications, une seule tâche ECS Fargate à deux conteneurs (même image, commandes différentes) :
 *   miroir  :3000  ← ALB:80   ← CloudFront « Miroir »   (service de profil)
 *   bank    :3001  ← ALB:8080 ← CloudFront « Boréal »   (plateforme de courtage fictive)
 * La plateforme appelle l'API partenaire de Miroir par http://localhost:3000 (les conteneurs d'une tâche
 * partagent la même interface réseau) : ce trafic ne sort jamais de la tâche.
 * ⚠ Topologie à deux conteneurs écrite sans accès à AWS : validée par `cdk synth` seulement (KIRO_HANDOFF, H1–H4).
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

    // Secrets partagés entre les deux applications, générés ici, jamais dans le dépôt.
    const secret = (id: string, name: string) => new secrets.Secret(this, id, {
      secretName: name, generateSecretString: { passwordLength: 40, excludePunctuation: true },
    });
    const linkSecret = secret('LinkSecret', 'miroir/link-secret');           // signe codes de liaison et codes persona
    const partnerKey = secret('PartnerApiKey', 'miroir/partner-api-key');   // clé d'API de la plateforme chez Miroir
    const bankJwtSecret = secret('BankJwtSecret', 'boreal/jwt-secret');     // sessions de la plateforme

    const logging = (prefix: string) => ecs.LogDrivers.awsLogs({ streamPrefix: prefix, logRetention: logs.RetentionDays.ONE_MONTH });
    const image = ecs.ContainerImage.fromEcrRepository(props.repository, props.imageTag);

    const service = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'Service', {
      cluster,
      desiredCount: 1,
      minHealthyPercent: 100, // la nouvelle tâche démarre avant l'arrêt de l'ancienne
      cpu: 512,
      memoryLimitMiB: 2048, // deux processus Node, chacun avec les cours en mémoire
      assignPublicIp: true,
      taskSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      openListener: false,
      publicLoadBalancer: true,
      circuitBreaker: { rollback: true },
      healthCheckGracePeriod: Duration.seconds(60),
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.X86_64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
      taskImageOptions: {
        image,
        containerName: 'miroir',
        containerPort: 3000,
        logDriver: logging('miroir'),
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
        secrets: {
          ADMIN_PASSWORD: ecs.Secret.fromSecretsManager(adminPassword),
          LINK_SECRET: ecs.Secret.fromSecretsManager(linkSecret),
          PARTNER_API_KEY: ecs.Secret.fromSecretsManager(partnerKey),
        },
      },
    });
    service.targetGroup.configureHealthCheck({ path: '/api/health', healthyHttpCodes: '200' });
    service.targetGroup.setAttribute('deregistration_delay.timeout_seconds', '15');
    service.loadBalancer.setAttribute('idle_timeout.timeout_seconds', '120');

    // L'ALB n'accepte que CloudFront.
    const cloudfrontPrefixList = ec2.PrefixList.fromLookup(this, 'CloudFrontPrefixList', {
      prefixListName: 'com.amazonaws.global.cloudfront.origin-facing',
    });
    const fromCloudFront = ec2.Peer.prefixList(cloudfrontPrefixList.prefixListId);
    service.loadBalancer.connections.allowFrom(fromCloudFront, ec2.Port.tcp(80), 'CloudFront vers Miroir');
    service.loadBalancer.connections.allowFrom(fromCloudFront, ec2.Port.tcp(BANK_ALB_PORT), 'CloudFront vers Boreal');

    // --- Second conteneur : la plateforme de courtage (même image, autre commande) ----------
    const bank = service.taskDefinition.addContainer('bank', {
      image,
      command: ['node', 'dist/bank/main.js'],
      portMappings: [{ containerPort: BANK_PORT }],
      logging: logging('boreal'),
      environment: {
        AWS_REGION: this.region,
        BANK_PORT: String(BANK_PORT),
        BANK_STORAGE_DRIVER: 'dynamodb',
        DATA_BUCKET: data.bucket.bucketName,
        MIROIR_API_URL: 'http://localhost:3000', // même tâche : aucun passage par Internet
      },
      secrets: {
        BANK_JWT_SECRET: ecs.Secret.fromSecretsManager(bankJwtSecret),
        PARTNER_API_KEY: ecs.Secret.fromSecretsManager(partnerKey),
      },
    });
    const bankListener = service.loadBalancer.addListener('BankListener', {
      port: BANK_ALB_PORT, protocol: elbv2.ApplicationProtocol.HTTP, open: false,
    });
    bankListener.addTargets('Bank', {
      port: BANK_PORT, protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [service.service.loadBalancerTarget({ containerName: 'bank', containerPort: BANK_PORT })],
      healthCheck: { path: '/api/health', healthyHttpCodes: '200' },
      deregistrationDelay: Duration.seconds(15),
    });

    // --- Droits de la tâche (moindre privilège) ---------------------------------------------
    const role = service.taskDefinition.taskRole;
    // Une seule tâche = un seul rôle pour les deux conteneurs. Deux services ECS distincts permettraient
    // de séparer les droits (la plateforme n'a besoin ni de Bedrock, ni de Cognito, ni des tables Miroir).
    for (const table of [...data.tables, ...data.bankTables]) table.grantReadWriteData(role);
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

    // --- CloudFront : une distribution HTTPS par application (certificat *.cloudfront.net), API jamais mise en cache ---
    const distribution = (id: string, comment: string, httpPort: number) => new cloudfront.Distribution(this, id, {
      comment,
      defaultBehavior: {
        origin: new origins.LoadBalancerV2Origin(service.loadBalancer, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY, httpPort,
          readTimeout: Duration.seconds(60),
          keepaliveTimeout: Duration.seconds(60),
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
      },
    });
    const miroirCdn = distribution('Cdn', 'Miroir', 80);
    const bankCdn = distribution('BankCdn', 'Boreal Courtage', BANK_ALB_PORT);
    const miroirUrl = `https://${miroirCdn.distributionDomainName}`;
    const bankUrl = `https://${bankCdn.distributionDomainName}`;

    // Chaque application doit connaître l'adresse publique de l'autre (redirections de la liaison).
    service.taskDefinition.defaultContainer!.addEnvironment('PARTNER_RETURN_ORIGINS', bankUrl);
    bank.addEnvironment('BANK_PUBLIC_URL', bankUrl);
    bank.addEnvironment('MIROIR_PUBLIC_URL', miroirUrl);

    new CfnOutput(this, 'Url', { value: miroirUrl, description: 'Miroir (service de profil)' });
    new CfnOutput(this, 'BankUrl', { value: bankUrl, description: 'Boreal Courtage (plateforme de courtage fictive)' });
    new CfnOutput(this, 'AdminPasswordSecret', { value: adminPassword.secretName });
  }
}
