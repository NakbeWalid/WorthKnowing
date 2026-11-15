import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { BankModule } from './bank.module';
import { config } from './config';

async function bootstrap() {
  const app = await NestFactory.create(BankModule, { bodyParser: false });
  app.use(json({ limit: '50mb' }));
  app.use(urlencoded({ limit: '50mb', extended: true }));
  await app.listen(config.port);
  console.log(`${config.name} (plateforme de courtage fictive) — http://localhost:${config.port}  → WorthKnowing : ${config.miroir.apiUrl}`);
}
bootstrap();
