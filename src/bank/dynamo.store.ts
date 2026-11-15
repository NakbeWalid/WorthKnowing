import { Injectable } from '@nestjs/common';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import { config } from './config';
import { BankStore } from './store';
import { Account, BankTrade } from './types';

/**
 * Persistance Amazon DynamoDB de la plateforme de courtage (BANK_STORAGE_DRIVER=dynamodb).
 *   boreal-accounts  PK id                GSI email-index (email)
 *   boreal-trades    PK accountId, SK createdAt
 * Tables distinctes de celles de Miroir : les deux applications ne partagent aucune donnée.
 * ⚠ Écrit sans accès à AWS : à vérifier par Kiro (voir KIRO_HANDOFF.md, hypothèse H6).
 */
@Injectable()
export class DynamoBankStore extends BankStore {
  private db = DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.awsRegion }), {
    marshallOptions: { removeUndefinedValues: true },
  });

  async getAccount(id: string) {
    const out = await this.db.send(new GetCommand({ TableName: config.tables.accounts, Key: { id } }));
    return out.Item as Account | undefined;
  }

  async getAccountByEmail(email: string) {
    const items = await this.query({
      TableName: config.tables.accounts, IndexName: 'email-index',
      KeyConditionExpression: 'email = :e', ExpressionAttributeValues: { ':e': String(email).trim().toLowerCase() },
    });
    return items[0] as Account | undefined;
  }

  async saveAccount(account: Account) {
    await this.db.send(new PutCommand({ TableName: config.tables.accounts, Item: account }));
  }

  /** Plus récent d'abord, comme JsonBankStore. */
  async listTrades(accountId: string) {
    return (await this.query({
      TableName: config.tables.trades, KeyConditionExpression: 'accountId = :a',
      ExpressionAttributeValues: { ':a': accountId }, ScanIndexForward: false,
    })) as BankTrade[];
  }

  async saveTrade(trade: BankTrade) {
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
