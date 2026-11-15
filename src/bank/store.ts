import { Injectable } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { Account, BankTrade } from './types';

/** Persistance de la plateforme de courtage (séparée de celle de Miroir). */
export abstract class BankStore {
  abstract getAccount(id: string): Promise<Account | undefined>;
  abstract getAccountByEmail(email: string): Promise<Account | undefined>;
  abstract saveAccount(account: Account): Promise<void>;
  abstract listTrades(accountId: string): Promise<BankTrade[]>;
  abstract saveTrade(trade: BankTrade): Promise<void>;
}

/** Implémentation locale : data/bank-db.json. */
@Injectable()
export class JsonBankStore extends BankStore {
  private file = join(process.cwd(), 'data', 'bank-db.json');
  private db: { accounts: Record<string, Account>; trades: BankTrade[] } = { accounts: {}, trades: [] };

  constructor() {
    super();
    if (existsSync(this.file)) this.db = JSON.parse(readFileSync(this.file, 'utf-8'));
  }

  private persist() {
    mkdirSync(dirname(this.file), { recursive: true });
    // Écriture atomique : un arrêt en plein milieu ne laisse jamais un fichier tronqué.
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.db));
    renameSync(`${this.file}.tmp`, this.file);
  }

  // Les objets sont copiés à la lecture : deux requêtes simultanées ne partagent jamais le même objet.
  async getAccount(id: string) { return clone(this.db.accounts[id]); }
  async getAccountByEmail(email: string) {
    return clone(Object.values(this.db.accounts).find((a) => a.email === String(email).trim().toLowerCase()));
  }
  async saveAccount(account: Account) { this.db.accounts[account.id] = clone(account)!; this.persist(); }
  async listTrades(accountId: string) {
    return this.db.trades.filter((t) => t.accountId === accountId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  // Un trade est sauvegardé deux fois (exécution immédiate « pending », puis résultat de l'enquête en
  // arrière-plan) : on remplace l'entrée existante par id plutôt que de dupliquer (voir TradingService).
  async saveTrade(trade: BankTrade) {
    const i = this.db.trades.findIndex((t) => t.id === trade.id);
    if (i === -1) this.db.trades.push(clone(trade)!); else this.db.trades[i] = clone(trade)!;
    this.persist();
  }
}

const clone = <T>(value: T | undefined): T | undefined => (value === undefined ? undefined : structuredClone(value));
