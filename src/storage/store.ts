import { Injectable } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { Evaluation, Trade, User } from '../domain/types';

/**
 * Contrat de persistance. Toute l'application ne dépend que de cette classe abstraite.
 *
 * ▶ POINT D'INTÉGRATION AWS (Kiro) : créer `DynamoStore extends Store` (DynamoDB)
 *   et changer le `useClass` dans app.module.ts. Rien d'autre à modifier.
 */
export abstract class Store {
  abstract listUsers(): Promise<User[]>;
  abstract getUser(id: string): Promise<User | undefined>;
  abstract getUserByEmail(email: string): Promise<User | undefined>;
  abstract saveUser(user: User): Promise<void>;
  abstract getEvaluation(id: string): Promise<Evaluation | undefined>;
  abstract saveEvaluation(evaluation: Evaluation): Promise<void>;
  abstract listTrades(userId: string): Promise<Trade[]>;
  abstract saveTrade(trade: Trade): Promise<void>;
}

/** Implémentation locale : tout en mémoire, sauvegardé dans data/db.json. */
@Injectable()
export class JsonStore extends Store {
  private file = join(process.cwd(), 'data', 'db.json');
  private db: { users: Record<string, User>; evaluations: Record<string, Evaluation>; trades: Trade[] } =
    { users: {}, evaluations: {}, trades: [] };

  constructor() {
    super();
    if (existsSync(this.file)) this.db = JSON.parse(readFileSync(this.file, 'utf-8'));
  }

  private persist() {
    mkdirSync(dirname(this.file), { recursive: true });
    writeFileSync(this.file, JSON.stringify(this.db));
  }

  async listUsers() { return Object.values(this.db.users); }
  async getUser(id: string) { return this.db.users[id]; }
  async getUserByEmail(email: string) {
    return Object.values(this.db.users).find((u) => u.email === email.toLowerCase());
  }
  async saveUser(user: User) { this.db.users[user.id] = user; this.persist(); }
  async getEvaluation(id: string) { return this.db.evaluations[id]; }
  async saveEvaluation(e: Evaluation) { this.db.evaluations[e.id] = e; this.persist(); }
  async listTrades(userId: string) {
    return this.db.trades.filter((t) => t.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async saveTrade(trade: Trade) { this.db.trades.push(trade); this.persist(); }
}
