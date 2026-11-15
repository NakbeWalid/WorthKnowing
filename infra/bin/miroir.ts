#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import { MiroirDataStack } from '../lib/data-stack';

// Région us-east-1 : ca-central-1 est bloquée dans le compte de l'atelier, et les modèles
// Bedrock retenus (profils d'inférence « us. ») y sont disponibles.
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1' };
const app = new App();
new MiroirDataStack(app, 'MiroirData', { env });
