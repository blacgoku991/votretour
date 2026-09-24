import { Section, Stat } from '@/components/Page';
import { BarList, ColumnChart } from '@/components/Chart';
import { DEVICE_LABEL } from '@/components/objects/DeviceGlyph';
import { formatNumber } from '@/lib/format';
import { getProfile } from '@/lib/profiles';
import type { QueueProfile } from '@/lib/profiles/types';
import {
  formatRate,
  formatSpan,
  partySizeLabel,
  pendingQuotes,
  stageDurationRows,
  type DeskStats,
  type ProfileStatsView,
  type RetailStats,
  type TableStats,
  type WorkshopStats,
} from './profileStatsModel';
import styles from './profile-stats.module.css';

/**
 * STATISTIQUES PAR MÉTIER — sous les statistiques de toujours.
 *
 * Chaque métier a les chiffres qui font son travail : le garage lit le
 * délai du dépôt au « prêt » et le taux d'accord des devis, le restaurant
 * les couverts et l'attente par taille de groupe, le guichet les appels
 * par guichet. Rien pour un barbier : `profile_stats` ne renvoie jamais
 * walkin ni event, et la page n'affiche ce bloc que s'il a une file à
 * métier.
 *
 * Formes (compétence dataviz) : des chiffres quand la donnée est un
 * chiffre (bande KPI), une jauge pour un seul rapport (accord des devis),
 * des lattes horizontales pour comparer des étapes ou des guichets, des
 * colonnes pour des tailles de groupe ordonnées. Une seule teinte par
 * graphique ; l'emphase (vermillon) ne marque que l'étape où le temps
 * passe. Toutes les valeurs sont écrites en toutes lettres : la couleur
 * ne porte jamais seule l'information.
 */

export function ProfileStats({
  view, queueNames, rangeLabel,
}: {
  view: ProfileStatsView;
  /** Files de l'établissement par métier, pour le titre (« Atelier · Pneus »). */
  queueNames: Partial<Record<QueueProfile, string[]>>;
  rangeLabel: string;
}) {
  const blocks: React.ReactNode[] = [];
  if (view.vehicle) blocks.push(<WorkshopBlock key="vehicle" profile="vehicle" stats={view.vehicle} names={queueNames.vehicle} />);
  if (view.device) blocks.push(<WorkshopBlock key="device" profile="device" stats={view.device} names={queueNames.device} />);
  if (view.table) blocks.push(<TableBlock key="table" stats={view.table} names={queueNames.table} />);
  if (view.desk) blocks.push(<DeskBlock key="desk" stats={view.desk} names={queueNames.desk} />);
  if (view.retail) blocks.push(<RetailBlock key="retail" stats={view.retail} names={queueNames.retail} />);
  if (blocks.length === 0) return null;

  return (
    <section className={styles.root} aria-labelledby="stats-metiers">
      <header className={styles.head}>
        <p className={styles.kicker}><span className={styles.kickerNotch} aria-hidden="true" />Par métier</p>
        <h2 id="stats-metiers" className={styles.title}>Ce que mesure votre métier</h2>
        <p className={styles.lead}>
          Les chiffres propres à chaque file à métier, sur {rangeLabel}. Seuls les passages inscrits depuis
          l’arrivée de la file dans son métier sont comptés.
        </p>
      </header>
      {blocks}
    </section>
  );
}

function BlockHead({ profile, names }: { profile: QueueProfile; names?: string[] }) {
  const def = getProfile(profile);
  return (
    <div className={styles.blockHead}>
      <h3 className={styles.blockTitle}>{def.label}</h3>
      {names && names.length > 0 && (
        <p className={styles.blockQueues}>{names.map((n) => `« ${n} »`).join(', ')}</p>
      )}
    </div>
  );
}

function plural(n: number, one: string, many: string): string {
  return `${formatNumber(n)} ${n <= 1 ? one : many}`;
}

/* ------------------------------------------------------------------ */
/* Atelier (véhicule, appareil)                                         */
/* ------------------------------------------------------------------ */

