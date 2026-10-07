import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = fileURLToPath(new URL('../', import.meta.url));

// Preserve the existing URLs and script load order for static hosts and the PWA.
export const PUBLIC_FILES = [
  'index.html',
  'sw.js',
  'manifest.json',
  'robots.txt',
  'favicon.ico',
  'favicon.svg',
  'favicon-16.png',
  'favicon-32.png',
  'favicon-64.png',
  'favicon-192.png',
  'favicon-512.png',
  'og-image.png',
  'og-image.svg'
];

export const PUBLIC_DIRECTORIES = ['css', 'js', 'assets', 'images'];

export function isPublicPath(path) {
  const parts = path.split('/');
  if (parts.some(part => !part || part.startsWith('.') || /[\\:\x00]/.test(part))) {
    return false;
  }

  // config.json is deliberately available to the browser, as with static hosting.
  return PUBLIC_FILES.includes(path) || path === 'config.json' ||
    (parts.length > 1 && PUBLIC_DIRECTORIES.includes(parts[0]));
}
