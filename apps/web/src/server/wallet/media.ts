import path from 'node:path';
import { open, realpath } from 'node:fs/promises';
import type { LocalOrUrl } from './types';

/**
 * Images des passes, sans SSRF.
 *
 * `logo_url` et `cover_url` acceptent n'importe quelle URL saisie par un
 * pro. Le serveur ne les télécharge JAMAIS : télécharger une URL
 * arbitraire depuis le VPS, c'est offrir une porte vers le réseau interne.
 *
 *  - Apple (images dans le .pkpass) : seuls les fichiers téléversés dans
 *    MEDIA_ROOT sont lus, par un chemin résolu et borné (même garde que
 *    app/media/[...path]) et une taille plafonnée. Sinon, monogramme.
 *  - Google (Google va chercher l'image lui-même) : seulement des URL
 *    HTTPS. Un fichier local n'est transmis que si le site est en HTTPS.
 *
 * `mediaRef` est pur (analyse de chaîne) ; seul `readLocalMedia` touche
 * au disque.
 */

const PART = /^[a-zA-Z0-9._-]+$/;
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
/** Un logo de 5 Mo est déjà déraisonnable pour un pass de 150 ko. */
export const MAX_MEDIA_BYTES = 5 * 1024 * 1024;

export function mediaRoot(): string {
  return process.env.MEDIA_ROOT?.trim() || '/app/data/uploads';
}

function localRef(relative: string, siteUrl: string): LocalOrUrl | null {
  const parts = relative.split('/');
  if (parts.length < 2 || parts.length > 4) return null;
  if (parts.some((part) => !PART.test(part) || part === '.' || part === '..')) return null;
  if (!IMAGE_EXT.has(path.extname(relative).toLowerCase())) return null;
  return { kind: 'local', relativePath: parts.join('/'), publicUrl: `${siteUrl}/media/${parts.join('/')}` };
}

/**
 * Classe une URL d'image : fichier local de MEDIA_ROOT, URL HTTPS externe,
 * ou rien (HTTP en clair, identifiants dans l'URL, chemin douteux).
 */
export function mediaRef(value: string | null | undefined, siteUrl: string): LocalOrUrl | null {
  const raw = value?.trim();
  if (!raw) return null;

  const site = siteUrl.replace(/\/+$/, '');
  if (raw.startsWith('/media/')) return localRef(raw.slice('/media/'.length), site);
  if (raw.startsWith(`${site}/media/`)) return localRef(raw.slice(`${site}/media/`.length), site);

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password) return null;
  return { kind: 'url', url: url.toString() };
}

/** URL publique utilisable par Google ; null → logo Rangvia. */
export function publicHttpsUrl(ref: LocalOrUrl | null): string | null {
  if (!ref) return null;
  const url = ref.kind === 'local' ? ref.publicUrl : ref.url;
  return url.startsWith('https://') ? url : null;
}

/** Logo Rangvia 660×660, rastérisé depuis public/icon.svg (route art). */
export function rangviaLogoUrl(siteUrl: string): string {
  return `${siteUrl.replace(/\/+$/, '')}/api/wallet/art/rangvia-660.png`;
}

/**
 * Lit un fichier local de MEDIA_ROOT, borné en chemin et en taille.
 * Renvoie null plutôt que d'échouer : le pass retombe sur le monogramme.
 */
export async function readLocalMedia(
  ref: LocalOrUrl | null,
  maxBytes = MAX_MEDIA_BYTES,
  root = mediaRoot(),
): Promise<Buffer | null> {
  if (!ref || ref.kind !== 'local') return null;
  const base = path.resolve(root);
  const target = path.resolve(base, ...ref.relativePath.split('/'));
  if (!target.startsWith(base + path.sep)) return null;

  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    // Un lien symbolique déposé dans MEDIA_ROOT ne doit pas mener ailleurs.
    const [realBase, realTarget] = await Promise.all([realpath(base), realpath(target)]);
    if (!realTarget.startsWith(realBase + path.sep)) return null;
    handle = await open(realTarget, 'r');
    const info = await handle.stat();
    if (!info.isFile() || info.size === 0 || info.size > maxBytes) return null;
    return await handle.readFile();
  } catch {
    return null;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}
