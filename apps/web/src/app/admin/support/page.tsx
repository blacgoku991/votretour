import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requirePlatformAdmin } from '@/server/auth';
import { PageHeader, Section, EmptyState } from '@/components/Page';
import { formatDateTime, relativeTime } from '@/lib/format';
import { TicketThread } from './TicketThread';
import styles from '../admin.module.css';

export const metadata: Metadata = { title: 'Support', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function AdminSupportPage() {
  // Chaque page revérifie le rôle elle-même : une requête RSC forgée
  // peut sauter le layout /admin, jamais la page qu'elle demande.
  await requirePlatformAdmin();
  const db = supabaseAdmin();

  const { data: tickets } = await db
    .from('support_tickets')
    .select('id, subject, category, status, priority, created_at, organization_id, organizations(name)')
    .order('created_at', { ascending: false })
    .limit(60);

  const ids = (tickets ?? []).map((t) => t.id);
  const { data: messages } = ids.length
    ? await db.from('support_messages')
        .select('id, ticket_id, body, is_staff_reply, created_at')
        .in('ticket_id', ids).order('created_at')
    : { data: [] };

  const byTicket = new Map<string, typeof messages>();
  for (const message of messages ?? []) {
    const list = byTicket.get(message.ticket_id) ?? [];
    list.push(message);
    byTicket.set(message.ticket_id, list);
  }

  return (
    <div className={`shell ${styles.page}`}>
      <PageHeader title="Support" description="Les demandes reçues, de la plus récente à la plus ancienne." />
      <Section>
        {(tickets ?? []).length === 0 ? (
          <EmptyState title="Aucune demande" description="Les demandes des professionnels arriveront ici." />
        ) : (
          (tickets ?? []).map((ticket) => {
            const org = Array.isArray(ticket.organizations) ? ticket.organizations[0] : ticket.organizations;
            return (
              <TicketThread
                key={ticket.id}
                ticket={{
                  id: ticket.id,
                  subject: ticket.subject,
                  category: ticket.category,
                  status: ticket.status,
                  organizationName: org?.name ?? '—',
                  createdAt: formatDateTime(ticket.created_at),
                  age: relativeTime(ticket.created_at),
                }}
                messages={(byTicket.get(ticket.id) ?? []).map((m) => ({
                  id: m.id,
                  body: m.body,
                  isStaffReply: m.is_staff_reply,
                  at: relativeTime(m.created_at),
                }))}
              />
            );
          })
        )}
      </Section>
    </div>
  );
}
