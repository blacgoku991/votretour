import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { resolveEntryPoint, findActiveTicket } from '@/server/queue';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getClientSession } from '@/server/client-session';
import { vapidPublicKey } from '@/server/notifications/webpush';
import { ACTIVITY_LABEL } from '@/lib/copy';
import type { EntryPoint } from '@/lib/types';
import { ClientExperience, type StaffGate } from './ClientExperience';
import { UnassignedPlate } from './UnassignedPlate';
import { ProfileExperience, type ProfileEntryPoint } from './profiles/ProfileExperience';
import { findUnassignedStockPlate } from '@/server/plate-stock';
import { getSessionUser } from '@/server/auth';
import styles from './client.module.css';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const entryPoint = await resolveEntryPoint(slug);
  if (!entryPoint && await findUnassignedStockPlate(slug)) {
    return { title: 'Plaque à activer', robots: { index: false, follow: false } };
  }
  if (!entryPoint || entryPoint.status !== 'ok') {
    return { title: 'Établissement introuvable', robots: { index: false } };
  }
  return {
    title: `${entryPoint.location.name} — rejoindre la file`,
    description: `Rejoignez la file de ${entryPoint.location.name} depuis votre téléphone. Vous voyez combien de personnes sont devant vous et vous pouvez partir.`,
    // Une page de file est une page transactionnelle, pas un contenu à
    // indexer : on évite qu'elle remonte dans les résultats de recherche.
    robots: { index: false, follow: false },
  };
}

/**
 * Point d'entrée public /e/{slug}.
 *
 * Le slug désigne soit un établissement, soit une plaque physique
 * précise. Le tag NFC et le QR code encodent exactement cette URL : le
 * parcours est donc rigoureusement identique, qu'on approche son
 * téléphone ou qu'on scanne.
 *
 * Sur iPhone, c'est aussi l'URL d'invocation de l'App Clip : Apple ouvre
 * l'App Clip natif au lieu de cette page dès que l'expérience avancée
 * est déclarée pour ce domaine. Cette page reste donc le parcours
 * Android, le parcours de secours iPhone et la cible du bandeau
 * Smart App Banner.
 */
