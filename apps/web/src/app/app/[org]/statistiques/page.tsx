import type { Metadata } from 'next';
import { requireOrgAccess } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { PageHeader, Section, Stat } from '@/components/Page';
import { ColumnChart, BarList } from '@/components/Chart';
import { formatDurationBounded, formatNumber, formatPercent } from '@/lib/format';
import { SOURCE_LABEL } from '@/lib/copy';
import { isLegacyProfile, isQueueProfile } from '@/lib/profiles';
import type { QueueProfile } from '@/lib/profiles/types';
import { ProfileStats } from './ProfileStats';
import { parseProfileStats } from './profileStatsModel';
import styles from './stats.module.css';

export const metadata: Metadata = { title: 'Statistiques', robots: { index: false } };
export const dynamic = 'force-dynamic';

const RANGES = [
  { key: '7', label: '7 jours', days: 7 },
  { key: '30', label: '30 jours', days: 30 },
  { key: '90', label: '90 jours', days: 90 },
];

interface Stats {
  totals: { joined: number; completed: number; cancelled: number; absent: number; skipped: number; expired: number };
  completionRate: number | null;
  avgWaitSeconds: number | null;
  medianWaitSeconds: number | null;
  avgServiceSeconds: number | null;
  noShowRate: number | null;
  bySource: Record<string, number>;
  byDay: { day: string; joined: number; completed: number }[];
  byHour: { hour: number; joined: number }[];
  byStaff: { staffId: string; name: string; completed: number; avgServiceSeconds: number | null }[];
  peakConcurrent: number | null;
}

/** Pluriel français : 0 et 1 au singulier. */
function plural(n: number, one: string, many: string): string {
  return `${formatNumber(n)} ${n <= 1 ? one : many}`;
}

