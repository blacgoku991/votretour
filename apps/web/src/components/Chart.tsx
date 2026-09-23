'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useInViewOnce } from './motion/useInViewOnce';
import styles from './Chart.module.css';

/**
 * Graphiques du tableau de bord.
 *
 * Règles appliquées, dans l'ordre :
 *  1. la forme suit le travail des données — des colonnes pour comparer
 *     des grandeurs dans le temps, des lattes horizontales sur un rail
 *     pour comparer des personnes ou des origines ;
 *  2. les deux teintes catégorielles (--chart-1, --chart-2) sont
 *     attribuées dans un ORDRE FIXE et ne sont jamais recyclées ;
 *  3. barres fines (≤ 24 px), extrémité arrondie côté donnée et carrée
 *     sur la ligne de base, grilles en filet de 1 px ;
 *  4. légende dès deux séries, étiquette directe réservée à l'extrême ;
 *  5. survol par défaut, et une vue tableau toujours accessible : le
 *     texte ne porte jamais la couleur de la série.
 *
 * Mouvement : les barres montent (scaleY depuis la base) une seule fois,
 * à l'entrée dans la vue — 420 ms, décalage de 20 ms — et seulement si le
 * mouvement est permis (CSS). Sans JavaScript, elles sont visibles.
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
  // Plafond « rond » dont la moitié est un entier : la graduation du
  // milieu ne ment jamais (pas de « 13 » pour 12,5).
  for (const step of [1, 2, 3, 4, 5, 6, 8, 10]) {
    const candidate = magnitude * step;
    if (candidate >= max && Number.isInteger(candidate / 2)) return candidate;
  }
  return magnitude * 10;
}

/** Sans JavaScript, rien n'est « armé » : les barres restent visibles. */
const NOSCRIPT_CSS = '[data-chart-bars] [data-bar]{transform:none!important}';

/* ==================================================================
   Colonnes dans le temps
   ================================================================== */

export function ColumnChart({
  points, series, unit = '', caption, height = 220, markCurrentHour,
}: {
  points: ChartPoint[];
  series: SeriesSpec[];
  unit?: string;
  caption: string;
  height?: number;
  /**
   * Fuseau horaire (ex. « Europe/Paris ») : marque d'une encoche la
   * colonne dont le libellé est l'heure courante (« 09 », « 18 »…).
   * Calculé APRÈS montage : jamais rendu côté serveur.
   */
  markCurrentHour?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [nowLabel, setNowLabel] = useState<string | null>(null);
  const tableId = useId();
  const plotRef = useRef<HTMLDivElement | null>(null);
  const seen = useInViewOnce(plotRef, { threshold: 0.3 });

  useEffect(() => {
    if (!markCurrentHour) return;
    const read = () => {
      try {
        const hour = new Intl.DateTimeFormat('fr-FR', {
          hour: '2-digit', hourCycle: 'h23', timeZone: markCurrentHour,
        }).format(new Date());
        setNowLabel(hour.padStart(2, '0'));
      } catch {
        setNowLabel(null);
      }
    };
    read();
    const timer = setInterval(read, 60_000);
    return () => clearInterval(timer);
  }, [markCurrentHour]);

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
    return <p className={styles.empty}>Pas encore de données sur cette période.</p>;
  }

  const ticks = [0, 0.5, 1].map((ratio) => Math.round(max * ratio));
  const sparse = points.length > 14;

  return (
    <figure className={styles.figure}>
      <figcaption className="sr-only">{caption}</figcaption>
      <noscript><style>{NOSCRIPT_CSS}</style></noscript>

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

      <div
        ref={plotRef}
        className={styles.plot}
        style={{ height }}
        data-chart-bars=""
        data-in={seen ? '1' : undefined}
      >
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
              className={styles.slot}
              data-hover={hover === index ? '1' : undefined}
              data-now={nowLabel != null && point.label === nowLabel ? '1' : undefined}
              style={{ ['--i' as string]: index } as React.CSSProperties}
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
                      data-bar=""
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
                <span
                  className={`t-num ${styles.peakLabel}`}
                  style={{ bottom: `${max > 0 ? ((point.values[series[0].key] ?? 0) / max) * 100 : 0}%` }}
                >
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

      <div className={styles.xAxis} aria-hidden="true">
        {points.map((point, index) => {
          const isNow = nowLabel != null && point.label === nowLabel;
          return (
            <span key={index} className={styles.xLabel} data-now={isNow ? '1' : undefined}>
              {isNow || !sparse || index % 3 === 0 ? point.label : ''}
            </span>
          );
        })}
      </div>

      <div className={styles.foot}>
        {markCurrentHour && nowLabel != null && points.some((p) => p.label === nowLabel) && (
          <span className={styles.nowKey}>
            <span className={styles.nowNotch} aria-hidden="true" />
            Heure actuelle
          </span>
        )}
        <button
          type="button"
          className={styles.tableToggle}
          aria-expanded={showTable}
          aria-controls={tableId}
          onClick={() => setShowTable((v) => !v)}
        >
          {showTable ? 'Masquer le tableau' : 'Voir les chiffres'}
        </button>
      </div>

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
   Lattes horizontales sur un rail — comparer des personnes, des origines
   ================================================================== */

export function BarList({
  rows, unit = '', caption, token = '--chart-1',
}: {
  rows: { label: string; value: number; hint?: string }[];
  unit?: string;
  caption: string;
  token?: string;
}) {
  const listRef = useRef<HTMLUListElement | null>(null);
  const seen = useInViewOnce(listRef, { threshold: 0.3 });
  const max = Math.max(...rows.map((r) => r.value), 1);
  const total = rows.reduce((sum, r) => sum + r.value, 0);

  if (rows.length === 0) {
    return <p className={styles.empty}>Pas encore de données sur cette période.</p>;
  }

  return (
    <figure className={styles.figure}>
      <figcaption className="sr-only">{caption}</figcaption>
      <noscript><style>{NOSCRIPT_CSS}</style></noscript>
      <ul ref={listRef} className={styles.barList} data-chart-bars="" data-in={seen ? '1' : undefined}>
        {rows.map((row, index) => (
          <li
            key={row.label}
            className={styles.barRow}
            style={{ ['--i' as string]: index } as React.CSSProperties}
          >
            <p className={styles.barHead}>
              <span className={styles.barLabel}>{row.label}</span>
              <span className={styles.barValue}>
                <strong className="t-num">{row.value}{unit}</strong>
                {total > 0 && rows.length > 1 && (
                  <span className={styles.barShare}> · {Math.round((row.value / total) * 100)} %</span>
                )}
                {row.hint && <span className={styles.barShare}> · {row.hint}</span>}
              </span>
            </p>
            <span className={styles.barTrack} aria-hidden="true">
              <span
                data-bar=""
                className={styles.barFill}
                style={{ width: `${Math.max(2, (row.value / max) * 100)}%`, background: `var(${token})` }}
              />
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
