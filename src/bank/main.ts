import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { BankModule } from './bank.module';
import { config } from './config';

async function bootstrap() {
  const app = await NestFactory.create(BankModule);
  await app.listen(config.port);
  console.log(`${config.name} (plateforme de courtage fictive) — http://localhost:${config.port}  → Miroir : ${config.miroir.apiUrl}`);
}
bootstrap();
