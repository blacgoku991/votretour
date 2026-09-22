import type { Metadata } from 'next';
import { requireOrgAccess } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { PageHeader, Section, Stat } from '@/components/Page';
import { ColumnChart, BarList } from '@/components/Chart';
import { formatDuration, formatNumber, formatPercent } from '@/lib/format';
import { SOURCE_LABEL } from '@/lib/copy';
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
    .from('locations').select('id, name')
    .eq('organization_id', access.organization.organization_id).order('created_at');

  const list = locations ?? [];
  const current = list.find((l) => l.id === lieu) ?? list[0] ?? null;
  const range = RANGES.find((r) => r.key === jours) ?? RANGES[1]!;

  if (!current) {
    return (
      <div className="shell" style={{ paddingTop: 'var(--sp-5)' }}>
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
  ]);

  const stats = data as Stats | null;
  const completed = stats?.totals.completed ?? 0;
  const googleClicks = reviewClicks ?? 0;
  const reviewClickRate = completed > 0 ? (googleClicks / completed) * 100 : null;

  const byDay = (stats?.byDay ?? []).map((d) => {
    const date = new Date(d.day);
    return {
      label: new Intl.DateTimeFormat('fr-FR', { day: 'numeric' }).format(date),
      fullLabel: new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }).format(date),
      values: { joined: d.joined, completed: d.completed },
    };
  });

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

  return (
    <div className={`shell ${styles.page}`}>
      <PageHeader
        title="Statistiques"
        description={`${current.name} · ${range.label}`}
        actions={
          <div className={styles.filters}>
            {list.length > 1 && (
              <div className={styles.rangeGroup} role="group" aria-label="Établissement">
                {list.map((l) => (
                  <a
                    key={l.id}
                    href={`/app/${org}/statistiques?lieu=${l.id}&jours=${range.key}`}
                    className={`${styles.rangeBtn} ${l.id === current.id ? styles.rangeBtnActive : ''}`}
                    aria-current={l.id === current.id ? 'true' : undefined}
                  >
                    {l.name}
                  </a>
                ))}
              </div>
            )}
            <div className={styles.rangeGroup} role="group" aria-label="Période">
              {RANGES.map((r) => (
                <a
                  key={r.key}
                  href={`/app/${org}/statistiques?lieu=${current.id}&jours=${r.key}`}
                  className={`${styles.rangeBtn} ${r.key === range.key ? styles.rangeBtnActive : ''}`}
                  aria-current={r.key === range.key ? 'true' : undefined}
                >
                  {r.label}
                </a>
              ))}
            </div>
          </div>
        }
      />

      {/* Les chiffres qui comptent, en tuiles : ce ne sont pas des
          graphiques, ce sont des réponses. */}
      <div className={styles.statGrid}>
        <Stat accent label="Clients accueillis" value={formatNumber(stats?.totals.joined ?? 0)}
          hint={`${formatNumber(stats?.totals.completed ?? 0)} passages terminés`} />
        <Stat label="Attente moyenne" value={formatDuration(stats?.avgWaitSeconds ?? null)}
          hint={stats?.medianWaitSeconds != null
            ? `médiane ${formatDuration(stats.medianWaitSeconds)}` : undefined} />
        <Stat label="Durée de prestation" value={formatDuration(stats?.avgServiceSeconds ?? null)}
          hint="moyenne constatée" />
        <Stat label="Taux de passage" value={formatPercent(stats?.completionRate ?? null)}
          hint={`${formatNumber(stats?.totals.cancelled ?? 0)} départs, ${formatNumber(stats?.totals.absent ?? 0)} absents`} />
      </div>

      <Section
        title="Impact Rangvia"
        description="Notifications réellement remises et transformation des passages terminés en clics vers la fiche Google."
      >
        <div className={styles.statGrid}>
          <Stat
            accent
            label="Notifications envoyées"
            value={formatNumber(notificationsSent ?? 0)}
            hint="acceptées par le fournisseur"
          />
          <Stat
            label="Clics vers Google"
            value={formatNumber(googleClicks)}
            hint="1 clic maximum compté par visite"
          />
          <Stat
            label="Taux de clic avis"
            value={formatPercent(reviewClickRate)}
            hint="clics Google / clients servis"
          />
          <Stat
            label="Clients servis → Google"
            value={`${formatNumber(completed)} → ${formatNumber(googleClicks)}`}
            hint={completed > 0
              ? `${formatPercent(reviewClickRate)} des passages terminés`
              : 'aucun passage terminé sur la période'}
          />
        </div>

        <p className="t-small">
          <strong>{formatNumber(completed)} clients servis</strong>
          {' → '}
          <strong>{formatNumber(googleClicks)} clics Google</strong>
          {reviewClickRate != null && (
            <> · {formatPercent(reviewClickRate)} de conversion vers la fiche d’avis</>
          )}
        </p>
      </Section>

      <Section title="Jour après jour" description="Arrivées et passages terminés.">
        <div className={styles.chartCard}>
          <ColumnChart
            points={byDay}
            series={[
              { key: 'joined', label: 'Arrivées', token: '--chart-1' },
              { key: 'completed', label: 'Terminés', token: '--chart-2' },
            ]}
            caption={`Arrivées et passages terminés à ${current.name} sur ${range.label}`}
          />
        </div>
      </Section>

      <Section title="Heures d’affluence" description="À quelle heure vos clients arrivent.">
        <div className={styles.chartCard}>
          <ColumnChart
            points={byHour}
            series={[{ key: 'joined', label: 'Arrivées', token: '--chart-1' }]}
            caption={`Répartition horaire des arrivées à ${current.name}`}
            height={160}
          />
        </div>
      </Section>

      <div className={styles.twoUp}>
        <Section title="Par professionnel" description="Passages terminés sur la période.">
          <div className={styles.chartCard}>
            <BarList
              rows={(stats?.byStaff ?? []).map((s) => ({
                label: s.name,
                value: s.completed,
                hint: s.avgServiceSeconds ? formatDuration(s.avgServiceSeconds) : undefined,
              }))}
              caption="Passages terminés par professionnel"
              token="--chart-2"
            />
          </div>
        </Section>

        <Section title="Comment ils arrivent" description="Plaque NFC, QR code, App Clip ou comptoir.">
          <div className={styles.chartCard}>
            <BarList rows={bySource} caption="Origine des inscriptions" token="--chart-1" />
          </div>
        </Section>
      </div>

      <p className="t-micro t-faint">
        Les données personnelles sont effacées au-delà de votre durée de conservation ;
        ces statistiques restent exactes car elles ne reposent sur aucun prénom.
      </p>
    </div>
  );
}
