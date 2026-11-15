import { Injectable } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { Evaluation, Trade, User } from '../domain/types';

/**
 * Contrat de persistance. Toute l'application ne dépend que de cette classe abstraite.
 * Implémentation AWS : `DynamoStore` (dynamo.store.ts), choisie par STORAGE_DRIVER=dynamodb.
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
    // Écriture atomique : un arrêt en plein milieu ne laisse jamais un db.json tronqué.
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.db));
    renameSync(`${this.file}.tmp`, this.file);
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
