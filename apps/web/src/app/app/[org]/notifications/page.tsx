import type { Metadata } from 'next';
import { requireOrgAccess } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { integrationStatus } from '@/lib/env';
import { notificationCopy } from '@/lib/copy';
import { getProfile, isLegacyProfile, isQueueProfile } from '@/lib/profiles';
import { profileNotificationCopy, type ProfileCopyContext } from '@/lib/profiles/copy';
import { resolveProfileOptions, reviewPolicy } from '@/lib/profiles/options';
import { formatTicketNo } from '@/lib/profiles/ticket';
import type { ProfileNotificationKind, ProfileOptions, QueueProfile } from '@/lib/profiles/types';
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
  // Profils métier (0032) : un changement d'étape, un devis, un rappel.
  stage_update: 'Étape du suivi',
  quote_ready: 'Devis à valider',
  recall: 'Rappel',
  // Événements et drops (0015).
  event_access: 'Accès à l’événement',
  event_sold_out: 'Événement complet',
  event_ended: 'Événement terminé',
};

interface PreviewItem { key: string; pos: string; posLabel: string; copy: { title: string; body: string } }

/**
 * Aperçu d'une file à métier : les textes EXACTS du métier
 * (`profileNotificationCopy`, le même appel que l'envoi réel), dans
 * l'ordre où ils partent, avec des valeurs d'exemple. Jamais de prénom ni
 * d'immatriculation complète : c'est la règle de l'écran verrouillé, et
 * l'aperçu la montre telle quelle (« FX-482-KL » devient « ••-••2-KL »).
 *
 * L'aperçu suit les RÉGLAGES de la file : sans devis en ligne, pas de
 * « Devis à valider » ; sans demande d'avis (ou « jamais », la santé),
 * pas de message de fin ; un avis différé porte son délai.
 */
function profilePreview(
  profile: QueueProfile,
  locationName: string,
  threshold: number,
  queue: { ticket_prefix?: string | null; absent_grace_minutes?: number | null },
  options: ProfileOptions,
): PreviewItem[] {
  const base: ProfileCopyContext = { profile, locationName };
  const item = (
    key: string, pos: string, posLabel: string, kind: ProfileNotificationKind, ctx: Partial<ProfileCopyContext> = {},
  ): PreviewItem => ({ key, pos, posLabel, copy: profileNotificationCopy(kind, { ...base, ...ctx }) });
  const hours = { status: 'open', closesAt: '19:00' } as const;
  const review = reviewPolicy(options);
  const reviewItem = (label: string, ctx: Partial<ProfileCopyContext> = {}): PreviewItem[] =>
    review.kind === 'never'
      ? []
      : [item('visit_completed', '✓', review.kind === 'delayed' ? `+${review.minutes} min` : label, 'visit_completed', ctx)];
  switch (profile) {
    case 'vehicle':
    case 'device': {
      const details = profile === 'vehicle'
        ? { registration: 'FX-482-KL', country: 'FR' as const, model: 'Peugeot 208' }
        : { deviceKind: 'phone' as const, model: 'iPhone 13' };
      const ticketNo = profile === 'device' ? formatTicketNo('device', 42) : null;
      const quotes = options.quotes !== false;
      const steps: PreviewItem[] = [
        item('stage_update', '1', 'reçu', 'stage_update', { stage: 'received', details, ticketNo }),
        ...(quotes
          ? [item('quote_ready', '2', 'devis', 'quote_ready', {
              details, quote: { amountCents: 18400, label: profile === 'vehicle' ? 'Plaquettes + disques AV' : 'Écran d’origine' },
            })]
          : []),
        item('stage_update:parts', '', 'pièce', 'stage_update', { stage: 'waiting_parts', details, ticketNo }),
        item('your_turn', '', 'prêt', 'your_turn', { details, ticketNo, hours }),
      ];
      // Les étapes se numérotent dans l'ordre où elles partent vraiment.
      steps.forEach((s, i) => { if (s.pos === '') s.pos = String(i + 1); });
      return [...steps, ...reviewItem('rendu', { details })];
    }
    case 'table':
      return [
        ...(threshold >= 2 ? [item('ahead_two', String(threshold), 'avant', 'ahead_two', { peopleAhead: threshold })] : []),
        item('ahead_one', '1', 'avant', 'ahead_one'),
        item('your_turn', '0', 'table', 'your_turn', { graceMinutes: queue.absent_grace_minutes ?? 5 }),
        item('recall', '!', 'rappel', 'recall', { remainingMinutes: 2 }),
        ...reviewItem('après'),
      ];
    case 'desk': {
      const ticketNo = formatTicketNo('desk', 42, queue.ticket_prefix ?? 'A');
      return [
        ...(threshold >= 2 ? [item('ahead_two', String(threshold), 'devant', 'ahead_two', { peopleAhead: threshold, ticketNo })] : []),
        item('ahead_one', '1', 'devant', 'ahead_one', { ticketNo }),
        item('your_turn', '0', 'appel', 'your_turn', { ticketNo, deskLabel: 'Guichet 3' }),
        item('recall', '!', 'rappel', 'recall', { ticketNo, deskLabel: 'Guichet 3' }),
        ...reviewItem('servi'),
      ];
    }
    case 'retail':
      return [
        item('stage_update', '1', 'prépa', 'stage_update', { stage: 'preparing', details: { orderRef: '1234' } }),
        item('your_turn', '0', 'prête', 'your_turn', { stage: 'ready', details: { orderRef: '1234' } }),
        ...reviewItem('remise'),
      ];
    default:
      return [];
  }
}