export default async function StatsPage({
  params, searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ lieu?: string; jours?: string }>;
}) {
  const { org } = await params;
  const { lieu, jours } = await searchParams;
  const access = await requireOrgAccess(org, 'stats.view');
  const db = supabaseAdmin();

  const { data: locations } = await db
    .from('locations').select('id, name, timezone')
    .eq('organization_id', access.organization.organization_id).order('created_at');

  const list = (locations ?? []) as { id: string; name: string; timezone: string | null }[];
  const current = list.find((l) => l.id === lieu) ?? list[0] ?? null;
  const range = RANGES.find((r) => r.key === jours) ?? RANGES[1]!;

  if (!current) {
    return (
      <div className={`shell ${styles.page}`}>
        <PageHeader title="Statistiques" description="Créez d’abord un établissement." />
      </div>
    );
  }

  const from = new Date(Date.now() - range.days * 86_400_000).toISOString();
  const to = new Date().toISOString();

  const [
    { data },
    { count: notificationsSent },
    { count: reviewClicks },
    { data: locationQueues },
  ] = await Promise.all([
    db.rpc('location_stats', {
      p_location_id: current.id,
      p_from: from,
      p_to: to,
    }),
    db.from('notification_deliveries')
      .select('id', { count: 'exact', head: true })
      .eq('location_id', current.id)
      .eq('status', 'sent')
      .gte('created_at', from)
      .lte('created_at', to),
    db.from('review_clicks')
      .select('id', { count: 'exact', head: true })
      .eq('location_id', current.id)
      .gte('created_at', from)
      .lte('created_at', to),
    db.from('queues').select('name, profile').eq('location_id', current.id).order('created_at'),
  ]);

  // Statistiques par métier : seulement si l'établissement a une file à
  // métier. Un barbier ne déclenche ni la requête ni le moindre pixel.
  const queueNames: Partial<Record<QueueProfile, string[]>> = {};
  for (const q of (locationQueues ?? []) as { name: string; profile: string }[]) {
    if (!isQueueProfile(q.profile) || isLegacyProfile(q.profile)) continue;
    (queueNames[q.profile] ??= []).push(q.name);
  }
  const profileView = Object.keys(queueNames).length > 0
    ? parseProfileStats((await db.rpc('profile_stats', { p_location_id: current.id, p_from: from, p_to: to })).data)
    : null;

  const stats = data as Stats | null;
  const joined = stats?.totals.joined ?? 0;
  const completed = stats?.totals.completed ?? 0;
  const cancelled = stats?.totals.cancelled ?? 0;
  const absent = stats?.totals.absent ?? 0;
  const expired = stats?.totals.expired ?? 0;
  const googleClicks = reviewClicks ?? 0;
  const sent = notificationsSent ?? 0;
  const reviewClickRate = completed > 0 ? (googleClicks / completed) * 100 : null;
  const timeZone = current.timezone || 'Europe/Paris';

  // Série complète de `range.days` jours, du plus ancien au plus récent,
  // datés dans le fuseau de l'établissement ; zéro pour les jours vides.
  const dayKey = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit', timeZone,
  });
  const found = new Map((stats?.byDay ?? []).map((d) => [String(d.day).slice(0, 10), d]));
  const dayShort = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', timeZone: 'UTC' });
  const dayMonth = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  const dayFull = new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
  });
  const nowMs = Date.now();
  const byDay = Array.from({ length: range.days }, (_, i) => {
    const key = dayKey.format(new Date(nowMs - (range.days - 1 - i) * 86_400_000));
    const date = new Date(`${key}T12:00:00Z`);
    const d = found.get(key);
    // Le 1er du mois et la première colonne portent le mois.
    const withMonth = i === 0 || key.endsWith('-01');
    return {
      label: (withMonth ? dayMonth : dayShort).format(date),
      fullLabel: dayFull.format(date),
      values: { joined: d?.joined ?? 0, completed: d?.completed ?? 0 },
    };
  });
  const spanLabel = byDay.length > 0
    ? `du ${byDay[0]!.fullLabel.replace(/^\S+\s/, '')} au ${byDay[byDay.length - 1]!.fullLabel.replace(/^\S+\s/, '')}`
    : '';

  const byHour = Array.from({ length: 24 }, (_, hour) => {
    const found = (stats?.byHour ?? []).find((h) => h.hour === hour);
    return {
      label: String(hour).padStart(2, '0'),
      fullLabel: `${String(hour).padStart(2, '0')} h`,
      values: { joined: found?.joined ?? 0 },
    };
  }).filter((_, hour) => hour >= 6 && hour <= 22);

  const bySource = Object.entries(stats?.bySource ?? {})
    .map(([key, value]) => ({ label: SOURCE_LABEL[key] ?? key, value }))
    .sort((a, b) => b.value - a.value);

  const href = (params: { lieu?: string; jours?: string }) =>
    `/app/${org}/statistiques?lieu=${params.lieu ?? current.id}&jours=${params.jours ?? range.key}`;

  return (
    <div className={`shell ${styles.page}`}>
      <PageHeader
        title="Statistiques"
        description={`${current.name} · ${range.label}`}
        actions={
          <div className={styles.filters}>
            {list.length > 1 && (
              <nav className={`seg ${styles.seg}`} aria-label="Établissement">
                {list.map((l) => (
                  <a key={l.id} href={href({ lieu: l.id })} aria-current={l.id === current.id ? 'page' : undefined}>
                    {l.name}
                  </a>
                ))}
              </nav>
            )}
            <nav className={`seg ${styles.seg}`} aria-label="Période">
              {RANGES.map((r) => (
                <a key={r.key} href={href({ jours: r.key })} aria-current={r.key === range.key ? 'page' : undefined}>
                  {r.label}
                </a>
              ))}
            </nav>
          </div>
        }
      />

      {/* Les chiffres qui comptent, en UNE bande : un tableau d'affichage,
          pas des cartes. L'attente médiane d'abord : c'est la promesse. */}
      <section aria-label="Chiffres clés" className={styles.band}>
        <div className={`kpi-band ${styles.kpis}`}>
          <Stat
            lead
            accent
            label="Attente médiane"
            value={formatDurationBounded(stats?.medianWaitSeconds ?? null)}
            hint={`moyenne ${formatDurationBounded(stats?.avgWaitSeconds ?? null)}`}
          />
          <Stat
            label="Clients accueillis"
            value={formatNumber(joined)}
            hint={plural(completed, 'passage terminé', 'passages terminés')}
          />
          <Stat
            label="Prestation"
            value={formatDurationBounded(stats?.avgServiceSeconds ?? null)}
            hint="durée moyenne constatée"
          />
          <Stat
            label="Taux de passage"
            value={formatPercent(stats?.completionRate ?? null)}
            hint={`${plural(cancelled, 'départ', 'départs')}, ${plural(absent, 'absent', 'absents')}`}
          />
          <Stat
            label="Taux d’absence"
            value={formatPercent(stats?.noShowRate ?? null)}
            hint={`${plural(absent, 'absent', 'absents')}, ${plural(expired, 'place expirée', 'places expirées')}`}
          />
        </div>
      </section>

      <Section
        bare
        title="Impact Rangvia"
        description="Notifications réellement remises, et passages terminés qui mènent à votre fiche Google."
      >
        <div className={`kpi-band ${styles.impact}`}>
          <Stat
            accent
            label="Notifications envoyées"
            value={formatNumber(sent)}
            hint="acceptées par le fournisseur"
          />
          <Stat
            label="Clics Google"
            value={formatNumber(googleClicks)}
            hint="1 clic compté au plus par visite"
          />
          <Stat
            label="Taux de clic avis"
            value={formatPercent(reviewClickRate)}
            hint="clics Google / clients servis"
          />
        </div>

        {/* La synthèse, dans le flux, sous la bande. */}
        <p className={styles.impactLine}>
          <span className={styles.impactNotch} aria-hidden="true" />
          <span>
            <strong>{plural(completed, 'client servi', 'clients servis')}</strong>
            <span className={styles.arrow} aria-hidden="true"> → </span>
            <span className="sr-only"> ont donné </span>
            <strong>{plural(googleClicks, 'clic Google', 'clics Google')}</strong>
            {reviewClickRate != null
              ? <span className={styles.impactRate}> · {formatPercent(reviewClickRate)} de conversion vers la fiche d’avis</span>
              : <span className={styles.impactRate}> · aucun passage terminé sur la période</span>}
          </span>
        </p>
      </Section>

      <Section bare title="Jour après jour" description={`Arrivées et passages terminés, ${spanLabel}`}>
        <ColumnChart
          points={byDay}
          series={[
            { key: 'joined', label: 'Arrivées', token: '--chart-1' },
            { key: 'completed', label: 'Terminés', token: '--chart-2' },
          ]}
          caption={`Arrivées et passages terminés à ${current.name} sur ${range.label}`}
        />
      </Section>

      <Section bare title="Heures d’affluence" description="À quelle heure vos clients arrivent.">
        <ColumnChart
          points={byHour}
          series={[{ key: 'joined', label: 'Arrivées', token: '--chart-1' }]}
          caption={`Répartition horaire des arrivées à ${current.name}`}
          height={168}
          markCurrentHour={timeZone}
        />
      </Section>

      <div className={styles.twoUp}>
        <Section bare title="Par professionnel" description="Passages terminés sur la période.">
          <BarList
            rows={(stats?.byStaff ?? []).map((s) => ({
              label: s.name,
              value: s.completed,
              hint: s.avgServiceSeconds ? `${formatDurationBounded(s.avgServiceSeconds)} en moyenne` : undefined,
            }))}
            caption="Passages terminés par professionnel"
            token="--chart-2"
          />
        </Section>

        <Section bare title="Comment ils arrivent" description="Plaque NFC, QR code, App Clip ou comptoir.">
          <BarList rows={bySource} caption="Origine des inscriptions" token="--chart-1" />
        </Section>
      </div>

      {profileView && <ProfileStats view={profileView} queueNames={queueNames} rangeLabel={range.label} />}

      <p className={styles.note}>
        Les données personnelles sont effacées au-delà de votre durée de conservation ;
        ces statistiques restent exactes car elles ne reposent sur aucun prénom.
      </p>
    </div>
  );
}
