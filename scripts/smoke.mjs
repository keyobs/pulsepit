// Démarrage réel des deux serveurs et contrôle HTTP local (API + Web + proxy Vite).
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  loadEnvFile(path.join(root, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const projectName = JSON.parse(
  readFileSync(path.join(root, 'package.json'), 'utf8'),
).name;
const apiPort = Number(process.env.PORT ?? 3001);
const webPort = Number(process.env.WEB_PORT ?? 5173);
const children = [];
const make = (app, bin, args) => {
  const cwd = path.join(root, 'apps', app);
  const program = path.join(cwd, 'node_modules', '.bin', bin);
  if (!existsSync(program)) throw new Error(`Exécutable manquant : ${program}`);
  const child = spawn(program, args, {
    cwd,
    stdio: ['ignore', 'ignore', 'pipe'],
    env: process.env,
  });
  let recentOutput = '';
  child.stderr.on('data', (chunk) => {
    recentOutput = (recentOutput + chunk.toString()).slice(-5000);
  });
  child.on('error', (error) => {
    recentOutput += String(error);
  });
  children.push(child);
  return () => recentOutput;
};
const stop = () => {
  for (const child of children) if (!child.killed) child.kill('SIGTERM');
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
let diagnostic = [];
async function responseAt(url, validate) {
  const deadline = Date.now() + 15000;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1000);
      try {
        const response = await fetch(url, { signal: controller.signal });
        const content = await response.text();
        if (response.ok && validate(content)) return;
        lastError = `Réponse HTTP ${response.status}: ${content.slice(0, 100)}`;
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      lastError = String(error);
    }
    if (children.some((child) => child.exitCode !== null)) {
      throw new Error(
        `Un serveur s'est arrêté avant le test de ${url}: ${diagnostic.map((read) => read()).join(' ')}`,
      );
    }
    await sleep(200);
  }
  throw new Error(
    `Timeout pour ${url}: ${lastError}. ${diagnostic.map((read) => read()).join(' ')}`,
  );
}
try {
  diagnostic = [
    make('api', 'tsx', ['src/index.ts']),
    make('web', 'vite', ['--host', '127.0.0.1']),
  ];
  await responseAt(`http://127.0.0.1:${apiPort}/api/health`, (s) => {
    const data = JSON.parse(s);
    return data.status === 'ok' && data.app === `${projectName}-api`;
  });
  await responseAt(
    `http://127.0.0.1:${webPort}/`,
    (s) =>
      s.includes('<div id="root"></div>') &&
      s.includes(`<title>${projectName}</title>`),
  );
  await responseAt(`http://127.0.0.1:${webPort}/api/health`, (s) => {
    const data = JSON.parse(s);
    return data.status === 'ok' && data.app === `${projectName}-api`;
  });
  if (children.some((child) => child.exitCode !== null))
    throw new Error('Un serveur de test s’est arrêté prématurément.');
  console.log('OK - API, application web et proxy Vite joignables.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  stop();
}
