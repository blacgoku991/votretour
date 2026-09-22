'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * LE VOLET — le compteur signature de VotreTour.
 *
 * Le chiffre ne se remplace pas : il tombe, comme la lamelle d'un
 * tableau d'affichage de gare. C'est le geste qui fait comprendre, sans
 * un mot, que la place vient d'avancer.
 *
 * Chaque rang de chiffre s'anime indépendamment : passer de 10 à 9 ne
 * fait pas rouler le chiffre des unités pour rien.
 */

interface FlapDigitProps {
  digit: string;
  index: number;
}

function FlapDigit({ digit, index }: FlapDigitProps) {
  const [current, setCurrent] = useState(digit);
  const [previous, setPrevious] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (digit === current) return;
    setPrevious(current);
    setCurrent(digit);
    if (timer.current) clearTimeout(timer.current);
    // Doit correspondre à --dur-3 dans globals.css.
    timer.current = setTimeout(() => setPrevious(null), 440);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [digit, current]);

  return (
    <span className="flap" aria-hidden="true">
      {previous !== null && (
        <span
          key={`out-${previous}-${index}`}
          className="flap__cell flap__cell--out"
        >
          {previous}
        </span>
      )}
      <span
        key={`in-${current}-${index}`}
        className={previous !== null ? 'flap__cell flap__cell--in' : 'flap__cell'}
      >
        {current}
      </span>
    </span>
  );
}

export interface FlapNumberProps {
  value: number;
  /** Taille du chiffre : pilote --flap-size. */
  size?: string;
  label?: string;
}

export function FlapNumber({ value, size, label }: FlapNumberProps) {
  const digits = String(Math.max(0, Math.round(value))).split('');

  return (
    <span
      className="row"
      style={size ? ({ ['--flap-size' as string]: size } as React.CSSProperties) : undefined}
      role="status"
      aria-live="polite"
      aria-label={label ?? String(value)}
    >
      {digits.map((digit, index) => (
        <FlapDigit key={`slot-${index}`} digit={digit} index={index} />
      ))}
    </span>
  );
}
