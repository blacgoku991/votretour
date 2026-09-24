/**
 * MODÈLES DE MESSAGES — ce que le pro envoie en un geste.
 *
 * Les défauts vivent dans le code (`<profil>.ts`, clé `templates`) ; le pro
 * les surcharge dans Réglages (table `message_templates`). Un message part
 * sur l'écran verrouillé du client, sous le nom du commerce : un compte pro
 * compromis ne doit pas pouvoir en faire un outil d'hameçonnage. D'où des
 * contrôles stricts, appliqués à l'enregistrement ET à l'envoi :
 *
 *  - 180 caractères au plus, avant comme après le remplacement des variables ;
 *  - des variables sur liste blanche seulement : `{heure_fermeture}` oui,
 *    `{prenom}` non (jamais de prénom sur l'écran verrouillé) ;
 *  - AUCUNE adresse web : ni `https://`, ni `www.`, ni domaine nu (`bit.ly/x`,
 *    `exemple.fr`). Le client ouvre le suivi en touchant la notification ;
 *  - la typographie française est rétablie (apostrophe ’).
 */

import { getProfile } from './index';
import type { QueueProfile, TemplateDef } from './types';

export const TEMPLATE_MAX_LENGTH = 180;
export const TEMPLATE_LABEL_MAX = 40;
export const TEMPLATE_KEY_RE = /^[a-z0-9_]{2,40}$/;

export interface TemplateVariable {
  name: string;
  /** Libellé de la puce cliquable dans Réglages. */
  label: string;
  /** Valeur d'exemple pour l'aperçu « écran verrouillé ». */
  sample: string;
  /** Profils où la variable a un sens ; absent = tous. */
  profiles?: readonly QueueProfile[];
}

/**
 * Liste blanche. Aucune ne porte de donnée personnelle du client : ce sont
 * des informations du COMMERCE (nom, téléphone, horaires) ou du ticket déjà
 * visibles par le client (numéro, guichet, modèle qu'il a lui-même saisi).
 */
export const TEMPLATE_VARIABLES: readonly TemplateVariable[] = [
  { name: 'etablissement', label: 'Nom de l’établissement', sample: 'Garage des Tilleuls' },
  { name: 'telephone_etablissement', label: 'Téléphone', sample: '01 23 45 67 89' },
  { name: 'heure_fermeture', label: 'Heure de fermeture', sample: '19\u00a0h\u00a000' },
  { name: 'heure_ouverture', label: 'Heure d’ouverture', sample: '08\u00a0h\u00a030' },
  { name: 'modele', label: 'Modèle', sample: 'Peugeot 208', profiles: ['vehicle', 'device'] },
  { name: 'numero', label: 'Numéro de ticket', sample: 'A-042', profiles: ['desk', 'device', 'retail'] },
  { name: 'guichet', label: 'Guichet', sample: 'Guichet 3', profiles: ['desk'] },
  { name: 'couverts', label: 'Couverts', sample: '4', profiles: ['table'] },
];

const VARIABLE_RE = /\{([^{}]*)\}/g;

/**
 * Détecte une adresse web. Volontairement large : un faux positif oblige
 * le pro à reformuler, un faux négatif laisse passer un lien piégé.
 * « 19 h 00 », « 184,00 € » ou « n° 12.5 » ne déclenchent rien : il faut
 * une suite de lettres d'au moins deux caractères après le point.
 */
const URL_PATTERNS: readonly RegExp[] = [
  /\b[a-z][a-z0-9+.-]*:\/\//i, // https://, ftp://…
  /\bwww\./i,
  /\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:[a-z]{2,24})(?:\/|\b)(?![a-zà-ÿ])/i,
];

export function containsUrl(text: string): boolean {
  return URL_PATTERNS.some((re) => re.test(text));
}

/** Rétablit l'apostrophe typographique et resserre les espaces. */
export function typographie(text: string): string {
  return text
    .replace(/(\p{L})'(?=\p{L})/gu, '$1’')
    .replace(/(^|\s)'(?=\p{L})/gu, '$1’')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export function variablesFor(profile: QueueProfile): TemplateVariable[] {
  return TEMPLATE_VARIABLES.filter((v) => !v.profiles || v.profiles.includes(profile));
}

export interface TemplateCheck {
  ok: boolean;
  errors: string[];
  /** Variables employées, dans l'ordre d'apparition, sans doublon. */
  variables: string[];
}

/** Contrôle d'un modèle avant enregistrement (et avant chaque envoi). */
export function validateTemplateBody(body: string, profile: QueueProfile): TemplateCheck {
  const errors: string[] = [];
  const allowed = new Set(variablesFor(profile).map((v) => v.name));
  const used: string[] = [];

  const trimmed = body.trim();
  if (trimmed.length === 0) errors.push('Le message est vide.');
  if (Array.from(trimmed).length > TEMPLATE_MAX_LENGTH) {
    errors.push(`${TEMPLATE_MAX_LENGTH} caractères au plus.`);
  }
  for (const match of trimmed.matchAll(VARIABLE_RE)) {
    const name = (match[1] ?? '').trim();
    if (!allowed.has(name)) {
      errors.push(`Variable inconnue : {${name}}.`);
    } else if (!used.includes(name)) {
      used.push(name);
    }
  }
  // Accolade orpheline : on ne devine pas ce que le pro voulait écrire.
  if (/[{}]/.test(trimmed.replace(VARIABLE_RE, ''))) errors.push('Accolade sans variable.');
  if (containsUrl(trimmed)) errors.push('Pas d’adresse web dans un message : le client ouvre son suivi en touchant la notification.');

  return { ok: errors.length === 0, errors, variables: used };
}

export interface RenderResult {
  /** Envoyable tel quel ? */
  ok: boolean;
  text: string;
  /** Variables sans valeur (horaires inconnus…) : l'envoi est refusé. */
  missing: string[];
  errors: string[];
}

/**
 * Remplace les variables. Une variable sans valeur n'est PAS remplacée par
 * du vide (« Nous fermons à . ») : elle est signalée, et l'envoi refusé.
 * Le texte final est recontrôlé (adresse web, longueur) : une valeur de
 * variable, comme le nom du commerce, ne doit pas faire passer un lien, ni
 * un message trop long (il est alors coupé proprement, avec « … »).
 */
export function renderTemplate(body: string, values: Partial<Record<string, string | null | undefined>>): RenderResult {
  const missing: string[] = [];
  const errors: string[] = [];
  const text = body.replace(VARIABLE_RE, (whole, rawName: string) => {
    const name = rawName.trim();
    const value = values[name];
    if (value == null || value.trim() === '') {
      if (!missing.includes(name)) missing.push(name);
      return whole;
    }
    return value.trim();
  });
  const out = typographie(text);
  const chars = Array.from(out);
  const clipped =
    chars.length > TEMPLATE_MAX_LENGTH ? `${chars.slice(0, TEMPLATE_MAX_LENGTH - 1).join('').trimEnd()}…` : out;
  if (missing.length > 0) errors.push(`Valeur manquante : ${missing.map((m) => `{${m}}`).join(', ')}.`);
  if (containsUrl(clipped)) errors.push('Pas d’adresse web dans un message.');
  if (clipped.length === 0) errors.push('Le message est vide.');
  return { ok: errors.length === 0, text: clipped, missing, errors };
}

/** Modèles par défaut d'un profil (codés en dur, surchargés en base). */
export function defaultTemplates(profile: QueueProfile): readonly TemplateDef[] {
  return getProfile(profile).templates;
}
