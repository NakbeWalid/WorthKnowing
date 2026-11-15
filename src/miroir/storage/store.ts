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
  private file = join(process.cwd(), 'data', 'db.json'); // base locale de Miroir
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

  // Les objets sont copiés à la lecture et à l'écriture, comme avec une vraie base : une requête qui échoue
  // en cours de route ne laisse aucune modification à moitié appliquée en mémoire.
  async listUsers() { return structuredClone(Object.values(this.db.users)); }
  async getUser(id: string) { return clone(this.db.users[id]); }
  async getUserByEmail(email: string) {
    return clone(Object.values(this.db.users).find((u) => u.email === String(email).trim().toLowerCase()));
  }
  async saveUser(user: User) { this.db.users[user.id] = structuredClone(user); this.persist(); }
  async getEvaluation(id: string) { return clone(this.db.evaluations[id]); }
  async saveEvaluation(e: Evaluation) { this.db.evaluations[e.id] = structuredClone(e); this.persist(); }
  async listTrades(userId: string) {
    return this.db.trades.filter((t) => t.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async saveTrade(trade: Trade) { this.db.trades.push(trade); this.persist(); }
}

const clone = <T>(value: T | undefined): T | undefined => (value === undefined ? undefined : structuredClone(value));
