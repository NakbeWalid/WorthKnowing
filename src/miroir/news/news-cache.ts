import { Injectable, Logger } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { config } from '../config';
import { s3Get, s3Put } from '../../shared/data-files';

/**
 * Corpus de nouvelles : chaque recherche (brute) et chaque analyse du modèle est conservée
 * sous une clé du type « raw/NVDA/2023-05-30.json ». Avantages :
 *  - traçabilité : on peut montrer au jury exactement ce qui a été récupéré, et quand ;
 *  - démo stable et rapide : une même enquête donne toujours le même résultat.
 * Copie locale dans data/news/ ; avec DATA_BUCKET, le corpus de référence est dans s3://…/data/news/
 * (partagé par toutes les instances, survit aux redéploiements du conteneur).
 */
@Injectable()
export class NewsCache {
  private dir = join(process.cwd(), 'data', 'news');
  private log = new Logger('NewsCache');

  async get<T>(key: string): Promise<T | undefined> {
    const file = join(this.dir, key);
    if (existsSync(file)) {
      try {
        return JSON.parse(readFileSync(file, 'utf-8')) as T;
      } catch {
        this.log.warn(`fichier de cache illisible, ignoré : ${key}`); // fichier tronqué : on refait la recherche
      }
    }
    if (!config.dataBucket) return undefined;
    try {
      const text = await s3Get(`data/news/${key}`);
      if (text === undefined) return undefined;
      const value = JSON.parse(text) as T;
      this.writeLocal(file, text);
      return value;
    } catch (err) {
      this.log.warn(`lecture S3 impossible (${key}) : ${(err as Error).message}`);
      return undefined;
    }
  }

  async put(key: string, value: unknown): Promise<void> {
    const text = JSON.stringify(value, null, 1);
    try {
      this.writeLocal(join(this.dir, key), text);
    } catch (err) {
      this.log.warn(`écriture locale impossible (${key}) : ${(err as Error).message}`); // disque en lecture seule : pas bloquant
    }
    if (config.dataBucket) {
      await s3Put(`data/news/${key}`, text).catch((err) => this.log.warn(`écriture S3 impossible (${key}) : ${err.message}`));
    }
  }

  private writeLocal(file: string, text: string) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, text);
    renameSync(`${file}.tmp`, file); // atomique : une lecture simultanée ne voit jamais un fichier à moitié écrit
  }
}
