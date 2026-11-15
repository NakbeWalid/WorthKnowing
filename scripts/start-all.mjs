// Lance les deux applications ensemble pour le développement local :
//   Miroir (service de profil)          http://localhost:3000
//   Boréal Courtage (courtage fictif)   http://localhost:3001
// En production, ce sont deux conteneurs distincts (voir infra/).
import { spawn } from 'node:child_process';

const apps = ['dist/miroir/main.js', 'dist/bank/main.js'].map((entry) =>
  spawn(process.execPath, [entry], { stdio: 'inherit', env: process.env }));

// Si l'une s'arrête (ou Ctrl+C), on arrête l'autre aussi.
const stop = () => apps.forEach((app) => app.kill());
apps.forEach((app) => app.on('exit', (code) => { stop(); process.exitCode ||= code ?? 0; }));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
