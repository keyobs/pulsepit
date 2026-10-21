
export function buildVscodeUrl(path: string): string {
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  return `vscode://file${encoded.startsWith('/') ? '' : '/'}${encoded}?windowId=_blank`;
}
