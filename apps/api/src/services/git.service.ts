import { simpleGit } from 'simple-git';

export interface GitStatus {
  branch: string | null;
  isClean: boolean;
  changedFiles: number;
  untrackedFiles: number;
}

export async function getGitStatus(repositoryPath: string): Promise<GitStatus> {
  const git = simpleGit({
    baseDir: repositoryPath,
    timeout: { block: 10_000 },
  });
  const status = await git.status(['--untracked-files=all']);
  const untrackedFiles = status.not_added.length;

  return {
    branch: status.detached ? null : status.current || null,
    isClean: status.isClean(),
    changedFiles: status.files.length - untrackedFiles,
    untrackedFiles,
  };
}
