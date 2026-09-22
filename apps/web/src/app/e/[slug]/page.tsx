import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { resolveEntryPoint, findActiveTicket } from '@/server/queue';
import { getClientSession } from '@/server/client-session';
import { vapidPublicKey } from '@/server/notifications/webpush';
import { ACTIVITY_LABEL } from '@/lib/copy';
import { ClientExperience } from './ClientExperience';
import styles from './client.module.css';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const entryPoint = await resolveEntryPoint(slug);
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
  if (!entryPoint) notFound();

  if (entryPoint.status === 'suspended') {
    return (
      <main className={styles.screen} data-theme="dark">
        <div className={`client-shell ${styles.inner}`}>
          <div className={styles.emptyState}>
            <p className="t-label">Indisponible</p>
            <h1 className="t-title">Cette file n&apos;est pas accessible</h1>
            <p className="t-body t-muted">
              L&apos;établissement a suspendu son service. Adressez-vous directement au comptoir.
            </p>
          </div>
        </div>
      </main>
    );
  }

  // Reprise automatique : si cet appareil a déjà un ticket, on l'affiche
  // sans rien demander. Le client qui revient sur la page retrouve sa
  // place exactement là où il l'avait laissée.
  const session = await getClientSession(entryPoint.organization.id);
  const initialTicket = session ? await findActiveTicket(session.id) : null;

  const source = (() => {
    const raw = typeof query.src === 'string' ? query.src : undefined;
    if (raw === 'nfc') return 'nfc' as const;
    if (raw === 'appclip') return 'appclip' as const;
    if (raw === 'link') return 'link' as const;
    return 'qr' as const;
  })();

  return (
    <main className={styles.screen} data-theme="dark" data-accent={entryPoint.settings.brandAccent}>
      <div className={`client-shell ${styles.inner}`}>
        <ClientExperience
          entryPoint={entryPoint}
          initialTicket={initialTicket}
          source={source}
          vapidPublicKey={vapidPublicKey()}
          activityLabel={ACTIVITY_LABEL[entryPoint.organization.activity] ?? null}
        />
      </div>
    </main>
  );
}
