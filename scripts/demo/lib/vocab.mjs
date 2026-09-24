// =====================================================================
// Rangvia — les textes que le tournage attend à l'écran
// ---------------------------------------------------------------------
// Principe ([SEO § 10.1, règle 5]) : chaque étape attend un texte RÉEL de
// l'interface. Pour qu'une vidéo ne puisse pas survivre à un changement
// du produit, ces textes ne sont pas recopiés ici :
//
//  - ceux qui vivent dans un vocabulaire (`lib/copy.ts`,
//    `lib/profiles/*.ts`) sont IMPORTÉS depuis ce vocabulaire (Node lit
//    le TypeScript en retirant les types ; les imports `@/…` de ces
//    fichiers sont des imports de types, effacés) ;
//  - ceux qui n'existent que dans un composant (« Je suis de retour »)
//    passent par `ui(fichier, texte)`, qui vérifie qu'ils figurent
//    MOT POUR MOT dans le source du composant avant de les attendre.
//
// Si le produit change un texte, le tournage échoue ici ou à l'étape
// concernée, au lieu de produire une vidéo fausse.
// =====================================================================

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { WEB_ROOT } from '../bench/guard.mjs';

const SRC = join(WEB_ROOT, 'src');
const load = (...parts) => import(pathToFileURL(join(SRC, ...parts)).href);

const copy = await load('lib', 'copy.ts');
const { walkin } = await load('lib', 'profiles', 'walkin.ts');
const { event } = await load('lib', 'profiles', 'event.ts');

export const {
  CLIENT_STATUS_LABEL,
  STAFF_STATUS_LABEL,
  QUEUE_STATUS_LABEL,
  notificationCopy,
  peopleAheadLabel,
  waitingCountLabel,
} = copy;
export const profiles = { walkin, event };

const sources = new Map();

/**
 * Un texte propre à un composant, vérifié dans son source. `file` est
 * relatif à `apps/web/src`.
 */
export function ui(file, text) {
  if (!sources.has(file)) sources.set(file, readFileSync(join(SRC, file), 'utf8'));
  if (!sources.get(file).includes(text)) {
    throw new Error(`le texte « ${text} » n’est plus dans ${file} : le produit a changé, le scénario doit suivre.`);
  }
  return text;
}
