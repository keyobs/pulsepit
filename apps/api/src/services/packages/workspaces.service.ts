import { glob, readdir, readFile, stat } from 'node:fs/promises';
import { isAbsolute, join, matchesGlob, relative, sep } from 'node:path';

export interface WorkspaceDirectory {
  name: string | null;
  path: string;
  absolutePath: string;
  technology?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function readJson(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

const unquote = (value: string) =>
  value
    .replace(/\s+#.*$/, '')
    .trim()
    .replace(/^(['"])(.*)\1$/, '$2');

// Only the `packages` list of pnpm-workspace.yaml is needed.
function pnpmPatterns(content: string): string[] {
  const patterns: string[] = [];
  let inPackages = false;
  for (const line of content.split(/\r?\n/)) {
    if (/^packages\s*:/.test(line)) {
      inPackages = true;
      continue;
    }
    if (!inPackages || !line.trim() || line.trim().startsWith('#')) continue;
    const item = /^\s+-\s*(.+)$/.exec(line);
    if (!item) break;
    patterns.push(unquote(item[1]));
  }
  return patterns;
}

async function readPatterns(repositoryPath: string): Promise<string[]> {
  const yaml = await readFile(
    join(repositoryPath, 'pnpm-workspace.yaml'),
    'utf8',
  ).catch(() => null);
  if (yaml !== null) return pnpmPatterns(yaml);
  const manifest = await readJson(join(repositoryPath, 'package.json'));
  if (!isObject(manifest)) return [];
  const { workspaces } = manifest;
  const list = Array.isArray(workspaces)
    ? workspaces
    : isObject(workspaces) && Array.isArray(workspaces.packages)
      ? workspaces.packages
      : [];
  return list.filter((value): value is string => typeof value === 'string');
}

const skippedDirectories = new Set([
  'node_modules',
  'bin',
  'obj',
  'dist',
  'build',
  'coverage',
  'vendor',
]);
const TECHNOLOGIES: [RegExp, string][] = [
  [/\.(csproj|fsproj|sln|slnx)$/, 'C# / .NET'],
  [/^go\.mod$/, 'Go'],
  [/^Cargo\.toml$/, 'Rust'],
  [/^(pom\.xml|build\.gradle(\.kts)?)$/, 'Java'],
  [/^(pyproject\.toml|requirements\.txt)$/, 'Python'],
  [/^composer\.json$/, 'PHP'],
  [/^Gemfile$/, 'Ruby'],
];

async function technologyOf(directory: string): Promise<string | undefined> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  const match = (name: string) =>
    TECHNOLOGIES.find(([pattern]) => pattern.test(name))?.[1];
  for (const entry of entries)
    if (entry.isFile() && match(entry.name)) return match(entry.name);
  // Solutions often keep each project in its own sub-folder.
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const children = await readdir(join(directory, entry.name)).catch(() => []);
    const found = children.map(match).find(Boolean);
    if (found) return found;
  }
  return undefined;
}

const NESTED_MAX_DEPTH = 3;
const NESTED_MAX_PROJECTS = 20;

// Standalone sub-projects (own package.json, not declared as workspaces).
export async function findNestedProjects(
  repositoryPath: string,
): Promise<WorkspaceDirectory[]> {
  const projects: WorkspaceDirectory[] = [];
  let level = [''];
  for (let depth = 1; depth <= NESTED_MAX_DEPTH && level.length; depth++) {
    const next: string[] = [];
    for (const parent of level) {
      const entries = await readdir(join(repositoryPath, parent), {
        withFileTypes: true,
      }).catch(() => []);
      for (const entry of entries) {
        if (
          !entry.isDirectory() ||
          entry.name.startsWith('.') ||
          skippedDirectories.has(entry.name)
        )
          continue;
        const path = parent ? `${parent}/${entry.name}` : entry.name;
        const absolutePath = join(repositoryPath, path);
        const manifest = await readJson(join(absolutePath, 'package.json'));
        if (isObject(manifest)) {
          projects.push({
            name: typeof manifest.name === 'string' ? manifest.name : null,
            path,
            absolutePath,
          });
        } else {
          const technology = await technologyOf(absolutePath);
          if (!technology) {
            next.push(path);
            continue;
          }
          projects.push({ name: entry.name, path, absolutePath, technology });
        }
        if (projects.length >= NESTED_MAX_PROJECTS) return sortByPath(projects);
      }
    }
    level = next;
  }
  return sortByPath(projects);
}

const sortByPath = (projects: WorkspaceDirectory[]) =>
  projects.sort((a, b) => a.path.localeCompare(b.path));

export async function findWorkspaces(
  repositoryPath: string,
): Promise<WorkspaceDirectory[]> {
  const patterns = await readPatterns(repositoryPath);
  const include = patterns
    .filter((pattern) => !pattern.startsWith('!'))
    .map((pattern) => pattern.replace(/\/+$/, ''));
  const exclude = patterns
    .filter((pattern) => pattern.startsWith('!'))
    .map((pattern) => pattern.slice(1).replace(/\/+$/, ''));
  const found = new Map<string, WorkspaceDirectory>();

  for (const pattern of include) {
    if (!pattern || isAbsolute(pattern)) continue;
    for await (const match of glob(pattern, {
      cwd: repositoryPath,
      exclude: (name) => name === 'node_modules' || name === '.git',
    })) {
      const path = match.split(sep).join('/');
      if (
        path === '.' ||
        path === '' ||
        path.split('/').includes('..') ||
        path.split('/').includes('node_modules') ||
        found.has(path) ||
        exclude.some((negated) => matchesGlob(path, negated))
      )
        continue;
      const absolutePath = join(repositoryPath, path);
      if (relative(repositoryPath, absolutePath).startsWith('..')) continue;
      const isDirectory = await stat(absolutePath)
        .then((entry) => entry.isDirectory())
        .catch(() => false);
      if (!isDirectory) continue;
      const manifest = await readJson(join(absolutePath, 'package.json'));
      if (!isObject(manifest)) continue;
      found.set(path, {
        name: typeof manifest.name === 'string' ? manifest.name : null,
        path,
        absolutePath,
      });
    }
  }
  return [...found.values()].sort((a, b) => a.path.localeCompare(b.path));
}
