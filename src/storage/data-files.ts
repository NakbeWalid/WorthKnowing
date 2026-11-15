import { Logger } from '@nestjs/common';
import { GetObjectCommand, NoSuchKey, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { readFileSync } from 'fs';
import { join } from 'path';
import { config } from '../config';

/**
 * Fichiers de données (dataset/*.csv, data/*.json, corpus de nouvelles).
 * Avec DATA_BUCKET : lus depuis Amazon S3 (source unique et versionnée pour toutes les instances),
 * avec repli sur le disque local si S3 est indisponible. Sans DATA_BUCKET : disque local uniquement.
 */
const s3 = new S3Client({ region: config.awsRegion });
const log = new Logger('Données');

/** Lit un fichier par son chemin relatif à la racine du projet (ex. « dataset/prices_daily.csv »). */
export async function readDataFile(path: string): Promise<string> {
  if (config.dataBucket) {
    try {
      const text = await s3Get(path);
      if (text !== undefined) {
        log.log(`${path} ← s3://${config.dataBucket}/${path}`);
        return text;
      }
      log.warn(`${path} absent du bucket, repli sur le disque local`);
    } catch (err) {
      log.warn(`${path} : S3 indisponible (${(err as Error).message}), repli sur le disque local`);
    }
  }
  return readFileSync(join(process.cwd(), path), 'utf-8');
}

/** Objet S3 en texte, ou undefined s'il n'existe pas. */
export async function s3Get(key: string): Promise<string | undefined> {
  try {
    const out = await s3.send(new GetObjectCommand({ Bucket: config.dataBucket, Key: key }));
    return await out.Body!.transformToString('utf-8');
  } catch (err) {
    if (err instanceof NoSuchKey || (err as Error).name === 'NoSuchKey') return undefined;
    throw err;
  }
}

export async function s3Put(key: string, body: string, contentType = 'application/json') {
  await s3.send(new PutObjectCommand({ Bucket: config.dataBucket, Key: key, Body: body, ContentType: contentType }));
}

