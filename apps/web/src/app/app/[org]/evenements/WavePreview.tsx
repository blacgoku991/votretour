import { Barrier } from './Barrier';
import { PREVIEW_MAX_HEIGHT, PREVIEW_SLATS, waveLayout } from './waves';
import styles from './events.module.css';

/**
 * APERÇU VIVANT des vagues (≥ 1024 px) : les 30 premiers inscrits en
 * mini-lattes sur un rail, regroupés par accolades vermillon toutes les
 * « taille de vague » lattes. Chaque changement de taille ne réécrit que
 * des `transform` et des opacités : les lattes glissent d'un groupe à
 * l'autre, les accolades s'étirent (scaleY de leur trait).
 *
 * Décoratif (aria-hidden) : le sens est porté par le formulaire et par la
 * phrase de synthèse, qui reste lisible.
 */
export function WavePreview({
  waveSize, validMinutes, graceMinutes,
}: { waveSize: number; validMinutes: number; graceMinutes: number }) {
  const layout = waveLayout(waveSize);
  const groupCount = layout.groups.length;
  const lastTop = layout.height;
  const valid = Number.isFinite(validMinutes) && validMinutes > 0 ? Math.round(validMinutes) : null;
  const grace = Number.isFinite(graceMinutes) && graceMinutes >= 0 ? Math.round(graceMinutes) : null;

  return (
    <aside className={styles.preview} aria-label="Aperçu des vagues">
      <div className={styles.previewHead}>
        <p className="t-label">Aperçu des vagues</p>
        <p className={styles.previewNote}>Les {PREVIEW_SLATS} premiers inscrits</p>
      </div>

      <div className={styles.previewBody} aria-hidden="true">
        <div className={styles.gate}>
          <Barrier ground={false} className={styles.gateBarrier} />
          <span className={`t-label ${styles.gateLabel}`}>Entrée</span>
        </div>

        <div className={styles.waves} style={{ height: PREVIEW_MAX_HEIGHT }}>
          {layout.slats.map((y, i) => (
            <span
              key={i}
              className={styles.wslat}
              data-first={i < layout.size ? '1' : undefined}
              style={{
                transform: `translateY(${y}px)`,
                ['--i' as string]: i,
              } as React.CSSProperties}
            />
          ))}

          {Array.from({ length: PREVIEW_SLATS }, (_, g) => {
            const group = layout.groups[g];
            const on = group !== undefined;
            const top = on ? group.top : lastTop;
            const h = on ? group.height : 0;
            const showLabel = on && (layout.size >= 2 || g === 0 || g === groupCount - 1);
            return (
              <span
                key={g}
                className={styles.brace}
                data-on={on ? '1' : '0'}
                data-small={h < 14 ? '1' : undefined}
                style={{ transform: `translateY(${top}px)` }}
              >
                <span className={styles.braceTop} />
                <span className={styles.braceLine} style={{ transform: `scaleY(${h})` }} />
                <span className={styles.braceBottom} style={{ transform: `translateY(${Math.max(0, h - 2)}px)` }} />
                <span className={styles.braceNib} style={{ transform: `translateY(${h / 2 - 1}px)` }} />
                <span
                  className={styles.braceLabel}
                  data-show={showLabel ? '1' : '0'}
                  data-first={g === 0 ? '1' : undefined}
                  style={{ transform: `translateY(${h / 2}px)` }}
                >
                  Vague {g + 1}
                  {g === 0 && (
                    <em>{layout.size} {layout.size > 1 ? 'personnes' : 'personne'}</em>
                  )}
                </span>
              </span>
            );
          })}
        </div>
      </div>

      <p className={styles.previewSum}>
        {groupCount > 1
          ? <>Il faudra <strong>{groupCount} vagues</strong> pour faire entrer ces {PREVIEW_SLATS} personnes.</>
          : <>Une seule vague fait entrer ces {PREVIEW_SLATS} personnes.</>}
        {valid !== null && (
          <> Chaque pass reste valable <strong>{valid} min</strong>
            {grace ? <>, puis {grace} min de grâce</> : null}.</>
        )}
      </p>
    </aside>
  );
}
