import type { Metadata } from 'next';
import { requireOrgAccess } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { PageHeader } from '@/components/Page';
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
    a: "Vérifiez que la file est ouverte (onglet File) puis scannez la plaque avec votre propre téléphone. Si elle affiche un message d’indisponibilité, c’est qu’elle a été désactivée : écrivez-nous ci-dessous, les plaques sont gérées par l’équipe Rangvia.",
  },
  {
    q: 'Le client dit qu’il n’a pas reçu de notification',
    a: "L’onglet Notifications montre exactement ce qui a été envoyé, et les échecs. Sur iPhone sans App Clip, un client qui n’a pas installé le site sur son écran d’accueil ne peut pas recevoir de notification navigateur : l’écran le lui dit et l’invite à garder la page ouverte.",
  },
  {
    q: 'Comment écrire l’URL sur un tag NFC ?',
    a: "Utilisez un tag NTAG213 ou NTAG215 et une application d’écriture NFC. Écrivez l’URL de la plaque en enregistrement URI. Aucun réglage supplémentaire n’est nécessaire.",
  },
  {
    q: 'Un client est parti, que faire ?',
    a: "Bouton « Absent » sur sa ligne. Selon votre réglage, il recule de quelques places, est mis de côté, ou sort de la file. Vous pouvez toujours le remettre en file ensuite.",
  },
  {
    q: 'Où trouver mon lien d’avis Google ?',
    a: "Sur votre fiche Google Business Profile, cliquez sur « Demander des avis » : Google affiche un lien court. Collez-le dans Réglages → Avis Google.",
  },
];

/**
 * SUPPORT — questions fréquentes accrochées au rail, formulaire sur une
 * carte (rayon 14) aux champs sur rail, demandes en liste-rail. Sobre.
 */
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

      <div className={styles.grid}>
        <section className={styles.block} aria-labelledby="faq">
          <h2 id="faq" className={`t-label ${styles.head}`}>Questions fréquentes</h2>
          <ul className={`rail-list ${styles.faq}`}>
            {HELP.map((item) => (
              <li key={item.q}>
                <details className={styles.faqItem}>
                  <summary>
                    <span>{item.q}</span>
                    <span className={styles.plus} aria-hidden="true" />
                  </summary>
                  <p>{item.a}</p>
                </details>
              </li>
            ))}
          </ul>
        </section>

        <section className={styles.block} aria-labelledby="ecrire">
          <div>
            <h2 id="ecrire" className={`t-label ${styles.head}`}>Nous écrire</h2>
            <p className={styles.desc}>Nous répondons à l’adresse de votre compte.</p>
          </div>
          <div className={`card ${styles.card}`}>
            <SupportForm organizationId={access.organization.organization_id} />
          </div>
        </section>
      </div>

      {(tickets ?? []).length > 0 && (
        <section className={styles.block} aria-labelledby="demandes">
          <h2 id="demandes" className={`t-label ${styles.head}`}>Vos demandes</h2>
          <ol className={`rail-list ${styles.tickets}`}>
            {(tickets ?? []).map((ticket) => (
              <li key={ticket.id} data-status={ticket.status}>
                <div className={styles.ticketText}>
                  <p className={styles.ticketSubject}>{ticket.subject}</p>
                  <p className={`t-num ${styles.ticketDate}`}>{formatDateTime(ticket.created_at)}</p>
                </div>
                <span className={ticket.status === 'resolved' ? 'chip chip--jade' : 'chip'}>
                  {STATUS_LABEL[ticket.status] ?? ticket.status}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
