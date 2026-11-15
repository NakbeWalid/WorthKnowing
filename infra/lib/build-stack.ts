import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { Asset } from 'aws-cdk-lib/aws-s3-assets';
import { Construct } from 'constructs';
import { join } from 'path';

/**
 * Construction de l'image du conteneur dans AWS (aucun Docker requis sur le poste) :
 * le code source est envoyé dans S3 par CDK, CodeBuild construit l'image et la pousse dans ECR.
 * Lancement : infra/deploy.sh (start-build avec IMAGE_TAG = commit git).
 */
export class MiroirBuildStack extends Stack {
  readonly repository: ecr.Repository;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.repository = new ecr.Repository(this, 'Repository', {
      repositoryName: 'miroir',
      imageScanOnPush: true,
      removalPolicy: RemovalPolicy.DESTROY,
      emptyOnDelete: true,
      lifecycleRules: [{ maxImageCount: 10 }],
    });

    const source = new Asset(this, 'Source', {
      path: join(__dirname, '..', '..'),
      exclude: ['node_modules', '**/node_modules', 'dist', '.git', 'infra/cdk.out', 'data/db.json', 'data/bank-db.json', '.env'],
    });

    const project = new codebuild.Project(this, 'ImageBuild', {
      projectName: 'miroir-image',
      source: codebuild.Source.s3({ bucket: source.bucket, path: source.s3ObjectKey }),
      environment: { buildImage: codebuild.LinuxBuildImage.STANDARD_7_0, privileged: true },
      timeout: Duration.minutes(20),
      environmentVariables: { REPOSITORY_URI: { value: this.repository.repositoryUri } },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          pre_build: { commands: [
            'aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin ${REPOSITORY_URI%%/*}',
            'export IMAGE_TAG=${IMAGE_TAG:-latest}',
          ] },
          build: { commands: ['docker build -t $REPOSITORY_URI:$IMAGE_TAG .'] },
          post_build: { commands: ['docker push $REPOSITORY_URI:$IMAGE_TAG'] },
        },
      }),
    });
    source.grantRead(project);
    this.repository.grantPullPush(project);

    new CfnOutput(this, 'BuildProject', { value: project.projectName });
    new CfnOutput(this, 'SourceKey', { value: `s3://${source.s3BucketName}/${source.s3ObjectKey}` });
    new CfnOutput(this, 'RepositoryUri', { value: this.repository.repositoryUri });
  }
}
