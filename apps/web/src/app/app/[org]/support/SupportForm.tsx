'use client';

import { useState, useTransition } from 'react';
import { createSupportTicket } from '@/server/actions/support';
import { useRouter } from 'next/navigation';

export function SupportForm({ organizationId }: { organizationId: string }) {
  const router = useRouter();
  const [form, setForm] = useState({ subject: '', category: 'question', message: '' });
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  if (sent) {
    return (
      <div className="banner" role="status">
        <span className="pip pip--live" />
        <span>Demande enregistrée. Nous revenons vers vous par e-mail.</span>
      </div>
    );
  }

  return (
    <form
      className="stack g5"
      onSubmit={(event) => {
        event.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await createSupportTicket({
            organizationId,
            subject: form.subject.trim(),
            category: form.category as never,
            message: form.message.trim(),
          });
          if (!result.ok) { setError(result.error); return; }
          setSent(true);
          router.refresh();
        });
      }}
    >
      <div className="field-rail">
        <div className="field">
          <label htmlFor="sujet">Sujet</label>
          <input id="sujet" className="input" required maxLength={140} value={form.subject}
            onChange={(e) => setForm({ ...form, subject: e.target.value })}
            placeholder="Mon QR code n’ouvre pas la bonne file" />
        </div>

        <div className="field">
          <label htmlFor="categorie">Catégorie</label>
          <select id="categorie" className="select" value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}>
            <option value="question">Question</option>
            <option value="bug">Quelque chose ne fonctionne pas</option>
            <option value="plates">Plaques et QR</option>
            <option value="billing">Facturation</option>
            <option value="feature">Suggestion</option>
            <option value="other">Autre</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="message">Votre message</label>
          <textarea id="message" className="textarea" required minLength={10} maxLength={8000}
            value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })}
            aria-describedby="message-aide"
            placeholder="Décrivez ce que vous avez fait et ce qui s’est passé." />
          <p id="message-aide" className="hint">10 caractères au moins : ce que vous avez fait, et ce qui s’est passé.</p>
        </div>
      </div>

      {error && <div className="banner banner--error" role="alert"><span>{error}</span></div>}

      <button type="submit" className="btn btn--signal btn--lg btn--block" disabled={pending}>
        {pending ? 'Envoi…' : 'Envoyer'}
      </button>
    </form>
  );
}
