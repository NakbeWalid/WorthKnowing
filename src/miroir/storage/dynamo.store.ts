import { Injectable } from '@nestjs/common';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, QueryCommandInput, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { config } from '../config';
import { Evaluation, Trade, User } from '../domain/types';
import { Store } from './store';

/**
 * Persistance Amazon DynamoDB (STORAGE_DRIVER=dynamodb). Les objets sont stockés tels quels (documents).
 *   miroir-users        PK id            GSI email-index (email)
 *   miroir-evaluations  PK id
 *   miroir-trades       PK userId, SK createdAt  → historique d'un utilisateur en une seule requête
 * Tables à la demande (on-demand) : aucun débit à dimensionner pour une démo. Voir infra/.
 */
@Injectable()
export class DynamoStore extends Store {
  private db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.awsRegion }), {
    marshallOptions: { removeUndefinedValues: true },
  });

  async listUsers() {
    const users: User[] = [];
    let start: Record<string, any> | undefined;
    do { // un Scan est acceptable ici : vue admin, quelques centaines d'utilisateurs au plus
      const page = await this.db.send(new ScanCommand({ TableName: config.tables.users, ExclusiveStartKey: start }));
      users.push(...((page.Items ?? []) as User[]));
      start = page.LastEvaluatedKey;
    } while (start);
    return users;
  }

  async getUser(id: string) {
    const out = await this.db.send(new GetCommand({ TableName: config.tables.users, Key: { id } }));
    return out.Item as User | undefined;
  }

  async getUserByEmail(email: string) {
    const items = await this.query({
      TableName: config.tables.users, IndexName: 'email-index',
      KeyConditionExpression: 'email = :e', ExpressionAttributeValues: { ':e': email.toLowerCase() },
    });
    return items[0] as User | undefined;
  }

  async saveUser(user: User) {
    await this.db.send(new PutCommand({ TableName: config.tables.users, Item: user }));
  }

  async getEvaluation(id: string) {
    const out = await this.db.send(new GetCommand({ TableName: config.tables.evaluations, Key: { id } }));
    return out.Item as Evaluation | undefined;
  }

  async saveEvaluation(evaluation: Evaluation) {
    await this.db.send(new PutCommand({ TableName: config.tables.evaluations, Item: evaluation }));
  }

  /** Plus récent d'abord, comme JsonStore. */
  async listTrades(userId: string) {
    return (await this.query({
      TableName: config.tables.trades, KeyConditionExpression: 'userId = :u',
      ExpressionAttributeValues: { ':u': userId }, ScanIndexForward: false,
    })) as Trade[];
  }

  async saveTrade(trade: Trade) {
    await this.db.send(new PutCommand({ TableName: config.tables.trades, Item: trade }));
  }

  private async query(input: QueryCommandInput) {
    const items: Record<string, any>[] = [];
    let start: Record<string, any> | undefined;
    do {
      const page = await this.db.send(new QueryCommand({ ...input, ExclusiveStartKey: start }));
      items.push(...(page.Items ?? []));
      start = page.LastEvaluatedKey;
    } while (start);
    return items;
  }
}
