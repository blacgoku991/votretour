/**
 * DÉTAILS D'UN TICKET — colonne `queue_entries.details` (jsonb, 2 Ko au plus).
 *
 * Premier des deux contrôles : zod ici, à l'entrée du serveur Next ; puis
 * `internal.clean_details` en SQL, en défense en profondeur. Les deux
 * appliquent la même liste blanche :
 *
 *  - une clé inconnue est REFUSÉE, pas ignorée : un champ « code » ajouté
 *    par erreur dans un formulaire d'atelier ne doit jamais atterrir en
 *    base (le code de déverrouillage d'un téléphone n'est jamais demandé) ;
 *  - les textes libres sont nettoyés (caractères de contrôle, espaces) et
 *    TRONQUÉS à leur longueur : on garde ce que le client a écrit plutôt
 *    que de lui renvoyer une erreur pour trois caractères de trop ;
 *  - certaines clés sont réservées au pro (`keys`, `readyEta`,
 *    `accessories`) ; le devis (`quote`) n'est posé que par l'action
 *    `send_quote`, jamais par ce chemin, ni par le client ni par le pro ;
 *  - une file `sensitive` (santé) n'accepte AUCUN texte libre : le motif
 *    y est choisi dans la liste du pro (données de santé, RGPD art. 9).
 *
 * Ce que l'on ne demande jamais : téléphone, e-mail, VIN, kilométrage,
 * adresse, IMEI, numéro de série, code de déverrouillage, allergies.
 */

import { z } from 'zod';
import { PARTY_MAX_LIMIT } from './options';
import { normalizeRegistration, parseRegistration } from './registration';
import type { EntryDetails, ProfileOptions, QueueProfile } from './types';

export const DETAILS_MAX_BYTES = 2048;

export const TEXT_LIMITS = {
  model: 40,
  reasonText: 80,
  orderRef: 24,
  registration: 20,
} as const;

/** Clés de texte libre : interdites dans une file `sensitive`. */
export const FREE_TEXT_KEYS = ['model', 'reasonText', 'orderRef'] as const;

/** Clés que seul le pro peut poser. */
export const STAFF_ONLY_KEYS = ['keys', 'readyEta', 'accessories'] as const;

export const DEVICE_KINDS = ['phone', 'tablet', 'computer', 'console', 'watch', 'other'] as const;
export const DEVICE_ACCESSORIES = ['charger', 'case', 'sim_removed', 'memory_card', 'box'] as const;
export const TABLE_SEATINGS = ['any', 'indoor', 'terrace'] as const;
export const TABLE_NEEDS = ['highchair', 'accessible'] as const;

export type DetailsActor = 'client' | 'staff';

/**
 * Nettoyage d'un texte libre : normalisation Unicode, caractères de
 * contrôle et de largeur nulle retirés, espaces resserrés, puis coupe à
 * `max` caractères (points de code, pas unités UTF-16 : un émoji ne se
 * coupe pas en deux).
 */
export function cleanText(value: string, max: number): string {
  const cleaned = value
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(cleaned).slice(0, max).join('').trim();
}

const text = (max: number) =>
  z
    .string()
    // Borne d'entrée large (la coupe se fait après nettoyage) mais finie :
    // on ne nettoie pas un mégaoctet.
    .max(max * 4)
    .transform((s) => cleanText(s, max))
    .pipe(z.string().min(1, 'Champ vide.'));

function uniqueArray<T extends string>(values: readonly [T, ...T[]], max: number) {
  return z
    .array(z.enum(values))
    .max(max)
    .transform((arr) => [...new Set(arr)]);
}

const readyEta = z.union([z.iso.datetime({ offset: true }), z.null()]);

export interface DetailsSchemaOptions {
  actor?: DetailsActor;
  options?: ProfileOptions;
}

