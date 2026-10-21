/** Dernier segment d'un chemin de dépôt (« /home/user/Projets/mon-app » donne « mon-app »). */
export function repositoryName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
