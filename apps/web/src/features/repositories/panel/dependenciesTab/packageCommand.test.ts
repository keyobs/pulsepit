import { installCommand } from './packageCommand';

const target = {
  name: 'vite',
  version: '8.0.0',
  section: 'devDependencies' as const,
  workspace: null,
};

describe('installCommand', () => {
  it('builds the command of each package manager', () => {
    expect(installCommand('npm', target)).toBe('npm install vite@8.0.0 -D');
    expect(installCommand('pnpm', target)).toBe('pnpm add vite@8.0.0 -D');
    expect(installCommand('yarn', target)).toBe('yarn add vite@8.0.0 -D');
  });

  it('targets a workspace without section flag', () => {
    const workspace = { ...target, section: null, workspace: 'api' };
    expect(installCommand('npm', workspace)).toBe(
      'npm install vite@8.0.0 -w api',
    );
    expect(installCommand('pnpm', workspace)).toBe(
      'pnpm add vite@8.0.0 --filter api',
    );
    expect(installCommand('yarn', workspace)).toBe(
      'yarn workspace api add vite@8.0.0',
    );
  });

  it('adds no flag for regular dependencies', () => {
    expect(installCommand('pnpm', { ...target, section: 'dependencies' })).toBe(
      'pnpm add vite@8.0.0',
    );
  });
});
