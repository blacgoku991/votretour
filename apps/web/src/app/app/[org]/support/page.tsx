import type { Metadata } from 'next';
import { requireOrgAccess } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { PageHeader, Section } from '@/components/Page';
import { SupportForm } from './SupportForm';
import { formatDateTime } from '@/lib/format';
import styles from './support.module.css';

export const metadata: Metadata = { title: 'Support', robots: { index: false } };
export const dynamic = 'force-dynamic';

const STATUS_LABEL: Record<string, string> = {
  open: 'Ouvert', pending: 'En attente', resolved: 'Résolu', closed: 'Clos',
};

const HELP = [
  {
    q: 'Mon QR code ne fait rien quand je le scanne',
    a: "Vérifiez que la file est ouverte (onglet File) et que la plaque est active (onglet Plaques & QR). Une plaque désactivée affiche un message d’indisponibilité au lieu d’ouvrir la file.",
  },
  {
    q: 'Le client dit qu’il n’a pas reçu de notification',
    a: "L’onglet Notifications montre exactement ce qui a été envoyé, et les échecs. Sur iPhone sans App Clip, un client qui n’a pas installé le site sur son écran d’accueil ne peut pas recevoir de notification navigateur : l’écran le lui dit et l’invite à garder la page ouverte.",
  },
  {
    q: 'Comment écrire l’URL sur un tag NFC ?',
    a: "Utilisez un tag NTAG213 ou NTAG215 et une application d’écriture NFC. Écrivez l’URL de la plaque en enregistrement URI. Aucun réglage supplémentaire n’est nécessaire.",
  },
  {
    q: 'Un client est parti, que faire ?',
    a: "Bouton « Absent » sur sa ligne. Selon votre réglage, il recule de quelques places, est mis de côté, ou sort de la file. Vous pouvez toujours le remettre en file ensuite.",
  },
  {
    q: 'Où trouver mon lien d’avis Google ?',
    a: "Sur votre fiche Google Business Profile, cliquez sur « Demander des avis » : Google affiche un lien court. Collez-le dans Réglages → Avis Google.",
  },
];

export default async function SupportPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const access = await requireOrgAccess(org);
  const db = supabaseAdmin();

  const { data: tickets } = await db
    .from('support_tickets')
    .select('id, subject, category, status, priority, created_at')
    .eq('organization_id', access.organization.organization_id)
    .order('created_at', { ascending: false })
    .limit(20);

  return (
    <div className={`shell ${styles.page}`}>
      <PageHeader
        title="Support"
        description="Les réponses aux questions les plus fréquentes, et un moyen de nous joindre."
      />

      <Section title="Questions fréquentes">
        <div className={styles.faq}>
          {HELP.map((item) => (
            <details key={item.q} className={styles.faqItem}>
              <summary>{item.q}</summary>
              <p>{item.a}</p>
            </details>
          ))}
        </div>
      </Section>

      <Section title="Nous écrire" description="Nous répondons à l’adresse de votre compte.">
        <div className={styles.formWrap}>
          <SupportForm organizationId={access.organization.organization_id} />
        </div>
      </Section>

      {(tickets ?? []).length > 0 && (
        <Section title="Vos demandes">
          {(tickets ?? []).map((ticket) => (
            <div key={ticket.id} className={styles.ticket}>
              <div className={styles.ticketText}>
                <p className={styles.ticketSubject}>{ticket.subject}</p>
                <p className="t-micro t-faint">{formatDateTime(ticket.created_at)}</p>
              </div>
              <span className={ticket.status === 'resolved' ? 'chip chip--jade' : 'chip'}>
                {STATUS_LABEL[ticket.status] ?? ticket.status}
              </span>
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}
