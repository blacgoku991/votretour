import type { QueueProfile } from '@/lib/profiles/types';
import styles from './signatures.module.css';

/**
 * L'OBJET DU COMPTOIR — ce qui distingue une « Réception » d'une autre.
 *
 * Tant que le profil d'un métier n'est pas ouvert, sa signature est la
 * file du comptoir d'aujourd'hui (Reception). Seule, elle se lirait comme
 * la scène du héros, quelques écrans plus haut. On pose donc à côté de la
 * file UN objet du métier, dessiné dans la matière des objets du produit
 * (os et encre, tranche en relief, aucune ombre floue) :
 *
 *  - garages : le trousseau et son étiquette, laissés à la réception ;
 *  - réparation : le téléphone à l'écran fêlé, posé au dépôt ;
 *  - restaurants : l'ardoise de la porte, avec le QR de la liste ;
 *  - guichets : le rouleau de tickets, barré — il n'y en a plus ;
 *  - salons : la pile de magazines, barrée — personne n'attend plus assis.
 *
 * Aucun de ces objets ne montre une fonction non livrée : ce sont des
 * choses du commerce, pas des écrans du produit. Le cadrage de la file
 * change avec l'objet (inclinaison, sens, côté), pour que deux métiers ne
 * se ressemblent pas. Composant serveur, sans JavaScript ; décoratif, la
 * légende est lue.
 */

export type ReceptionPropKind = 'keys' | 'phone' | 'slate' | 'tickets' | 'magazines';

export interface ReceptionFraming {
  prop: ReceptionPropKind;
  /** De quel côté du panneau l'objet est posé ; la file se décale de l'autre. */
  side: 'left' | 'right';
  tilt: number;
  turn: number;
  caption: string;
}

/** Le cadrage de chaque profil. `null` : la file seule (barbiers, événements…). */
export const RECEPTION_FRAMING: Partial<Record<QueueProfile, ReceptionFraming>> = {
  vehicle: { prop: 'keys', side: 'right', tilt: 54, turn: 7, caption: 'Les clés au comptoir, le client ailleurs' },
  device: { prop: 'phone', side: 'left', tilt: 52, turn: -6, caption: 'Dépôt, retrait, diagnostic : une file' },
  table: { prop: 'slate', side: 'left', tilt: 50, turn: -4, caption: 'Sur l’ardoise de la porte, le QR de la liste' },
  desk: { prop: 'tickets', side: 'right', tilt: 56, turn: 3, caption: 'Plus de rouleau de tickets' },
};

/** Salons (walkin) : l'objet vient du seuil, le profil étant celui des barbiers. */
export const SALON_FRAMING: ReceptionFraming = {
  prop: 'magazines',
  side: 'right',
  tilt: 55,
  turn: 5,
  caption: 'Plus de pile de magazines',
};

function Keys() {
  return (
    <svg viewBox="0 0 160 120" className={styles.propSvg} aria-hidden="true">
      {/* Anneau, puis la clé qui y pend. */}
      <circle cx="46" cy="44" r="17" fill="none" strokeWidth="4" style={{ stroke: 'var(--bone-400)' }} />
      <g transform="rotate(28 46 44)">
        <rect x="40" y="58" width="12" height="44" rx="3" style={{ fill: 'var(--bone-400)' }} />
        <rect x="52" y="84" width="8" height="5" rx="1.5" style={{ fill: 'var(--bone-400)' }} />
        <rect x="52" y="93" width="6" height="5" rx="1.5" style={{ fill: 'var(--bone-400)' }} />
        <circle cx="46" cy="60" r="11" style={{ fill: 'var(--bone-300)' }} />
        <circle cx="46" cy="60" r="4" style={{ fill: 'var(--floor)' }} />
      </g>
      {/* L'étiquette cartonnée : tranche d'os, œillet, numéro de place. */}
      <g transform="rotate(-9 104 52)">
        <rect x="70" y="34" width="78" height="46" rx="7" style={{ fill: 'var(--bone-500)' }} />
        <rect x="70" y="30" width="78" height="46" rx="7" style={{ fill: 'var(--bone-100)' }} />
        <circle cx="82" cy="53" r="4.5" style={{ fill: 'var(--floor)' }} />
        <path d="M63 44 Q72 50 82 53" strokeWidth="2" fill="none" style={{ stroke: 'var(--bone-400)' }} />
        <text x="96" y="49" className={styles.propTiny} style={{ fill: 'var(--ink-400)' }}>
          PLACE
        </text>
        <text x="95" y="68" className={styles.propBig} style={{ fill: 'var(--ink-900)' }}>
          14
        </text>
      </g>
    </svg>
  );
}

