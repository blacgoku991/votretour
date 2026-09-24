import rawManifest from '@/lib/metiers/videos.json';

/**
 * LE MANIFESTE DES VIDÉOS DE DÉMONSTRATION — `lib/metiers/videos.json`.
 *
 * Écrit par le montage (lot V3, `scripts/demo/montage.mjs`), lu ici. Il
 * est VIDE tant qu'aucune vidéo n'a été tournée sur le vrai produit : une
 * page métier sans vidéo n'a pas de section vidéo, jamais une vidéo
 * générique déguisée ([SEO § 10.1]).
 *
 * Forme d'une entrée (contrat avec le montage) :
 *
 *   {
 *     "id": "barbiers-2026-10",          identifiant stable
 *     "metier": "barbiers",              slug de la page (/pour/<slug>)
 *     "duration": 52,                    secondes (> 0)
 *     "width": 1920, "height": 1080,
 *     "uploadDate": "2026-10-02",        date du montage (ISO)
 *     "files": {
 *       "mp4": "/videos/barbiers/demo-16x9.<hash>.mp4",      obligatoire (H.264)
 *       "webm": "/videos/barbiers/demo-16x9.<hash>.webm",    facultatif (VP9)
 *       "poster": { "jpg": "…", "webp": "…", "avif": "…" }, jpg obligatoire
 *       "teaser": { "mp4": "…", "webm": "…" }              facultatif (aperçu en boucle)
 *     },
 *     "bytes": { "mp4": 3900000, … },     facultatif (contrôlé par V3)
 *     "chapters": ["…", …]                ce que montre la vidéo, dans l'ordre
 *   }
 *
 * Tout chemin doit être local, sous `/videos/` : aucun lecteur ni fichier
 * tiers (pas de cookie tiers, pas de changement de CSP). Une entrée
 * incomplète ou douteuse est IGNORÉE plutôt qu'affichée de travers.
 */

export interface DemoVideoFiles {
  mp4: string;
  webm?: string;
  poster: { jpg: string; webp?: string; avif?: string };
  teaser?: { mp4: string; webm?: string };
}

export interface DemoVideoEntry {
  id: string;
  metier: string;
  /** Durée en secondes. */
  duration: number;
  width: number;
  height: number;
  uploadDate: string;
  files: DemoVideoFiles;
  /** Ce que montre la vidéo, étape par étape (légende et référencement). */
  chapters: readonly string[];
}

const LOCAL_VIDEO_PATH = /^\/videos\/[a-z0-9][a-z0-9/_.-]*\.(mp4|webm|jpg|jpeg|webp|avif)$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DAY = /^\d{4}-\d{2}-\d{2}/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Un chemin local sous /videos/, avec l'extension attendue ; sinon `null`. */
function localPath(value: unknown, ext: readonly string[]): string | null {
  if (typeof value !== 'string' || value.includes('..') || !LOCAL_VIDEO_PATH.test(value)) return null;
  const dot = value.lastIndexOf('.');
  return ext.includes(value.slice(dot + 1)) ? value : null;
}

function optionalPath(value: unknown, ext: readonly string[]): string | undefined | null {
  if (value === undefined) return undefined;
  return localPath(value, ext);
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/** Une entrée validée, ou `null`. */
export function parseVideoEntry(raw: unknown): DemoVideoEntry | null {
  if (!isRecord(raw) || !isRecord(raw.files)) return null;
  const { files } = raw;
  const id = typeof raw.id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(raw.id) ? raw.id : null;
  const metier = typeof raw.metier === 'string' && SLUG.test(raw.metier) ? raw.metier : null;
  const duration = positive(raw.duration);
  const width = positive(raw.width);
  const height = positive(raw.height);
  const uploadDate =
    typeof raw.uploadDate === 'string' && DAY.test(raw.uploadDate) && !Number.isNaN(Date.parse(raw.uploadDate))
      ? raw.uploadDate
      : null;
  const mp4 = localPath(files.mp4, ['mp4']);
  const webm = optionalPath(files.webm, ['webm']);
  const poster = isRecord(files.poster) ? files.poster : null;
  const jpg = poster ? localPath(poster.jpg, ['jpg', 'jpeg']) : null;
  const webp = poster ? optionalPath(poster.webp, ['webp']) : null;
  const avif = poster ? optionalPath(poster.avif, ['avif']) : null;
  const teaserRaw = files.teaser;
  let teaser: DemoVideoFiles['teaser'] | null | undefined;
  if (teaserRaw === undefined) teaser = undefined;
  else if (!isRecord(teaserRaw)) teaser = null;
  else {
    const tMp4 = localPath(teaserRaw.mp4, ['mp4']);
    const tWebm = optionalPath(teaserRaw.webm, ['webm']);
    teaser = tMp4 && tWebm !== null ? { mp4: tMp4, ...(tWebm ? { webm: tWebm } : {}) } : null;
  }
  const chapters = Array.isArray(raw.chapters)
    ? raw.chapters.filter((c): c is string => typeof c === 'string' && c.trim() !== '').map((c) => c.trim())
    : [];

  if (
    !id || !metier || !duration || !width || !height || !uploadDate || !mp4 || !jpg
    || webm === null || webp === null || avif === null || teaser === null
  ) {
    return null;
  }
  return {
    id,
    metier,
    duration,
    width,
    height,
    uploadDate,
    files: {
      mp4,
      ...(webm ? { webm } : {}),
      poster: { jpg, ...(webp ? { webp } : {}), ...(avif ? { avif } : {}) },
      ...(teaser ? { teaser } : {}),
    },
    chapters,
  };
}

/** Toutes les entrées valides ; une liste illisible vaut une liste vide. */
export function parseVideoManifest(raw: unknown): DemoVideoEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(parseVideoEntry).filter((v): v is DemoVideoEntry => v !== null);
}

const MANIFEST: readonly DemoVideoEntry[] = parseVideoManifest(rawManifest as unknown);

/** La vidéo d'un métier, s'il en a une (la plus récente) ; sinon `null`. */
export function videoForMetier(
  slug: string,
  manifest: readonly DemoVideoEntry[] = MANIFEST,
): DemoVideoEntry | null {
  let best: DemoVideoEntry | null = null;
  for (const entry of manifest) {
    if (entry.metier !== slug) continue;
    if (!best || Date.parse(entry.uploadDate) > Date.parse(best.uploadDate)) best = entry;
  }
  return best;
}

/** « 52 s », « 1 min 05 » : la durée annoncée sur le bouton. */
export function formatVideoDuration(seconds: number): string {
  const s = Math.max(1, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest === 0 ? `${m} min` : `${m} min ${String(rest).padStart(2, '0')}`;
}