export default async function EntryPointPage({ params, searchParams }: PageProps) {
  const { slug } = await params;
  const query = await searchParams;

  const entryPoint = await resolveEntryPoint(slug);
  if (!entryPoint) {
    // Une plaque du stock fournisseur, livrée mais pas encore attribuée :
    // un message utile plutôt qu'une page introuvable. La session n'est
    // lue que dans ce cas rare, pour proposer l'attribution au
    // super-admin qui scanne la plaque en l'installant.
    const stockPlate = await findUnassignedStockPlate(slug);
    if (stockPlate) {
      const viewer = await getSessionUser().catch(() => null);
      return <UnassignedPlate plate={stockPlate} isPlatformAdmin={viewer?.isPlatformAdmin === true} />;
    }
    notFound();
  }

  let effectiveEntryPoint = entryPoint;
  let eventId: string | null = null;
  let eventTheme: {
    name: string;
    heroTitle: string | null;
    logoUrl: string | null;
    coverUrl: string | null;
    accentHex: string;
    rulesText: string | null;
    qrLabel: string | null;
  } | null = null;

  const requestedEventId = typeof query.event === 'string' ? query.event : null;
  if (
    requestedEventId
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedEventId)
    && entryPoint.status === 'ok'
  ) {
    const db = supabaseAdmin();
    const { data: event } = await db
      .from('event_campaigns')
      .select('id, queue_id, status, name, hero_title, logo_url, cover_url, accent_hex, rules_text, qr_label')
      .eq('id', requestedEventId)
      .eq('organization_id', entryPoint.organization.id)
      .eq('location_id', entryPoint.location.id)
      .in('status', ['live', 'paused'])
      .maybeSingle();

    if (event) {
      const [{ data: queue }, { count: waitingCount }] = await Promise.all([
        db.from('queues')
          .select('id, name, mode, status, ask_client_name, client_name_required, allow_staff_choice, allow_service_choice, pause_reason')
          .eq('id', event.queue_id)
          .eq('organization_id', entryPoint.organization.id)
          .eq('location_id', entryPoint.location.id)
          .maybeSingle(),
        db.from('queue_entries')
          .select('id', { count: 'exact', head: true })
          .eq('queue_id', event.queue_id)
          .in('status', ['waiting', 'notified', 'returning', 'present', 'next', 'serving']),
      ]);

      if (queue) {
        eventId = event.id;
        eventTheme = {
          name: event.name,
          heroTitle: event.hero_title ?? null,
          logoUrl: event.logo_url ?? null,
          coverUrl: event.cover_url ?? null,
          accentHex: event.accent_hex ?? '#FF4B1F',
          rulesText: event.rules_text ?? null,
          qrLabel: event.qr_label ?? null,
        };
        effectiveEntryPoint = {
          ...entryPoint,
          queue: {
            id: queue.id,
            name: queue.name,
            mode: queue.mode,
            status: queue.status,
            askClientName: queue.ask_client_name,
            clientNameRequired: queue.client_name_required,
            allowStaffChoice: queue.allow_staff_choice,
            allowServiceChoice: queue.allow_service_choice,
            pauseReason: queue.pause_reason,
            waitingCount: waitingCount ?? 0,
          },
        };
      }
    }
  }

  if (effectiveEntryPoint.status === 'suspended') {
    return (
      <main className={styles.screen} data-theme="dark">
        <span className={`floor-marks ${styles.sideMarks}`} aria-hidden="true" />
        <div className={`client-shell ${styles.inner}`}>
          <div className={styles.emptyState}>
            <p className="t-label">Indisponible</p>
            <h1 className="t-title">Cette file n’est pas accessible</h1>
            <p className="t-body t-muted">
              L’établissement a suspendu son service. Adressez-vous directement au comptoir.
            </p>
          </div>
        </div>
      </main>
    );
  }

  // Reprise automatique : si cet appareil a déjà un ticket, on l'affiche
  // sans rien demander. Le client qui revient sur la page retrouve sa
  // place exactement là où il l'avait laissée.
  const session = await getClientSession(effectiveEntryPoint.organization.id);
  const initialTicket = session ? await findActiveTicket(session.id) : null;

  const staffGate = await readStaffGate(effectiveEntryPoint.queue);

  const source = (() => {
    const raw = typeof query.src === 'string' ? query.src : undefined;
    if (raw === 'nfc') return 'nfc' as const;
    if (raw === 'appclip') return 'appclip' as const;
    if (raw === 'link') return 'link' as const;
    return 'qr' as const;
  })();

  // Profils métier (atelier, table, guichet, boutique) : leur propre
  // écran. Walkin, event et toute campagne d'événement gardent
  // ClientExperience ci-dessous, inchangée.
  const profile = (effectiveEntryPoint as ProfileEntryPoint).queue?.profile ?? 'walkin';
  if (profile !== 'walkin' && profile !== 'event' && !eventId) {
    return (
      <main className={styles.screen} data-theme="dark" data-accent={entryPoint.settings.brandAccent}>
        <span className={`floor-marks ${styles.sideMarks}`} aria-hidden="true" />
        <div className={`client-shell ${styles.inner}`}>
          <ProfileExperience
            entryPoint={effectiveEntryPoint as ProfileEntryPoint}
            initialTicket={initialTicket}
            source={source}
            staffGate={staffGate}
            vapidPublicKey={vapidPublicKey()}
            activityLabel={ACTIVITY_LABEL[entryPoint.organization.activity] ?? null}
            walletSlot={null}
          />
        </div>
      </main>
    );
  }

  return (
    <main className={styles.screen} data-theme="dark" data-accent={entryPoint.settings.brandAccent}>
      {/* À partir de 600 px, les côtés deviennent le sol (marquage discret). */}
      <span className={`floor-marks ${styles.sideMarks}`} aria-hidden="true" />
      <div className={`client-shell ${styles.inner}`}>
        <ClientExperience
          entryPoint={effectiveEntryPoint}
          initialTicket={initialTicket}
          eventId={eventId}
          eventTheme={eventTheme}
          source={source}
          staffGate={staffGate}
          vapidPublicKey={vapidPublicKey()}
          activityLabel={ACTIVITY_LABEL[entryPoint.organization.activity] ?? null}
        />
      </div>
    </main>
  );
}

/**
 * Qui peut prendre la file, lu au rendu.
 *
 * Reproduit EXACTEMENT la règle de join_queue (VT008) : en mode
 * « par professionnel », sans choix explicite retenu, l’inscription
 * échoue si aucun professionnel du lieu de la file n’est actif,
 * n’accepte la file et n’est hors pause. Un choix explicite n’est
 * retenu que pour un professionnel actif qui accepte la file (même en
 * pause). Hors de ce mode, aucune condition : null.
 */
async function readStaffGate(queue: EntryPoint['queue']): Promise<StaffGate | null> {
  if (!queue || queue.mode !== 'per_staff') return null;
  try {
    const db = supabaseAdmin();
    const { data: row } = await db
      .from('queues')
      .select('location_id')
      .eq('id', queue.id)
      .maybeSingle();
    if (!row) return null;
    const { data: staff, error } = await db
      .from('staff')
      .select('id, is_on_break')
      .eq('location_id', row.location_id)
      .eq('is_active', true)
      .eq('accepts_queue', true);
    if (error || !staff) return null;
    return {
      autoAssign: staff.some((s) => !s.is_on_break),
      eligibleIds: staff.map((s) => s.id),
    };
  } catch {
    // Lecture impossible : on ne promet rien de plus qu’avant ; le refus
    // éventuel du serveur reste affiché près du bouton.
    return null;
  }
}