function Phone() {
  return (
    <svg viewBox="0 0 160 120" className={styles.propSvg} aria-hidden="true">
      {/* Couché sur le comptoir, écran vers le haut : corps d'encre, bord d'os. */}
      <g transform="rotate(-14 80 60)">
        <rect x="46" y="14" width="64" height="100" rx="12" style={{ fill: 'var(--ink-400)' }} />
        <rect x="46" y="10" width="64" height="100" rx="12" strokeWidth="1.5" style={{ fill: 'var(--ink-600)', stroke: 'var(--bone-500)' }} />
        <rect x="52" y="18" width="52" height="84" rx="7" style={{ fill: 'var(--ink-1000)' }} />
        <rect x="70" y="22" width="16" height="4" rx="2" style={{ fill: 'var(--ink-600)' }} />
        {/* La fêlure : un point d'impact et ses éclats. */}
        <path
          d="M88 44 L72 58 L78 66 L60 88 M88 44 L98 36 M88 44 L100 58 L96 74 M72 58 L58 54 M78 66 L90 82"
         
          strokeOpacity="0.7"
          strokeWidth="1.4"
          strokeLinejoin="round"
          fill="none" style={{ stroke: 'var(--bone-200)' }} />
        <circle cx="88" cy="44" r="2.4" fillOpacity="0.8" style={{ fill: 'var(--bone-200)' }} />
      </g>
      {/* L'étiquette de dépôt, attachée par un fil. */}
      <g transform="rotate(10 128 86)">
        <path d="M104 74 Q114 78 118 84" strokeWidth="1.6" fill="none" style={{ stroke: 'var(--bone-400)' }} />
        <rect x="110" y="80" width="46" height="26" rx="4" style={{ fill: 'var(--bone-500)' }} />
        <rect x="110" y="77" width="46" height="26" rx="4" style={{ fill: 'var(--bone-100)' }} />
        <circle cx="116" cy="84" r="2.2" style={{ fill: 'var(--floor)' }} />
        <text x="122" y="95" className={styles.propTiny} style={{ fill: 'var(--ink-700)' }}>
          DÉPÔT
        </text>
      </g>
    </svg>
  );
}

function Slate() {
  // Un QR stylisé (motif fixe, trois repères) : on ne dessine pas un vrai
  // code sur une ardoise fictive.
  const finders: ReadonlyArray<readonly [number, number]> = [[0, 0], [22, 0], [0, 22]];
  const modules: ReadonlyArray<readonly [number, number]> = [
    [11, 0], [15, 4], [11, 8], [15, 11], [0, 11], [4, 15], [8, 11], [11, 15],
    [22, 11], [26, 15], [18, 18], [22, 22], [26, 26], [15, 26], [18, 29], [11, 22], [29, 18],
  ];
  return (
    <svg viewBox="0 0 160 150" className={styles.propSvg} aria-hidden="true">
      {/* Les pieds du chevalet, derrière l'ardoise. */}
      <path d="M52 112 L42 146 M108 112 L118 146" strokeOpacity="0.55" strokeWidth="5" strokeLinecap="round" style={{ stroke: 'var(--copper-500)' }} />
      {/* Cadre de bois, tranche, puis l'ardoise. */}
      <rect x="28" y="10" width="104" height="108" rx="8" style={{ fill: 'color-mix(in oklab, var(--copper-500) 45%, var(--ink-900))' }} />
      <rect x="28" y="6" width="104" height="108" rx="8" style={{ fill: 'color-mix(in oklab, var(--copper-500) 70%, var(--ink-700))' }} />
      <rect x="36" y="14" width="88" height="92" rx="4" style={{ fill: 'var(--ink-700)' }} />
      <text x="80" y="34" textAnchor="middle" className={styles.propChalk} fillOpacity="0.9" style={{ fill: 'var(--bone-100)' }}>
        {'COMPLET\u202f?'}
      </text>
      <path d="M52 41 H108" strokeOpacity="0.35" strokeWidth="1.5" strokeLinecap="round" style={{ stroke: 'var(--bone-100)' }} />
      <text x="80" y="56" textAnchor="middle" className={styles.propTiny} fillOpacity="0.7" style={{ fill: 'var(--bone-100)' }}>
        LISTE D’ATTENTE
      </text>
      <g transform="translate(62 64)">
        <rect x="-4" y="-4" width="44" height="44" rx="3" style={{ fill: 'var(--bone-100)' }} />
        {finders.map(([x, y]) => (
          <g key={`f${x}-${y}`} transform={`translate(${x} ${y})`}>
            <rect x="0.9" y="0.9" width="12.2" height="12.2" rx="1.6" fill="none" strokeWidth="1.8" style={{ stroke: 'var(--ink-800)' }} />
            <rect x="4" y="4" width="6" height="6" rx="0.8" style={{ fill: 'var(--ink-800)' }} />
          </g>
        ))}
        {modules.map(([x, y]) => (
          <rect key={`m${x}-${y}`} x={x} y={y} width="3.4" height="3.4" rx="0.6" style={{ fill: 'var(--ink-800)' }} />
        ))}
      </g>
    </svg>
  );
}

