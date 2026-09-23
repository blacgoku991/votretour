import type { Metadata } from 'next';
import { requireOrgAccess } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { integrationStatus } from '@/lib/env';
import { notificationCopy } from '@/lib/copy';
import { PageHeader, Section, SettingRow, Stat, EmptyState } from '@/components/Page';
import { Reveal } from '@/components/motion/Reveal';
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

const STATUS_LABEL: Record<string, string> = {
  sent: 'Remise',
  failed: 'Échec',
  skipped: 'Non envoyée',
};

/**
 * NOTIFICATIONS.
 *
 * Cette page ne montre PAS ce que le produit « devrait » envoyer : elle
 * montre ce que les fournisseurs ont réellement accepté, ligne par
 * ligne, avec les échecs. C'est la contrepartie de la règle « aucune
 * interface n'annonce un envoi qui n'a pas eu lieu ».
 *
 * En tête, l'aperçu reprend les textes EXACTS de notificationCopy, au
 * nom de votre établissement et avec votre seuil « Prévenir à partir
 * de » : chaque message est accroché à la place du rail d'où il part.
 */
export default async function NotificationsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const access = await requireOrgAccess(org);
  const organizationId = access.organization.organization_id;
  const db = supabaseAdmin();
  const integrations = integrationStatus();

  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [{ data: deliveries }, { data: recent }, { data: firstLocation }] = await Promise.all([
    db.from('notification_deliveries')
      .select('status, channel, kind')
      .eq('organization_id', organizationId)
      .gte('created_at', since),
    db.from('notification_deliveries')
      .select('id, kind, channel, status, title, body, error, created_at, sent_at, entry_public_id')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })
      .limit(40),
    db.from('locations').select('id, name')
      .eq('organization_id', organizationId).order('created_at').limit(1).maybeSingle(),
  ]);

  const { data: firstQueue } = firstLocation
    ? await db.from('queues').select('notify_ahead_threshold')
        .eq('location_id', firstLocation.id).order('created_at').limit(1).maybeSingle()
    : { data: null };

  const all = deliveries ?? [];
  const sent = all.filter((d) => d.status === 'sent').length;
  const failed = all.filter((d) => d.status === 'failed').length;
  const skipped = all.filter((d) => d.status === 'skipped').length;

  const byChannel = all.reduce<Record<string, number>>((acc, d) => {
    if (!d.channel) return acc;
    acc[d.channel] = (acc[d.channel] ?? 0) + 1;
    return acc;
  }, {});

  // ---- Aperçu : les vrais messages, dans l'ordre où ils partent ----
  const locationName = firstLocation?.name ?? access.organization.name;
  const threshold = Math.max(1, Number(firstQueue?.notify_ahead_threshold ?? 2));
  const preview: { key: string; pos: string; posLabel: string; copy: { title: string; body: string } }[] = [];
  if (threshold >= 2) {
    preview.push({
      key: 'ahead_two', pos: String(threshold), posLabel: 'devant',
      copy: notificationCopy('ahead_two', { locationName, peopleAhead: threshold }),
    });
  }
  preview.push(
    { key: 'ahead_one', pos: '1', posLabel: 'devant', copy: notificationCopy('ahead_one', { locationName }) },
    { key: 'your_turn', pos: '0', posLabel: 'à vous', copy: notificationCopy('your_turn', { locationName }) },
    { key: 'visit_completed', pos: '✓', posLabel: 'servi', copy: notificationCopy('visit_completed', { locationName }) },
  );

  return (
    <div className={`shell ${styles.page}`}>
      <PageHeader
        title="Notifications"
        description="Ce que vos clients ont réellement reçu, avec les échecs. Rien n’est compté comme envoyé sans accusé du fournisseur."
      />

      <div className={styles.top}>
        {/* ---------------- Aperçu ---------------- */}
        <section className={styles.preview} aria-labelledby="apercu-titre">
          <div className={styles.previewHead}>
            <h2 id="apercu-titre" className={`t-label ${styles.previewTitle}`}>Ce que reçoivent vos clients</h2>
            <p className={styles.previewDesc}>
              Les textes exacts, au nom de {locationName}. La première part à {threshold}{' '}
              personne{threshold > 1 ? 's' : ''} devant : c’est réglable dans Réglages.
            </p>
          </div>
          <ol className={styles.lock}>
            {preview.map((item, i) => (
              <Reveal as="li" key={item.key} index={i} className={styles.lockItem} data-kind={item.key}>
                <span className={styles.pos} aria-hidden="true">
                  <span className={styles.posNum}>{item.pos}</span>
                  <span className={styles.posLbl}>{item.posLabel}</span>
                </span>
                <div className={styles.notif}>
                  <p className={styles.notifApp}>
                    <span className={styles.appIcon} aria-hidden="true"><i /><i /><i /></span>
                    <span>Rangvia</span>
                    <span className={styles.notifWhen}>maintenant</span>
                  </p>
                  <p className={styles.notifTitle}>{item.copy.title}</p>
                  <p className={styles.notifBody}>{item.copy.body}</p>
                </div>
              </Reveal>
            ))}
          </ol>
        </section>

        {/* ---------------- Canaux disponibles ---------------- */}
        <div className={styles.side}>
          <Section
            title="Canaux"
            description="Chaque appareil utilise le canal qui lui convient. Aucun SMS, aucun e-mail client."
          >
            <SettingRow
              label="App Clip iPhone (APNs)"
              hint="Notifications éphémères, 8 h après chaque lancement de l’App Clip : c’est la limite fixée par Apple."
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
              hint="L’écran client le dit franchement et invite à garder la page ouverte : la position reste à jour en temps réel."
            >
              <span className="chip">Suivi à l’écran</span>
            </SettingRow>
          </Section>

          {(!integrations.apns || !integrations.webPush) && (
            <div className="banner banner--warn">
              <span>
                {!integrations.apns && !integrations.webPush
                  ? "Aucun canal de notification n’est configuré sur cette installation. Les clients suivent leur position à l’écran, en temps réel, mais ils ne seront pas prévenus s’ils quittent la page."
                  : !integrations.apns
                    ? "APNs n’est pas configuré : les App Clips iPhone ne peuvent pas recevoir de notification. Voir SETUP.md, section Apple."
                    : "Web Push n’est pas configuré : les clients Android ne peuvent pas être prévenus. Générez une paire de clés VAPID (npm run keys:vapid)."}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ---------------- Sur 7 jours ---------------- */}
      <section className={styles.kpis} aria-labelledby="sept-jours">
        <h2 id="sept-jours" className="t-label">Sur 7 jours</h2>
        <div className={`kpi-band ${styles.band}`}>
          <Stat accent label="Envoyées" value={formatNumber(sent)} hint={sent <= 1 ? 'remise au fournisseur' : 'remises au fournisseur'} />
          <Stat label="En échec" value={formatNumber(failed)}
            hint={failed > 0 ? 'appareil injoignable ou jeton expiré' : 'aucun échec'} />
          <Stat label="Sans destinataire" value={formatNumber(skipped)}
            hint={skipped <= 1 ? 'client ajouté au comptoir ou notification refusée' : 'clients ajoutés au comptoir ou notifications refusées'} />
          <Stat label="Canaux utilisés"
            value={String(Object.keys(byChannel).length)}
            hint={Object.keys(byChannel).map((c) => CHANNEL_LABEL[c] ?? c).join(', ') || 'aucun pour l’instant'} />
        </div>
      </section>

      {/* ---------------- Journal ---------------- */}
      <section className={styles.journal} aria-labelledby="journal-titre">
        <div>
          <h2 id="journal-titre" className="t-label">Journal des envois</h2>
          <p className={styles.journalDesc}>Les 40 derniers, du plus récent au plus ancien.</p>
        </div>
        {(recent ?? []).length === 0 ? (
          <Section>
            <EmptyState
              title="Aucun envoi pour l’instant"
              description="Les notifications partent automatiquement quand la file avance : plus que deux personnes, plus qu’une, c’est votre tour, puis merci."
            />
          </Section>
        ) : (
          <ol className={`rail-list ${styles.log}`}>
            {(recent ?? []).map((row) => (
              <li key={row.id} data-status={row.status}>
                <div className={styles.logMain}>
                  <p className={styles.logTitle}>
                    <span>{KIND_LABEL[row.kind] ?? row.kind}</span>
                    <span className={styles.logStatus} data-status={row.status}>
                      {STATUS_LABEL[row.status] ?? row.status}
                    </span>
                  </p>
                  <p className={styles.logDetail}>
                    {row.status === 'sent'
                      ? `Remise au fournisseur ${relativeTime(row.sent_at ?? row.created_at)}`
                      : row.status === 'failed'
                        ? `Échec : ${row.error ?? 'raison inconnue'}`
                        : `Non envoyée : ${row.error ?? 'aucun destinataire'}`}
                    {row.channel && <> · {CHANNEL_LABEL[row.channel] ?? row.channel}</>}
                  </p>
                  {row.body && <p className={styles.logBody}>« {row.body} »</p>}
                </div>
                <span className={`t-num ${styles.logTime}`}>{formatDateTime(row.created_at)}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
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
