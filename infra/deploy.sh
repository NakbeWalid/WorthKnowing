#!/usr/bin/env bash
# Déploie Miroir de bout en bout (aucun Docker requis en local).
#   1. données (DynamoDB, Cognito, S3 + envoi du dataset et du corpus) et chaîne de build (ECR, CodeBuild) ;
#   2. construction de l'image dans CodeBuild, étiquetée avec le commit git ;
#   3. application (ECS Fargate + ALB + CloudFront) ;
#   4. mot de passe du compte admin Cognito aligné sur le secret Secrets Manager.
# Usage : cd infra && ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"
export AWS_REGION="${AWS_REGION:-us-east-1}" CDK_DEFAULT_REGION="${AWS_REGION:-us-east-1}"
TAG="$(git rev-parse --short HEAD)$(git diff --quiet HEAD -- ../src ../public ../package.json || echo -dirty)"

echo "▶ 1/4 Données et chaîne de build"
npx cdk deploy MiroirData MiroirBuild --require-approval never --outputs-file outputs.json

echo "▶ 2/4 Image $TAG (CodeBuild)"
SOURCE=$(node -p "require('./outputs.json').MiroirBuild.SourceKey")
BUILD_ID=$(aws codebuild start-build --project-name miroir-image \
  --source-location-override "${SOURCE#s3://}" \
  --environment-variables-override "name=IMAGE_TAG,value=$TAG" --query build.id --output text)
while true; do
  STATUS=$(aws codebuild batch-get-builds --ids "$BUILD_ID" --query 'builds[0].buildStatus' --output text)
  [ "$STATUS" != "IN_PROGRESS" ] && break
  sleep 15
done
[ "$STATUS" = "SUCCEEDED" ] || { echo "Échec du build : $STATUS ($BUILD_ID)"; exit 1; }

echo "▶ 3/4 Application"
npx cdk deploy MiroirApp -c imageTag="$TAG" --require-approval never --outputs-file outputs.json

echo "▶ 4/4 Compte admin"
POOL=$(node -p "require('./outputs.json').MiroirData.UserPoolId")
PASSWORD=$(aws secretsmanager get-secret-value --secret-id miroir/admin-password --query SecretString --output text)
aws cognito-idp admin-set-user-password --user-pool-id "$POOL" --username admin@miroir.local --password "$PASSWORD" --permanent

echo "✔ Déployé : $(node -p "require('./outputs.json').MiroirApp.Url")"
echo "  Mot de passe admin : aws secretsmanager get-secret-value --secret-id miroir/admin-password --query SecretString --output text"