function Tickets() {
  return (
    <svg viewBox="0 0 160 130" className={styles.propSvg} aria-hidden="true">
      {/* Le distributeur mural, et la langue de papier qui en sort. */}
      <g opacity="0.62">
        <rect x="30" y="16" width="100" height="42" rx="10" style={{ fill: 'var(--ink-400)' }} />
        <rect x="30" y="12" width="100" height="42" rx="10" strokeOpacity="0.5" style={{ fill: 'var(--ink-600)', stroke: 'var(--bone-500)' }} />
        <rect x="46" y="44" width="68" height="5" rx="2.5" style={{ fill: 'var(--ink-1000)' }} />
        <path d="M50 47 H110 V106 L102.5 101 L95 106 L87.5 101 L80 106 L72.5 101 L65 106 L57.5 101 L50 106 Z" style={{ fill: 'var(--bone-200)' }} />
        <text x="80" y="64" textAnchor="middle" className={styles.propTiny} style={{ fill: 'var(--ink-400)' }}>
          TICKET
        </text>
        <text x="80" y="89" textAnchor="middle" className={styles.propBig} style={{ fill: 'var(--ink-800)', fontSize: 18 }}>
          047
        </text>
      </g>
      {/* Barré : il n'y a plus de ticket papier. */}
      <path d="M24 114 L136 16" strokeWidth="5" strokeLinecap="round" style={{ stroke: 'var(--bone-100)' }} />
      <path d="M24 114 L136 16" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.6" style={{ stroke: 'var(--floor)' }} />
    </svg>
  );
}

function Magazines() {
  return (
    <svg viewBox="0 0 160 120" className={styles.propSvg} aria-hidden="true">
      <g opacity="0.62">
        <g transform="rotate(8 80 64)">
          <rect x="36" y="30" width="84" height="66" rx="4" style={{ fill: 'var(--bone-500)' }} />
          <rect x="36" y="27" width="84" height="66" rx="4" style={{ fill: 'var(--bone-300)' }} />
        </g>
        <g transform="rotate(-6 80 60)">
          <rect x="40" y="24" width="84" height="66" rx="4" style={{ fill: 'var(--bone-500)' }} />
          <rect x="40" y="21" width="84" height="66" rx="4" style={{ fill: 'var(--bone-100)' }} />
          <rect x="48" y="30" width="44" height="7" rx="2" style={{ fill: 'var(--ink-700)' }} />
          <rect x="48" y="42" width="30" height="4" rx="2" style={{ fill: 'var(--ink-300)' }} />
          <rect x="48" y="50" width="36" height="4" rx="2" style={{ fill: 'var(--ink-300)' }} />
          <rect x="94" y="44" width="22" height="34" rx="3" style={{ fill: 'var(--bone-400)' }} />
        </g>
      </g>
      <path d="M26 104 L134 16" strokeWidth="5" strokeLinecap="round" style={{ stroke: 'var(--bone-100)' }} />
      <path d="M26 104 L134 16" strokeWidth="1.5" strokeLinecap="round" strokeOpacity="0.6" style={{ stroke: 'var(--floor)' }} />
    </svg>
  );
}

const PROPS: Record<ReceptionPropKind, () => React.JSX.Element> = {
  keys: Keys,
  phone: Phone,
  slate: Slate,
  tickets: Tickets,
  magazines: Magazines,
};

/** L'objet posé au sol, et sa légende (lue ; le dessin, lui, est décoratif). */
export function ReceptionProp({ framing }: { framing: ReceptionFraming }): React.JSX.Element {
  const Drawing = PROPS[framing.prop];
  return (
    <figure className={styles.prop} data-side={framing.side} data-prop={framing.prop}>
      <Drawing />
      <figcaption className={`t-label ${styles.propCaption}`}>{framing.caption}</figcaption>
    </figure>
  );
}
