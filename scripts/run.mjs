// Lance directement les binaires installés, sans sous-processus pnpm/Turbo.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cwd = (app) => path.join(root, 'apps', app);
const binary = (app, name) => {
  const file = path.join(cwd(app), 'node_modules', '.bin', name);
  if (!existsSync(file)) {
    throw new Error(
      `Exécutable introuvable : ${file}. Exécute pnpm install à la racine.`,
    );
  }
  return file;
};
const start = (app, name, args) =>
  spawn(binary(app, name), args, {
    cwd: cwd(app),
    stdio: 'inherit',
    env: process.env,
  });

function completed(child, label) {
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (code === 0) resolve();
      else
        reject(
          new Error(
            `${label} a échoué (code=${code}, signal=${signal ?? 'aucun'})`,
          ),
        );
    });
  });
}
async function run(app, name, args) {
  console.log(`\n> ${app}: ${name} ${args.join(' ')}`);
  await completed(start(app, name, args), `${app}:${name}`);
}
async function development(apps) {
  // Vérifier les exécutables avant de démarrer quoi que ce soit.
  const specifications = apps.map((app) => ({
    app,
    name: app === 'web' ? 'vite' : 'tsx',
    args: app === 'web' ? ['--host', '127.0.0.1'] : ['watch', 'src/index.ts'],
  }));
  for (const { app, name } of specifications) binary(app, name);

  const children = specifications.map(({ app, name, args }) =>
    start(app, name, args),
  );
  let stopping = false;
  const stop = (signal = 'SIGTERM') => {
    if (stopping) return;
    stopping = true;
    for (const child of children) if (!child.killed) child.kill(signal);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
  await new Promise((resolve, reject) => {
    let alive = children.length;
    for (const child of children) {
      child.on('error', (error) => {
        stop();
        reject(error);
      });
      child.on('close', (code, signal) => {
        alive -= 1;
        if (!stopping) {
          stop();
          reject(
            new Error(
              `Un serveur s'est arrêté (code=${code}, signal=${signal ?? 'aucun'}).`,
            ),
          );
        } else if (alive === 0) resolve();
      });
    }
  });
}

try {
  const command = process.argv[2];
  switch (command) {
    case 'dev':
      await development(['api', 'web']);
      break;
    case 'dev:api':
      await development(['api']);
      break;
    case 'dev:web':
      await development(['web']);
      break;
    case 'check-types':
      await run('api', 'tsc', ['-p', 'tsconfig.json', '--noEmit']);
      await run('web', 'tsc', ['-p', 'tsconfig.json', '--noEmit']);
      break;
    case 'build':
      await run('api', 'tsc', ['-p', 'tsconfig.json']);
      await run('web', 'tsc', ['-p', 'tsconfig.json', '--noEmit']);
      await run('web', 'vite', ['build']);
      break;
    default:
      throw new Error(
        'Commande inconnue. Utilise dev, dev:api, dev:web, check-types ou build.',
      );
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