function shapeFor(profile: QueueProfile, actor: DetailsActor, options: ProfileOptions) {
  const staff = actor === 'staff';
  switch (profile) {
    case 'vehicle':
      return {
        registration: z.string().max(TEXT_LIMITS.registration * 2),
        country: z.enum(['FR', 'other']),
        model: text(TEXT_LIMITS.model),
        reasonText: text(TEXT_LIMITS.reasonText),
        stay: z.enum(['away', 'onsite']),
        ...(staff ? { keys: z.boolean(), readyEta } : {}),
      };
    case 'device':
      return {
        deviceKind: z.enum(DEVICE_KINDS),
        model: text(TEXT_LIMITS.model),
        reasonText: text(TEXT_LIMITS.reasonText),
        ...(staff ? { accessories: uniqueArray(DEVICE_ACCESSORIES, DEVICE_ACCESSORIES.length), readyEta } : {}),
      };
    case 'table': {
      // En ligne, le plafond réglé (12 par défaut) ; au comptoir, le pro
      // peut inscrire un grand groupe venu se présenter à l'accueil.
      const max = staff ? PARTY_MAX_LIMIT : Math.min(options.partyMax ?? 12, PARTY_MAX_LIMIT);
      return {
        partySize: z.number().int().min(1).max(max),
        seating: z.enum(TABLE_SEATINGS),
        needs: uniqueArray(TABLE_NEEDS, TABLE_NEEDS.length),
      };
    }
    case 'retail':
      return {
        orderRef: z
          .string()
          .max(TEXT_LIMITS.orderRef * 4)
          .transform((s) => cleanText(s, TEXT_LIMITS.orderRef).toUpperCase())
          .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9 ./-]*$/, 'Numéro de commande invalide.')),
      };
    case 'desk':
    case 'walkin':
    case 'event':
      // Le motif d'un guichet est `service_id` : aucun détail libre.
      return {};
  }
}

/**
 * Schéma des détails d'un profil. Toutes les clés sont facultatives, sauf
 * l'immatriculation d'un dépôt fait par le client quand la file l'exige
 * (`registrationRequired`, vrai par défaut).
 */
export function detailsSchemaFor(profile: QueueProfile, settings: DetailsSchemaOptions = {}) {
  const actor = settings.actor ?? 'client';
  const options = settings.options ?? {};
  const shape = shapeFor(profile, actor, options);
  const optionalShape = Object.fromEntries(
    Object.entries(shape).map(([k, v]) => [k, (v as z.ZodType).optional()]),
  );

  return z
    .object(optionalShape)
    .strict()
    .superRefine((value, ctx) => {
      const record = value as Record<string, unknown>;
      if (options.sensitive) {
        for (const key of FREE_TEXT_KEYS) {
          if (record[key] !== undefined) {
            ctx.addIssue({ code: 'custom', path: [key], message: 'Aucun texte libre dans cette file.' });
          }
        }
      }
      if (profile === 'vehicle') {
        const raw = record.registration;
        if (typeof raw === 'string' && raw.trim() !== '') {
          const parsed = parseRegistration(raw, record.country === 'other' ? 'other' : 'FR');
          if (!parsed.ok) ctx.addIssue({ code: 'custom', path: ['registration'], message: parsed.reason });
        } else if (actor === 'client' && options.registrationRequired !== false) {
          ctx.addIssue({ code: 'custom', path: ['registration'], message: 'Saisissez l’immatriculation.' });
        }
      }
    })
    .transform((value) => {
      const record = { ...(value as Record<string, unknown>) };
      // L'immatriculation est stockée sous sa forme d'affichage canonique.
      if (profile === 'vehicle' && typeof record.registration === 'string') {
        const country = record.country === 'other' ? 'other' : 'FR';
        const parsed = parseRegistration(record.registration, country);
        if (parsed.ok) {
          record.registration = parsed.display;
          record.country = country;
        } else {
          delete record.registration;
        }
      }
      return record as EntryDetails;
    })
    .refine(
      (value) => new TextEncoder().encode(JSON.stringify(value)).length <= DETAILS_MAX_BYTES,
      'Informations trop volumineuses.',
    );
}

/** Clé de recherche dérivée (`registration_key`), ou null. */
export function registrationKeyOf(details: EntryDetails | null | undefined): string | null {
  const key = normalizeRegistration(details?.registration);
  return key.length >= 2 ? key : null;
}
