import { Injectable } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

/**
 * Corpus de nouvelles : chaque recherche (brute) et chaque analyse du modèle est conservée
 * sous une clé du type « raw/NVDA/2023-05-30.json ». Avantages :
 *  - traçabilité : on peut montrer au jury exactement ce qui a été récupéré, et quand ;
 *  - démo stable et rapide : une même enquête donne toujours le même résultat.
 */
@Injectable()
export class NewsCache {
  private dir = join(process.cwd(), 'data', 'news');

  async get<T>(key: string): Promise<T | undefined> {
    const file = join(this.dir, key);
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf-8')) as T) : undefined;
  }

  async put(key: string, value: unknown): Promise<void> {
    const file = join(this.dir, key);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(value, null, 1));
  }
}
