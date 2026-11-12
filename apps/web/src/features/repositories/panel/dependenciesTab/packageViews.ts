import type {
  OutdatedResponse,
  PackageDependency,
  WorkspacePackages,
} from '@api/types';

export interface PackageRow {
  key: string;
  name: string;
  installed: string | null;
  wanted: string | null;
  latest: string | null;
  status: PackageDependency['status'];
  section: PackageDependency['section'];
  workspace: string | null;
  directory: string | null;
  manager: OutdatedResponse['packageManager'] | null;
  owner: string | null;
}

export interface PackageView {
  id: string;
  label: string;
  title: string;
  workspace: string | null;
  error: string | null;
  technology: string | null;
  rows: PackageRow[];
}

export const ALL_VIEW_ID = 'all';
const ROOT_VIEW_ID = 'root';

const ORDER = { outdated: 0, current: 1, private: 2 };
const GROUPS = ['dependencies', 'dev dependencies', 'private'] as const;
type Group = (typeof GROUPS)[number];

export function groupOf(row: PackageRow): Group {
  if (row.status === 'private') return 'private';
  if (row.section === 'devDependencies') return 'dev dependencies';
  return 'dependencies';
}

const sortRows = (rows: PackageRow[]) =>
  rows.sort(
    (a, b) =>
      GROUPS.indexOf(groupOf(a)) - GROUPS.indexOf(groupOf(b)) ||
      ORDER[a.status] - ORDER[b.status] ||
      a.name.localeCompare(b.name) ||
      (a.owner ?? '').localeCompare(b.owner ?? ''),
  );

const workspaceLabel = (workspace: WorkspacePackages) =>
  workspace.path.split('/').pop() ?? workspace.path;

function toRows(
  packages: PackageDependency[],
  workspace: WorkspacePackages | null,
  owner: string | null,
): PackageRow[] {
  return packages.map((dependency) => ({
    key: `${workspace?.path ?? '.'}:${dependency.name}`,
    name: dependency.name,
    installed: dependency.installed,
    wanted: dependency.wanted,
    latest: dependency.latest,
    status: dependency.status,
    section: dependency.section,
    workspace:
      workspace && !workspace.standalone
        ? (workspace.name ?? workspace.path)
        : null,
    directory: workspace?.standalone ? workspace.path : null,
    manager: workspace?.packageManager ?? null,
    owner,
  }));
}

/** Une vue unique sans sous-package ; sinon « all », la racine puis un onglet par package. */
export function toPackageViews(report: OutdatedResponse): PackageView[] {
  const root = sortRows(toRows(report.packages, null, null));
  if (report.workspaces.length === 0)
    return [
      {
        id: ROOT_VIEW_ID,
        label: '',
        title: '',
        workspace: null,
        error: null,
        technology: null,
        rows: root,
      },
    ];

  const workspaces = report.workspaces.map(
    (workspace): PackageView => ({
      id: workspace.path,
      label: workspaceLabel(workspace),
      title: workspace.name ?? workspace.path,
      workspace: workspace.path,
      error: workspace.error,
      technology: workspace.technology,
      rows: sortRows(toRows(workspace.packages, workspace, null)),
    }),
  );
  const all = sortRows([
    ...toRows(report.packages, null, 'Monorepo'),
    ...report.workspaces.flatMap((workspace) =>
      toRows(workspace.packages, workspace, workspaceLabel(workspace)),
    ),
  ]);
  return [
    {
      id: ALL_VIEW_ID,
      label: 'all',
      title: 'Toutes les dépendances du dépôt',
      workspace: null,
      error: null,
      technology: null,
      rows: all,
    },
    {
      id: ROOT_VIEW_ID,
      label: 'Monorepo',
      title: 'package.json racine',
      workspace: null,
      error: null,
      technology: null,
      rows: root,
    },
    ...workspaces,
  ];
}

export const countStatus = (rows: PackageRow[], status: PackageRow['status']) =>
  rows.filter((row) => row.status === status).length;
