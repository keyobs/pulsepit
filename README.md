# pulsepit

Monorepo **pnpm Workspaces + Turborepo + React/Vite + Fastify + TypeScript + Biome**.

## Prérequis

- Node.js >= 22.13 ; pnpm >= 12.
- Installation initiale : `pnpm install` (réalisée par le générateur).

## Démarrage (depuis la racine)

| Action | Commande | URL |
| --- | --- | --- |
| Front React/Vite seul | `pnpm dev:web` | http://127.0.0.1:5173 |
| Backend Fastify seul | `pnpm dev:api` | http://127.0.0.1:3001/api/health |
| Front + back | `pnpm dev` | Les deux URLs ci-dessus |

Si pnpm 12 rencontre un problème de lancement des scripts, utilise directement `node scripts/run.mjs dev` : il ne lance aucun sous-processus pnpm.

Les ports se configurent dans le fichier `.env` à la racine :

```dotenv
PORT=3001
WEB_PORT=5173
```

`PORT` correspond à l’API et `WEB_PORT` au frontend. Le proxy `/api` utilise automatiquement `PORT`. Relance les serveurs après une modification. Si un port est déjà occupé, choisis un autre numéro, par exemple `WEB_PORT=5174`.

## Vérifications

- `pnpm check-types` : TypeScript API puis Web, sans Turbo.
- `pnpm build` : compilation API et Web, sans Turbo.
- `pnpm lint` : vérification Biome.
- `pnpm format` : formatage Biome.
- `pnpm smoke` : vérifie que l'API, Vite et le proxy démarrent.
- `pnpm turbo:build` : build via le cache Turbo (optionnel).

Les dépendances sont déclarées dans chaque application et résolues dans `pnpm-lock.yaml`.
Le frontend passe ses requêtes `/api/*` à Fastify via le proxy Vite **en développement**.