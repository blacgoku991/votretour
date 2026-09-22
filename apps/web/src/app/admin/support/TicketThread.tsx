'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { updateSupportTicket } from '@/server/actions/admin';
import styles from './support.module.css';

export function TicketThread({
  ticket, messages,
}: {
  ticket: {
    id: string; subject: string; category: string; status: string;
    organizationName: string; createdAt: string; age: string;
  };
  messages: { id: number; body: string; isStaffReply: boolean; at: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reply, setReply] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const act = (payload: { status?: string; reply?: string }) => {
    setError(null);
    startTransition(async () => {
      const result = await updateSupportTicket({
        ticketId: ticket.id,
        status: payload.status as never,
        reply: payload.reply,
      });
      if (!result.ok) { setError(result.error); return; }
      setReply('');
      router.refresh();
    });
  };

  return (
    <div className={styles.ticket}>
      <button type="button" className={styles.ticketHead} onClick={() => setOpen((v) => !v)}>
        <span className={styles.ticketText}>
          <span className={styles.subject}>{ticket.subject}</span>
          <span className="t-micro t-faint">
            {ticket.organizationName} · {ticket.category} · {ticket.age}
          </span>
        </span>
        <span className={
          ticket.status === 'resolved' ? 'chip chip--jade'
          : ticket.status === 'open' ? 'chip chip--copper' : 'chip'
        }>
          {ticket.status}
        </span>
      </button>

      {open && (
        <div className={styles.thread}>
          {messages.map((message) => (
            <div key={message.id}
              className={`${styles.message} ${message.isStaffReply ? styles.messageStaff : ''}`}>
              <p className="t-micro t-faint">
                {message.isStaffReply ? 'Plateforme' : 'Professionnel'} · {message.at}
              </p>
              <p>{message.body}</p>
            </div>
          ))}

          {error && <p className="error-text">{error}</p>}

          <textarea className="textarea" placeholder="Votre réponse" value={reply}
            onChange={(e) => setReply(e.target.value)} />
          <div className="row g2 wrap">
            <button type="button" className="btn btn--signal btn--sm"
              disabled={pending || !reply.trim()}
              onClick={() => act({ reply: reply.trim(), status: 'pending' })}>
              Répondre
            </button>
            <button type="button" className="btn btn--ghost btn--sm" disabled={pending}
              onClick={() => act({ status: 'resolved' })}>
              Marquer résolu
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
