import { CfnOutput, Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { Construct } from 'constructs';
import { join } from 'path';

/**
 * Ressources de données de Miroir, séparées de l'application pour pouvoir redéployer
 * le conteneur sans toucher aux données :
 *  - DynamoDB : utilisateurs, évaluations, trades de Miroir ; comptes et ordres de la plateforme de courtage
 *    (tables distinctes : les deux applications ne partagent aucune donnée) ;
 *  - Cognito  : comptes et groupe « admin » ;
 *  - S3       : jeu de données, scénarios et corpus de nouvelles (traçabilité).
 * Projet de datathon : RemovalPolicy.DESTROY pour ne rien laisser derrière après `cdk destroy`.
 */
export class MiroirDataStack extends Stack {
  readonly tables: dynamodb.Table[];
  /** Tables de Boréal Courtage (la plateforme de courtage fictive). */
  readonly bankTables: dynamodb.Table[];
  readonly userPool: cognito.UserPool;
  readonly userPoolClient: cognito.UserPoolClient;
  readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // --- DynamoDB : documents stockés tels quels, facturation à la requête -----------------
    const common = { billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true } };
    const users = new dynamodb.Table(this, 'Users', {
      ...common, tableName: 'miroir-users', partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
    });
    users.addGlobalSecondaryIndex({ indexName: 'email-index', partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING } });
    const evaluations = new dynamodb.Table(this, 'Evaluations', {
      ...common, tableName: 'miroir-evaluations', partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
    });
    const trades = new dynamodb.Table(this, 'Trades', {
      ...common, tableName: 'miroir-trades',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });
    this.tables = [users, evaluations, trades];

    // --- DynamoDB de la plateforme de courtage : comptes (+ index par courriel) et historique des ordres ---
    const accounts = new dynamodb.Table(this, 'BankAccounts', {
      ...common, tableName: 'boreal-accounts', partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
    });
    accounts.addGlobalSecondaryIndex({ indexName: 'email-index', partitionKey: { name: 'email', type: dynamodb.AttributeType.STRING } });
    const bankTrades = new dynamodb.Table(this, 'BankTrades', {
      ...common, tableName: 'boreal-trades',
      partitionKey: { name: 'accountId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'createdAt', type: dynamodb.AttributeType.STRING },
    });
    this.bankTables = [accounts, bankTrades];

    // --- Cognito : l'inscription passe par le serveur (SignUp + confirmation administrateur) ---
    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'miroir-users',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      standardAttributes: { email: { required: true, mutable: true }, fullname: { required: false, mutable: true } },
      passwordPolicy: { minLength: 8, requireDigits: true, requireLowercase: true, requireUppercase: false, requireSymbols: false },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    new cognito.CfnUserPoolGroup(this, 'AdminGroup', {
      userPoolId: this.userPool.userPoolId, groupName: 'admin', description: 'Accès à la vue admin de Miroir',
    });
    this.userPoolClient = this.userPool.addClient('ServerClient', {
      userPoolClientName: 'miroir-server',
      authFlows: { adminUserPassword: true },
      accessTokenValidity: Duration.hours(12),
      idTokenValidity: Duration.hours(12),
      preventUserExistenceErrors: true,
    });

    // --- S3 : données de référence lues au démarrage + corpus de nouvelles ------------------
    this.bucket = new s3.Bucket(this, 'DataBucket', {
      bucketName: `miroir-data-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
    const root = join(__dirname, '..', '..');
    // prune: false → on ne supprime jamais le corpus de nouvelles écrit par l'application.
    new s3deploy.BucketDeployment(this, 'Dataset', {
      destinationBucket: this.bucket, destinationKeyPrefix: 'dataset/', prune: false,
      sources: [s3deploy.Source.asset(join(root, 'dataset'))],
    });
    new s3deploy.BucketDeployment(this, 'AppData', {
      destinationBucket: this.bucket, destinationKeyPrefix: 'data/', prune: false,
      sources: [s3deploy.Source.asset(join(root, 'data'), { exclude: ['db.json'] })],
    });

    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
    new CfnOutput(this, 'DataBucketName', { value: this.bucket.bucketName });
  }
}
