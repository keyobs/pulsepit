const KNOWN_HOSTS: Array<[suffix: string, label: string]> = [
  ['vercel.com', 'Vercel'],
  ['netlify.com', 'Netlify'],
  ['scaleway.com', 'Scaleway'],
  ['ovh.com', 'OVH'],
  ['ovhcloud.com', 'OVHcloud'],
  ['aws.amazon.com', 'AWS'],
  ['cloud.google.com', 'Google Cloud'],
  ['azure.com', 'Azure'],
  ['render.com', 'Render'],
  ['fly.io', 'Fly.io'],
  ['railway.app', 'Railway'],
  ['cloudflare.com', 'Cloudflare'],
  ['heroku.com', 'Heroku'],
  ['github.com', 'GitHub'],
  ['gitlab.com', 'GitLab'],
];

/** Nom lisible de l'hébergeur déduit d'une URL de console (« https://vercel.com/… » donne « Vercel »). */
export function hostLabel(url: string): string {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return url;
  }
  const known = KNOWN_HOSTS.find(
    ([suffix]) => hostname === suffix || hostname.endsWith(`.${suffix}`),
  );
  if (known) return known[1];
  const parts = hostname
    .replace(/^(www|console|app|dashboard)\./, '')
    .split('.');
  const name = parts.length > 1 ? parts[parts.length - 2] : parts[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}
