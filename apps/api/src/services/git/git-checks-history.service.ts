import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname } from 'node:path';
import { ChecksOperation } from '@pulsepit/contracts';

const limit = 4 * 1024 * 1024;
const retention = 15 * 60_000;
export class GitChecksHistory {
  private pending = Promise.resolve();
  constructor(
    private path: string,
    private onError: () => void = () => {},
  ) {}
  private async regularFile() {
    try {
      const stat = await lstat(this.path);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit)
        throw new Error('Unsupported history file.');
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw error;
    }
  }
  async load(): Promise<ChecksOperation[]> {
    try {
      if (!(await this.regularFile())) return [];
      const value = JSON.parse(await readFile(this.path, 'utf8'));
      if (
        value.version !== 1 ||
        !Array.isArray(value.operations) ||
        value.operations.length > 100
      )
        throw new Error('Invalid check history.');
      const operations = value.operations.map((entry: unknown) =>
        ChecksOperation.parse(entry),
      );
      if (
        new Set(operations.map((entry: ChecksOperation) => entry.id)).size !==
        operations.length
      )
        throw new Error('Duplicate check operation.');
      return operations.filter(
        (entry: ChecksOperation) =>
          !entry.completedAt ||
          Date.now() - Date.parse(entry.completedAt) < retention,
      );
    } catch {
      this.onError();
      return [];
    }
  }
  save(operations: ChecksOperation[]): Promise<void> {
    const body = JSON.stringify({ version: 1, operations });
    this.pending = this.pending.then(async () => {
      const temporary = `${this.path}.${randomUUID()}.tmp`;
      try {
        if (Buffer.byteLength(body) > limit)
          throw new Error('History too large.');
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        await this.regularFile();
        await writeFile(temporary, body, { mode: 0o600, flag: 'wx' });
        await rename(temporary, this.path);
      } catch {
        this.onError();
      } finally {
        await rm(temporary, { force: true }).catch(() => {});
      }
    });
    return this.pending;
  }
  flush(): Promise<void> {
    return this.pending;
  }
}
