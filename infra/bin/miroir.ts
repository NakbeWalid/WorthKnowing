#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { MiroirAppStack } from '../lib/app-stack';
import { MiroirBuildStack } from '../lib/build-stack';
import { MiroirDataStack } from '../lib/data-stack';

// Région us-east-1 : ca-central-1 est bloquée dans le compte de l'atelier, et les modèles
// Bedrock retenus (profils d'inférence « us. ») y sont disponibles.
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1' };
const app = new App();

const data = new MiroirDataStack(app, 'MiroirData', { env });
const build = new MiroirBuildStack(app, 'MiroirBuild', { env });
new MiroirAppStack(app, 'MiroirApp', {
  env, data, repository: build.repository,
  imageTag: app.node.tryGetContext('imageTag') ?? 'latest',
  bedrockModelId: app.node.tryGetContext('bedrockModelId') ?? 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
});