const CHANNEL_LABEL: Record<string, string> = {
  web_push: 'Navigateur (Android / PWA)',
  apns_appclip: 'App Clip iPhone',
  apns_app: 'Application iPhone',
  fcm: 'Firebase',
  // Alertes portées par un pass Wallet (« Bientôt votre tour »…) : une
  // ligne n'est écrite que quand Apple ou Google a accepté l'envoi.
  apple_wallet: 'Apple Wallet',
  google_wallet: 'Google Wallet',
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
/** Apostrophes typographiques pour l'affichage (les modèles utilisent « ' »). */
const typo = (text: string) => text.replace(/'/g, '’');
const typoCopy = (copy: { title: string; body: string }) => ({ title: typo(copy.title), body: typo(copy.body) });

export default async function NotificationsPage({
  params, searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ file?: string }>;
}) {
  const { org } = await params;
  const { file } = await searchParams;
  const access = await requireOrgAccess(org);
  const organizationId = access.organization.organization_id;
  const db = supabaseAdmin();
  const integrations = integrationStatus();

  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();

  const [{ data: deliveries }, { data: recent }, { data: locations }, { data: queues }] = await Promise.all([
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
      .eq('organization_id', organizationId).order('created_at'),
    // Toutes les files d'un coup : l'aperçu se règle sur celle choisie, et
    // un établissement à plusieurs métiers (atelier, salle, accueil) voit
    // les textes de chacun, pas seulement ceux de sa première file.
    db.from('queues')
      .select('id, name, location_id, notify_ahead_threshold, profile, profile_options, ticket_prefix, absent_grace_minutes')
      .eq('organization_id', organizationId).order('created_at'),
  ]);

  type QueueRow = {
    id: string; name: string; location_id: string; notify_ahead_threshold: number | null;
    profile: string | null; profile_options: unknown; ticket_prefix: string | null; absent_grace_minutes: number | null;
  };
  const locationList = (locations ?? []) as { id: string; name: string }[];
  const firstLocation = locationList[0] ?? null;
  const queueList = ((queues ?? []) as QueueRow[])
    // Ordre des établissements d'abord (le premier en tête), puis des files.
    .sort((a, b) => locationList.findIndex((l) => l.id === a.location_id) - locationList.findIndex((l) => l.id === b.location_id));
  const firstQueue = queueList.find((q) => q.id === file)
    ?? queueList.find((q) => q.location_id === firstLocation?.id)
    ?? null;
  const queueLocation = locationList.find((l) => l.id === firstQueue?.location_id) ?? firstLocation;
  // Le choix de file n'apparaît que si un métier est en jeu : un barbier
  // garde la page d'avant, au pixel près.
  const queueTabs = queueList.length > 1 && queueList.some((q) => !isLegacyProfile(q.profile)) ? queueList : [];

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
  const locationName = queueLocation?.name ?? access.organization.name;
  const threshold = Math.max(1, Number(firstQueue?.notify_ahead_threshold ?? 2));
  const queueProfile: QueueProfile = isQueueProfile(firstQueue?.profile) ? firstQueue.profile : 'walkin';
  const profiled = !isLegacyProfile(queueProfile);
  const preview: PreviewItem[] = profiled
    ? profilePreview(
        queueProfile, locationName, threshold, firstQueue ?? {},
        resolveProfileOptions(queueProfile, firstQueue?.profile_options),
      ).map((p) => ({ ...p, copy: typoCopy(p.copy) }))
    : [];
  if (!profiled && threshold >= 2) {
    preview.push({
      key: 'ahead_two', pos: String(threshold), posLabel: 'devant',
      copy: typoCopy(notificationCopy('ahead_two', { locationName, peopleAhead: threshold })),
    });
  }
  if (!profiled) preview.push(
    { key: 'ahead_one', pos: '1', posLabel: 'devant', copy: typoCopy(notificationCopy('ahead_one', { locationName })) },
    { key: 'your_turn', pos: '0', posLabel: 'à vous', copy: typoCopy(notificationCopy('your_turn', { locationName })) },
    { key: 'visit_completed', pos: '✓', posLabel: 'servi', copy: typoCopy(notificationCopy('visit_completed', { locationName })) },
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
            {queueTabs.length > 0 && firstQueue && (
              <nav className="seg" aria-label="File de l’aperçu" style={{ marginTop: 12, maxWidth: '100%', overflowX: 'auto' }}>
                {queueTabs.map((q) => (
                  <a
                    key={q.id}
                    href={`/app/${org}/notifications?file=${encodeURIComponent(q.id)}`}
                    aria-current={q.id === firstQueue.id ? 'page' : undefined}
                  >
                    {locationList.length > 1
                      ? `${locationList.find((l) => l.id === q.location_id)?.name ?? ''} · ${q.name}`
                      : q.name}
                  </a>
                ))}
              </nav>
            )}
            {profiled ? (
              <p className={styles.previewDesc}>
                Les textes exacts du métier « {getProfile(queueProfile).label} » de « {firstQueue?.name} », au nom de {locationName},
                avec des valeurs d’exemple et ses réglages. Jamais de prénom ni d’immatriculation complète sur l’écran verrouillé.
              </p>
            ) : (
              <p className={styles.previewDesc}>
                Les textes exacts, au nom de {locationName}. La première part à {threshold}{' '}
                personne{threshold > 1 ? 's' : ''} devant : c’est réglable dans Réglages.
              </p>
            )}
          </div>
          <ol className={styles.lock}>
            {preview.map((item, i) => (
              <Reveal as="li" key={item.key} index={i} className={styles.lockItem} data-kind={item.key.split(':')[0]}>
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
                    ? (access.user.isPlatformAdmin
                      ? "APNs n’est pas configuré : les App Clips iPhone ne peuvent pas recevoir de notification. Voir SETUP.md, section Apple."
                      : "Les notifications iPhone ne sont pas encore disponibles : vos clients sur iPhone suivent leur position à l’écran, en temps réel.")
                    : (access.user.isPlatformAdmin
                      ? "Web Push n’est pas configuré : les clients Android ne peuvent pas être prévenus. Générez une paire de clés VAPID (npm run keys:vapid)."
                      : "Les notifications Android ne sont pas encore disponibles : vos clients sur Android suivent leur position à l’écran, en temps réel.")}
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
                  {row.body && <p className={styles.logBody}>« {typo(row.body)} »</p>}
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
