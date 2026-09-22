'use client';

import { useId, useMemo, useState } from 'react';
import styles from './Chart.module.css';

/**
 * Graphiques du tableau de bord.
 *
 * Règles appliquées, dans l'ordre :
 *  1. la forme suit le travail des données — des colonnes pour comparer
 *     des grandeurs dans le temps, des barres horizontales pour
 *     comparer des personnes, une jauge pour une proportion ;
 *  2. les deux teintes catégorielles sont attribuées dans un ORDRE FIXE
 *     et ne sont jamais recyclées ;
 *  3. barres fines (≤ 24 px), extrémité arrondie côté donnée et carrée
 *     sur la ligne de base, écart de 2 px dans la couleur de fond entre
 *     deux barres voisines, grilles en filet de 1 px ;
 *  4. légende systématique dès deux séries, étiquettes directes
 *     réservées à l'extrême — jamais un chiffre sur chaque point ;
 *  5. survol par défaut, et une vue tableau toujours accessible : le
 *     texte ne porte jamais la couleur de la série.
 */

export interface SeriesSpec {
  key: string;
  label: string;
  /** Jeton CSS : --chart-1 pour la première série, --chart-2 pour la seconde. */
  token: string;
}

export interface ChartPoint {
  label: string;
  /** Libellé long, utilisé par l'infobulle et le tableau. */
  fullLabel?: string;
  values: Record<string, number>;
}

function niceCeiling(max: number): number {
  if (max <= 0) return 4;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = magnitude * step;
    if (candidate >= max) return candidate;
  }
  return magnitude * 10;
}

/* ==================================================================
   Colonnes dans le temps
   ================================================================== */

export function ColumnChart({
  points, series, unit = '', caption, height = 220,
}: {
  points: ChartPoint[];
  series: SeriesSpec[];
  unit?: string;
  caption: string;
  height?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const tableId = useId();

  const max = useMemo(() => {
    const values = points.flatMap((p) => series.map((s) => p.values[s.key] ?? 0));
    return niceCeiling(Math.max(...values, 0));
  }, [points, series]);

  // Étiquette directe réservée au point le plus haut de la première
  // série : un chiffre sur chaque colonne ne se lit pas.
  const peakIndex = useMemo(() => {
    const first = series[0];
    if (!first) return -1;
    let best = -1;
    let bestValue = -1;
    points.forEach((p, i) => {
      const value = p.values[first.key] ?? 0;
      if (value > bestValue) { bestValue = value; best = i; }
    });
    return bestValue > 0 ? best : -1;
  }, [points, series]);

  if (points.length === 0) {
    return <p className={`t-small t-muted ${styles.empty}`}>Pas encore de données sur cette période.</p>;
  }

  const ticks = [0, 0.5, 1].map((ratio) => Math.round(max * ratio));

  return (
    <figure className={styles.figure}>
      <figcaption className="sr-only">{caption}</figcaption>

      {series.length > 1 && (
        <div className={styles.legend}>
          {series.map((s) => (
            <span key={s.key} className={styles.legendItem}>
              <span className={styles.swatch} style={{ background: `var(${s.token})` }} />
              {s.label}
            </span>
          ))}
        </div>
      )}

      <div className={styles.plot} style={{ height }}>
        {/* Grille : filets de 1 px, en retrait */}
        {[0, 0.5, 1].map((ratio) => (
          <span key={ratio} className={styles.gridline} style={{ bottom: `${ratio * 100}%` }} />
        ))}

        <div className={styles.axis}>
          {ticks.slice().reverse().map((tick, i) => (
            <span key={i} className={`t-num ${styles.tick}`}>{tick}</span>
          ))}
        </div>

        <div className={styles.columns} role="presentation">
          {points.map((point, index) => (
            <div
              key={`${point.label}-${index}`}
              className={`${styles.slot} ${hover === index ? styles.slotHover : ''}`}
              onMouseEnter={() => setHover(index)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(index)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              role="button"
              aria-label={`${point.fullLabel ?? point.label} : ${series
                .map((s) => `${s.label} ${point.values[s.key] ?? 0}${unit}`)
                .join(', ')}`}
            >
              <div className={styles.bars}>
                {series.map((s) => {
                  const value = point.values[s.key] ?? 0;
                  return (
                    <span
                      key={s.key}
                      className={styles.bar}
                      style={{
                        height: `${max > 0 ? (value / max) * 100 : 0}%`,
                        background: `var(${s.token})`,
                      }}
                    />
                  );
                })}
              </div>

              {index === peakIndex && series[0] && (
                <span className={`t-num ${styles.peakLabel}`}>
                  {point.values[series[0].key] ?? 0}
                </span>
              )}

              {hover === index && (
                <div className={styles.tooltip} role="tooltip">
                  <p className={styles.tooltipTitle}>{point.fullLabel ?? point.label}</p>
                  {series.map((s) => (
                    <p key={s.key} className={styles.tooltipRow}>
                      <span className={styles.swatch} style={{ background: `var(${s.token})` }} />
                      <span>{s.label}</span>
                      <strong className="t-num">{point.values[s.key] ?? 0}{unit}</strong>
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className={styles.xAxis}>
        {points.map((point, index) => (
          <span key={index} className={styles.xLabel}>
            {points.length > 14 && index % 3 !== 0 ? '' : point.label}
          </span>
        ))}
      </div>

      <button
        type="button"
        className={styles.tableToggle}
        aria-expanded={showTable}
        aria-controls={tableId}
        onClick={() => setShowTable((v) => !v)}
      >
        {showTable ? 'Masquer le tableau' : 'Voir les chiffres'}
      </button>

      {showTable && (
        <div className={styles.tableWrap} id={tableId}>
          <table className={styles.table}>
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr>
                <th scope="col">Période</th>
                {series.map((s) => <th key={s.key} scope="col">{s.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {points.map((point, index) => (
                <tr key={index}>
                  <th scope="row">{point.fullLabel ?? point.label}</th>
                  {series.map((s) => (
                    <td key={s.key} className="t-num">{point.values[s.key] ?? 0}{unit}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </figure>
  );
}

/* ==================================================================
   Barres horizontales — comparer des personnes ou des origines
   ================================================================== */

export function BarList({
  rows, unit = '', caption, token = '--chart-1',
}: {
  rows: { label: string; value: number; hint?: string }[];
  unit?: string;
  caption: string;
  token?: string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);

  if (rows.length === 0) {
    return <p className={`t-small t-muted ${styles.empty}`}>Pas encore de données.</p>;
  }

  return (
    <figure className={styles.figure}>
      <figcaption className="sr-only">{caption}</figcaption>
      <ul className={styles.barList}>
        {rows.map((row) => (
          <li key={row.label} className={styles.barRow}>
            <span className={styles.barLabel}>{row.label}</span>
            <span className={styles.barTrack}>
              <span
                className={styles.barFill}
                style={{ width: `${(row.value / max) * 100}%`, background: `var(${token})` }}
              />
            </span>
            <span className={`t-num ${styles.barValue}`}>
              {row.value}{unit}
              {row.hint && <span className="t-micro t-faint"> · {row.hint}</span>}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