function WorkshopBlock({ profile, stats, names }: { profile: 'vehicle' | 'device'; stats: WorkshopStats; names?: string[] }) {
  const vocab = getProfile(profile).vocab;
  const noun = vocab.subjectPlural;
  const stages = stageDurationRows(profile, stats.medianSecondsByStage);
  const maxStage = Math.max(1, ...stages.map((s) => s.seconds));
  const q = stats.quote;
  const decided = q.accepted + q.declined;
  const pending = pendingQuotes(q);
  const kinds = Object.entries(stats.byDeviceKind)
    .filter(([, n]) => (n ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([k, n]) => ({ label: DEVICE_LABEL[k as keyof typeof DEVICE_LABEL] ?? k, value: n ?? 0 }));

  return (
    <article className={styles.block} data-profile={profile}>
      <BlockHead profile={profile} names={names} />

      {stats.dropped === 0 ? (
        <p className={styles.empty}>Aucun {vocab.subject} déposé sur cette période.</p>
      ) : (
        <>
          <div className={`kpi-band ${styles.kpis}`}>
            <Stat
              lead
              accent
              label="Du dépôt à « prêt »"
              value={formatSpan(stats.medianDropToReadySeconds)}
              hint="médiane, jusqu’au premier « prêt »"
            />
            <Stat
              label={`${vocab.subjectPlural.charAt(0).toUpperCase()}${vocab.subjectPlural.slice(1)} déposés`}
              value={formatNumber(stats.dropped)}
              hint={plural(stats.handedOver, 'rendu au client', 'rendus au client')}
            />
            <Stat
              label="De « prêt » au rendu"
              value={formatSpan(stats.medianReadyToPickupSeconds)}
              hint={`le ${vocab.subject} qui attend son client`}
            />
            <Stat
              label="Prêts depuis plus de 24 h"
              value={formatNumber(stats.readyNotCollected24h)}
              hint="en ce moment, non récupérés"
            />
            <Stat
              label="Clients joignables"
              value={formatRate(stats.reachableRate)}
              hint="au moins une notification remise"
            />
          </div>

          <div className={styles.twoUp}>
            {/* Devis : un seul rapport, donc une jauge, pas un camembert. */}
            <Section bare title="Devis en ligne" description="Accords du client, depuis son téléphone.">
              {q.sent === 0 ? (
                <p className={styles.empty}>Aucun devis envoyé sur cette période.</p>
              ) : (
                <figure className={styles.meter}>
                  <figcaption className="sr-only">
                    {`Taux d’accord des devis : ${formatRate(q.acceptanceRate)}, ${q.accepted} acceptés, ${q.declined} refusés, ${pending} sans réponse.`}
                  </figcaption>
                  <p className={styles.meterValue} aria-hidden="true">
                    <span className={styles.meterBig}>{formatRate(q.acceptanceRate)}</span>
                    <span className={styles.meterUnit}>d’accord</span>
                  </p>
                  <span className={styles.meterTrack} aria-hidden="true">
                    <span
                      className={styles.meterFill}
                      style={{ transform: `scaleX(${decided > 0 ? (q.accepted / decided).toFixed(3) : 0})` }}
                    />
                  </span>
                  <dl className={styles.meterLegend}>
                    <div><dt><span className={styles.keyAccepted} aria-hidden="true" />Acceptés</dt><dd>{formatNumber(q.accepted)}</dd></div>
                    <div><dt><span className={styles.keyDeclined} aria-hidden="true" />Refusés</dt><dd>{formatNumber(q.declined)}</dd></div>
                    <div><dt>Sans réponse</dt><dd>{formatNumber(pending)}</dd></div>
                    <div><dt>Décision</dt><dd>{formatSpan(q.medianDecisionSeconds)}</dd></div>
                  </dl>
                </figure>
              )}
            </Section>

            <Section bare title="Temps par étape" description="Médiane du temps passé dans chaque étape, dans l’ordre de l’atelier.">
              {stages.length === 0 ? (
                <p className={styles.empty}>Pas encore d’étape terminée sur cette période.</p>
              ) : (
                <figure className={styles.lanes}>
                  <figcaption className="sr-only">Temps médian par étape, en {noun}</figcaption>
                  <ol className={styles.laneList}>
                    {stages.map((s, i) => (
                      <li
                        key={s.stage}
                        className={styles.lane}
                        data-longest={s.longest ? '1' : undefined}
                        style={{ ['--i' as string]: i } as React.CSSProperties}
                      >
                        <span className={styles.laneLabel}>{s.label}</span>
                        <span className={styles.laneTrack} aria-hidden="true">
                          <span className={styles.laneFill} style={{ width: `${Math.max(2, (s.seconds / maxStage) * 100)}%` }} />
                        </span>
                        <span className={styles.laneValue}>{formatSpan(s.seconds)}</span>
                      </li>
                    ))}
                  </ol>
                  {stages.some((s) => s.longest) && (
                    <p className={styles.laneNote}>
                      <span className={styles.laneNoteKey} aria-hidden="true" />
                      Là où le temps passe : {stages.find((s) => s.longest)?.label.toLowerCase()}.
                    </p>
                  )}
                </figure>
              )}
            </Section>
          </div>

          <div className={kinds.length > 0 ? styles.twoUp : undefined}>
            <Section bare title="Motifs" description={`Pourquoi les ${noun} arrivent.`}>
              <BarList
                rows={stats.byReason.map((r) => ({ label: r.name, value: r.count }))}
                caption={`Motifs de dépôt des ${noun}`}
                token="--chart-1"
              />
            </Section>
            {kinds.length > 0 && (
              <Section bare title="Appareils" description="Répartition par type d’appareil.">
                <BarList rows={kinds} caption="Appareils déposés par type" token="--chart-1" />
              </Section>
            )}
          </div>
        </>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Restaurant                                                           */
/* ------------------------------------------------------------------ */

function TableBlock({ stats, names }: { stats: TableStats; names?: string[] }) {
  const buckets = stats.medianWaitByPartySize;
  const maxWait = Math.max(1, ...buckets.map((b) => b.medianWaitSeconds ?? 0));
  const hours = hourSeries(stats.byHour);

  return (
    <article className={styles.block} data-profile="table">
      <BlockHead profile="table" names={names} />
      {stats.groupsSeated === 0 && stats.byHour.length === 0 ? (
        <p className={styles.empty}>Aucun groupe installé sur cette période.</p>
      ) : (
        <>
          <div className={`kpi-band ${styles.kpis} ${styles.kpis3}`}>
            <Stat
              lead
              accent
              label="Couverts servis"
              value={formatNumber(stats.coversSeated)}
              hint={plural(stats.groupsSeated, 'groupe installé', 'groupes installés')}
            />
            <Stat
              label="Désistements"
              value={formatRate(stats.noShowAfterCallRate)}
              hint="appelés, jamais présentés"
            />
            <Stat
              label="Clients joignables"
              value={formatRate(stats.reachableRate)}
              hint="au moins une notification remise"
            />
          </div>

          <div className={styles.twoUp}>
            <Section bare title="Attente par taille de groupe" description="Médiane, de l’inscription à l’appel. Les grandes tables se libèrent moins souvent.">
              <figure className={styles.cols}>
                <figcaption className="sr-only">Attente médiane par taille de groupe</figcaption>
                <div className={styles.colPlot}>
                  {buckets.map((b, i) => (
                    <div
                      key={b.size}
                      className={styles.col}
                      style={{ ['--i' as string]: i } as React.CSSProperties}
                      role="img"
                      aria-label={`${partySizeLabel(b.size)} couverts : ${formatSpan(b.medianWaitSeconds)} d’attente médiane, ${b.groups} groupes`}
                    >
                      <span className={styles.colValue}>{formatSpan(b.medianWaitSeconds)}</span>
                      <span
                        className={styles.colBar}
                        style={{ height: `${b.medianWaitSeconds ? Math.max(3, (b.medianWaitSeconds / maxWait) * 100) : 0}%` }}
                      />
                    </div>
                  ))}
                </div>
                <div className={styles.colAxis} aria-hidden="true">
                  {buckets.map((b) => (
                    <span key={b.size} className={styles.colLabel}>
                      <strong>{partySizeLabel(b.size)}</strong>
                      <span>{plural(b.groups, 'groupe', 'groupes')}</span>
                    </span>
                  ))}
                </div>
              </figure>
            </Section>

            <Section bare title="Couverts par heure" description="Groupes et couverts inscrits, à l’heure de l’établissement.">
              <ColumnChart
                points={hours}
                series={[
                  { key: 'covers', label: 'Couverts', token: '--chart-1' },
                  { key: 'groups', label: 'Groupes', token: '--chart-2' },
                ]}
                caption="Groupes et couverts inscrits par heure"
                height={180}
              />
            </Section>
          </div>
        </>
      )}
    </article>
  );
}

/**
 * Heures continues, de la première à la dernière heure du service : une
 * heure creuse reste une colonne vide, jamais une heure qui disparaît
 * (« 13 » puis « 19 » côte à côte mentirait sur la coupure).
 */
function hourSeries(byHour: TableStats['byHour']) {
  if (byHour.length === 0) return [];
  const found = new Map(byHour.map((h) => [h.hour, h]));
  const first = Math.min(...byHour.map((h) => h.hour));
  const last = Math.max(...byHour.map((h) => h.hour));
  return Array.from({ length: last - first + 1 }, (_, i) => {
    const hour = first + i;
    const h = found.get(hour);
    return {
      label: String(hour).padStart(2, '0'),
      fullLabel: `${String(hour).padStart(2, '0')} h`,
      values: { covers: h?.covers ?? 0, groups: h?.groups ?? 0 },
    };
  });
}

/* ------------------------------------------------------------------ */
/* Guichet                                                              */
/* ------------------------------------------------------------------ */

function DeskBlock({ stats, names }: { stats: DeskStats; names?: string[] }) {
  return (
    <article className={styles.block} data-profile="desk">
      <BlockHead profile="desk" names={names} />
      {stats.joined === 0 ? (
        <p className={styles.empty}>Aucun ticket sur cette période.</p>
      ) : (
        <>
          <div className={`kpi-band ${styles.kpis}`}>
            <Stat
              lead
              accent
              label="Attente médiane"
              value={formatSpan(stats.medianWaitSeconds)}
              hint="du ticket à l’appel"
            />
            <Stat
              label="Au guichet"
              value={formatSpan(stats.medianDeskSeconds)}
              hint="médiane, de l’appel à la fin"
            />
            <Stat
              label="Personnes servies"
              value={formatNumber(stats.completed)}
              hint={plural(stats.joined, 'ticket pris', 'tickets pris')}
            />
            <Stat
              label="Rappels"
              value={formatNumber(stats.recalls)}
              hint="« dernier appel » envoyés"
            />
            <Stat
              label="Absents"
              value={formatRate(stats.absentRate)}
              hint="absents à l’appel ou tickets expirés"
            />
          </div>

          <Section
            bare
            title="Appels par guichet"
            description={`Personnes servies à chaque guichet, et le temps médian passé au guichet. Clients joignables par notification : ${formatRate(stats.reachableRate)}.`}
          >
            <BarList
              rows={stats.byDesk.map((d) => ({
                label: d.label,
                value: d.served,
                hint: d.medianDeskSeconds ? `${formatSpan(d.medianDeskSeconds)} au guichet` : undefined,
              }))}
              caption="Personnes servies par guichet"
              token="--chart-2"
            />
          </Section>
        </>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Boutique                                                             */
/* ------------------------------------------------------------------ */

function RetailBlock({ stats, names }: { stats: RetailStats; names?: string[] }) {
  return (
    <article className={styles.block} data-profile="retail">
      <BlockHead profile="retail" names={names} />
      <div className={`kpi-band ${styles.kpis} ${styles.kpis3}`}>
        <Stat
          lead
          accent
          label="Préparation"
          value={formatSpan(stats.medianPreparingSeconds)}
          hint="médiane, jusqu’à « commande prête »"
        />
        <Stat
          label="Retraits"
          value={formatNumber(stats.pickups)}
          hint={plural(stats.advice, 'passage conseil', 'passages conseil')}
        />
        <Stat
          label="Clients joignables"
          value={formatRate(stats.reachableRate)}
          hint="au moins une notification remise"
        />
      </div>
    </article>
  );
}
