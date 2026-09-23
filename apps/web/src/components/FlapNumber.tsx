'use client';

import { Fragment, useEffect, useState } from 'react';
import { useReducedMotion } from './motion/useMotionPreference';

/**
 * LE VOLET v2 — un vrai tableau à palettes, à demi-cellules.
 *
 * Le chiffre ne se remplace pas : il tombe. La moitié haute de l'ancien
 * caractère bascule vers l'avant (180 ms), puis la moitié basse du nouveau
 * arrive (240 ms, après 180 ms). On ne voit JAMAIS deux caractères entiers
 * superposés : seulement des demi-cellules (CSS : globals.css, §3.7).
 *
 * Seules les cellules qui changent tombent, et directement vers la valeur
 * finale : pas de palettes intermédiaires. Un saut 4 → 1 ne joue qu'une
 * chute ; un nouveau changement pendant une chute la relance. Au bout de
 * 440 ms, la cellule revient à une seule couche. En mouvement réduit, le
 * remplacement est instantané, sans couche supplémentaire.
 *
 * Le premier rendu (serveur compris) affiche la valeur, en une couche par
 * cellule : aucun écart d'hydratation.
 */

const FLIP_MS = 440;

interface CellState {
  shown: string;
  from: string | null;
  id: number;
}

interface FlapCellProps {
  ch: string;
  instant: boolean;
  fixed: boolean;
  tile: boolean;
  /** Décalage de la chute de cette cellule (ms). */
  delay: number;
}

function FlapCell({ ch, instant, fixed, tile, delay }: FlapCellProps) {
  const [state, setState] = useState<CellState>({ shown: ch, from: null, id: 0 });

  // Ajustement pendant le rendu (et non dans un effet) : la chute commence
  // dès l'image où la valeur change, sans une image de retard.
  if (state.shown !== ch) {
    setState({ shown: ch, from: instant ? null : state.shown, id: state.id + 1 });
  }

  const flipping = state.from !== null;
  useEffect(() => {
    if (!flipping) return;
    const id = state.id;
    const timer = setTimeout(() => {
      setState((s) => (s.id === id ? { ...s, from: null } : s));
    }, FLIP_MS + delay);
    return () => clearTimeout(timer);
  }, [flipping, state.id, delay]);

  const className = `flap${fixed ? '' : ' flap--auto'}${tile ? ' flap--tile' : ''}`;
  const style = delay > 0 ? ({ ['--flap-delay' as string]: `${delay}ms` } as React.CSSProperties) : undefined;
  const glyph = (c: string) => (c === ' ' ? ' ' : c);

  return (
    <span className={className} style={style}>
      {state.from === null ? (
        <span className="flap__face">{glyph(state.shown)}</span>
      ) : (
        <Fragment key={state.id}>
          <span className="flap__face flap__top">{glyph(state.shown)}</span>
          <span className="flap__face flap__bottom">{glyph(state.from)}</span>
          <span className="flap__face flap__top flap__flipTop">{glyph(state.from)}</span>
          <span className="flap__face flap__bottom flap__flipBottom">{glyph(state.shown)}</span>
        </Fragment>
      )}
    </span>
  );
}

interface FlapRowProps {
  chars: Array<{ key: string; ch: string; delay: number }>;
  size?: string;
  label: string;
  isStatic?: boolean;
  fixed: boolean;
  tile: boolean;
}

function FlapRow({ chars, size, label, isStatic, fixed, tile }: FlapRowProps) {
  const reduced = useReducedMotion();
  const style = size ? ({ ['--flap-size' as string]: size } as React.CSSProperties) : undefined;
  const rowClass = `row flap-row${tile ? ' flap-row--tile' : ''}`;
  const cells = chars.map(({ key, ch, delay }) => (
    <FlapCell key={key} ch={ch} instant={reduced} fixed={fixed} tile={tile} delay={delay} />
  ));

  if (isStatic) {
    return (
      <span className={rowClass} style={style}>
        <span className="sr-only">{label}</span>
        <span className="flap-row" aria-hidden="true">
          {cells}
        </span>
      </span>
    );
  }
  return (
    <span className={rowClass} style={style} role="status" aria-live="polite" aria-label={label}>
      <span className="flap-row" aria-hidden="true">
        {cells}
      </span>
    </span>
  );
}

export interface FlapNumberProps {
  value: number;
  /** Pilote --flap-size. */
  size?: string;
  /** aria-label ; défaut String(value). */
  label?: string;
  /** Décoratif ou répété : ni role="status" ni aria-live ; rend <span class="sr-only">{label}</span> + cellules aria-hidden. */
  static?: boolean;
  /** Nombre minimal de chiffres (ex. 2 → « 03 »). */
  pad?: number;
  /** Cellules sur tuile encre avec charnière (TV, prix, code d'appairage). */
  tile?: boolean;
}

/** Le compteur signature : un nombre entier positif en volet à palettes. */
export function FlapNumber({ value, size, label, static: isStatic, pad, tile = false }: FlapNumberProps): React.JSX.Element {
  const safe = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  const digits = String(safe).padStart(Math.max(1, pad ?? 1), '0');
  // Clés comptées depuis la droite : les unités restent les unités quand
  // le nombre de chiffres change (10 → 9 ne fait tomber qu'une cellule).
  const chars = Array.from(digits).map((ch, i) => ({ key: `d${digits.length - i}`, ch, delay: 0 }));
  return (
    <FlapRow
      chars={chars}
      size={size}
      label={label ?? String(value)}
      isStatic={isStatic}
      fixed
      tile={tile}
    />
  );
}

export interface FlapTextProps {
  /** Ex. « 12 min », « CAMILLE », « 482193 ». */
  text: string;
  size?: string;
  /** Défaut : text. */
  label?: string;
  static?: boolean;
  /** Cellules de largeur fixe 0.68em (tableau de gare) ; défaut false = proportionnel (.flap--auto). */
  fixed?: boolean;
  tile?: boolean;
  /** ms entre cellules, défaut 40, plafonné à 420 ms au total. */
  stagger?: number;
}

/** Un texte court en volet à palettes : chaque caractère qui change tombe, en cascade. */
export function FlapText({
  text,
  size,
  label,
  static: isStatic,
  fixed = false,
  tile = false,
  stagger = 40,
}: FlapTextProps): React.JSX.Element {
  const glyphs = Array.from(text);
  const n = glyphs.length;
  const step = n > 1 ? Math.min(Math.max(0, stagger), 420 / (n - 1)) : 0;
  // Proportionnel (« 12 min », prix) : cellules comptées depuis la droite,
  // l'unité ne bouge pas quand le nombre raccourcit. Fixe (prénom, code) :
  // depuis la gauche, comme un tableau de gare.
  const chars = glyphs.map((ch, i) => ({
    key: fixed ? `c${i}` : `r${n - i}`,
    ch,
    delay: Math.round(i * step),
  }));
  return (
    <FlapRow
      chars={chars}
      size={size}
      label={label ?? text}
      isStatic={isStatic}
      fixed={fixed}
      tile={tile}
    />
  );
}
