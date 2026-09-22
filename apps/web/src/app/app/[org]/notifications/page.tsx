import type { Metadata } from 'next';
import { requireOrgAccess } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { integrationStatus } from '@/lib/env';
import { PageHeader, Section, SettingRow, Stat, EmptyState } from '@/components/Page';
import { formatDateTime, formatNumber, relativeTime } from '@/lib/format';
import styles from './notifications.module.css';

export const metadata: Metadata = { title: 'Notifications', robots: { index: false } };
export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<string, string> = {
  ahead_two: 'Plus que N personnes',
  ahead_one: 'Plus qu’une personne',
  your_turn: 'C’est votre tour',
  visit_completed: 'Merci pour votre visite',
  removed: 'Retiré de la file',
  queue_closed: 'File fermée',
  custom: 'Message',
};

const CHANNEL_LABEL: Record<string, string> = {
  web_push: 'Navigateur (Android / PWA)',
  apns_appclip: 'App Clip iPhone',
  apns_app: 'Application iPhone',
  fcm: 'Firebase',
};

/**
 * NOTIFICATIONS.
 *
 * Cette page ne montre PAS ce que le produit « devrait » envoyer : elle
 * montre ce que les fournisseurs ont réellement accepté, ligne par
 * ligne, avec les échecs. C'est la contrepartie de la règle « aucune
 * interface n'annonce un envoi qui n'a pas eu lieu ».
 */
export default async function NotificationsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const access = await requireOrgAccess(org);
  const organizationId = access.organization.organization_id;
  const db = supabaseAdmin();
  const integrations = integrationStatus();

  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [{ data: deliveries }, { data: recent }] = await Promise.all([
    db.from('notification_deliveries')
      .select('status, channel, kind')
      .eq('organization_id', organizationId)
      .gte('created_at', since),
    db.from('notification_deliveries')
      .select('id, kind, channel, status, title, body, error, created_at, sent_at, entry_public_id')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(40),
  ]);

  const all = deliveries ?? [];
  const sent = all.filter((d) => d.status === 'sent').length;
  const failed = all.filter((d) => d.status === 'failed').length;
  const skipped = all.filter((d) => d.status === 'skipped').length;

  const byChannel = all.reduce<Record<string, number>>((acc, d) => {
    if (!d.channel) return acc;
    acc[d.channel] = (acc[d.channel] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className={`shell ${styles.page}`}>
      <PageHeader
        title="Notifications"
        description="Ce que vos clients ont réellement reçu, avec les échecs. Rien n’est compté comme envoyé sans accusé du fournisseur."
      />

      {/* ---------------- Canaux disponibles ---------------- */}
      <Section
        title="Canaux"
        description="Chaque appareil utilise le canal qui lui convient. Aucun SMS, aucun e-mail client."
      >
        <SettingRow
          label="App Clip iPhone (APNs)"
          hint="Notifications éphémères, 8 h après chaque lancement de l’App Clip — c’est la limite fixée par Apple."
        >
          <StatusPill ok={integrations.apns} okLabel="Configuré" koLabel="Non configuré" />
        </SettingRow>
        <SettingRow
          label="Navigateur (Web Push / VAPID)"
          hint="Android, et iPhone si le site a été ajouté à l’écran d’accueil."
        >
          <StatusPill ok={integrations.webPush} okLabel="Configuré" koLabel="Non configuré" />
        </SettingRow>
        <SettingRow
          label="Quand aucun canal n’est disponible"
          hint="L’écran client le dit franchement et invite à garder la page ouverte : la position reste à jour en temps réel."
        >
          <span className="chip">Suivi à l’écran</span>
        </SettingRow>
      </Section>

      {(!integrations.apns || !integrations.webPush) && (
        <div className="banner banner--warn">
          <span>
            {!integrations.apns && !integrations.webPush
              ? "Aucun canal de notification n’est configuré sur cette installation. Les clients suivent leur position à l’écran, en temps réel — mais ils ne seront pas prévenus s’ils quittent la page."
              : !integrations.apns
                ? "APNs n’est pas configuré : les App Clips iPhone ne peuvent pas recevoir de notification. Voir SETUP.md, section Apple."
                : "Web Push n’est pas configuré : les clients Android ne peuvent pas être prévenus. Générez une paire de clés VAPID (npm run keys:vapid)."}
          </span>
        </div>
      )}

      {/* ---------------- Sur 7 jours ---------------- */}
      <div className={styles.statGrid}>
        <Stat accent label="Envoyées" value={formatNumber(sent)} hint="7 derniers jours" />
        <Stat label="En échec" value={formatNumber(failed)}
          hint={failed > 0 ? 'appareil injoignable ou jeton expiré' : 'aucun échec'} />
        <Stat label="Sans destinataire" value={formatNumber(skipped)}
          hint="client ajouté au comptoir, ou notifications refusées" />
        <Stat label="Canaux utilisés"
          value={String(Object.keys(byChannel).length)}
          hint={Object.keys(byChannel).map((c) => CHANNEL_LABEL[c] ?? c).join(', ') || '—'} />
      </div>

      {/* ---------------- Journal ---------------- */}
      <Section title="Journal des envois" description="Les 40 derniers, du plus récent au plus ancien.">
        {(recent ?? []).length === 0 ? (
          <EmptyState
            title="Aucun envoi pour l’instant"
            description="Les notifications partent automatiquement quand la file avance : plus que deux personnes, plus qu’une, c’est votre tour, puis merci."
          />
        ) : (
          <div className={styles.log}>
            {(recent ?? []).map((row) => (
              <div key={row.id} className={styles.logRow}>
                <span className={`${styles.dot} ${
                  row.status === 'sent' ? styles.dotSent
                  : row.status === 'failed' ? styles.dotFailed
                  : styles.dotSkipped
                }`} />
                <div className={styles.logText}>
                  <p className={styles.logTitle}>
                    {KIND_LABEL[row.kind] ?? row.kind}
                    {row.channel && (
                      <span className="t-micro t-faint"> · {CHANNEL_LABEL[row.channel] ?? row.channel}</span>
                    )}
                  </p>
                  <p className="t-micro t-faint">
                    {row.status === 'sent'
                      ? `Remis au fournisseur ${relativeTime(row.sent_at ?? row.created_at)}`
                      : row.status === 'failed'
                        ? `Échec : ${row.error ?? 'raison inconnue'}`
                        : `Non envoyée : ${row.error ?? 'aucun destinataire'}`}
                  </p>
                  {row.body && <p className={styles.logBody}>« {row.body} »</p>}
                </div>
                <span className={`t-micro t-faint ${styles.logTime}`}>
                  {formatDateTime(row.created_at)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function StatusPill({ ok, okLabel, koLabel }: { ok: boolean; okLabel: string; koLabel: string }) {
  return (
    <span className={ok ? 'chip chip--jade' : 'chip chip--brique'}>
      {ok ? okLabel : koLabel}
    </span>
  );
}
