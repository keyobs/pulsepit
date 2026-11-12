import type { OutdatedResponse, PackageDependency } from '@api/types';

type Manager = OutdatedResponse['packageManager'];
type Section = PackageDependency['section'];

const SECTION_FLAGS: Record<Manager, Partial<Record<Section, string>>> = {
  npm: { devDependencies: '-D', optionalDependencies: '-O' },
  pnpm: { devDependencies: '-D', optionalDependencies: '-O' },
  yarn: { devDependencies: '-D', optionalDependencies: '--optional' },
};

interface CommandTarget {
  name: string;
  version: string;
  section: Section | null;
  workspace: string | null;
  directory?: string | null;
}

export function installCommand(
  manager: Manager,
  { name, version, section, workspace, directory }: CommandTarget,
): string {
  const spec = `${name}@${version}`;
  const flag = section ? SECTION_FLAGS[manager][section] : undefined;
  const parts =
    manager === 'npm'
      ? ['npm install', spec, flag, workspace && `-w ${workspace}`]
      : manager === 'pnpm'
        ? ['pnpm add', spec, flag, workspace && `--filter ${workspace}`]
        : [
            workspace ? `yarn workspace ${workspace} add` : 'yarn add',
            spec,
            flag,
          ];
  const command = parts.filter(Boolean).join(' ');
  return directory ? `cd ${directory} && ${command}` : command;
}

export const UPGRADE_ALL_COMMANDS: Record<
  Manager,
  { wanted: string; latest: string }
> = {
  npm: {
    wanted: 'npm update',
    latest: 'npx npm-check-updates -u && npm install',
  },
  pnpm: { wanted: 'pnpm update -r', latest: 'pnpm update -r --latest' },
  yarn: { wanted: 'yarn upgrade', latest: 'yarn upgrade --latest' },
};
