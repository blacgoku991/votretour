'use client';

import { useEffect, useRef, useState } from 'react';
import { formatAmount } from '@/lib/profiles/copy';
import { formatTime } from '@/lib/format';
import type { ClientQuoteN } from './phase';
import { CheckIcon, type OnAction } from './shared';
import styles from './workshop.module.css';

/**
 * LE DEVIS — montant, libellé, et la décision du client, depuis son
 * téléphone.
 *
 * Cuivre : il attend le client (la seule couleur forte, le vermillon,
 * reste à « Prêt »). Accepter comme refuser se CONFIRME en ligne : un
 * pouce qui glisse ne doit pas engager 184 €. La décision part avec le
 * numéro du devis lu (`quoteN = details.quote.n`) ; si l'atelier l'a
 * modifié entre-temps, la base refuse (409 `quote_changed`), l'écran
 * relit la fiche et la carte le dit, avec le nouveau montant sous les
 * yeux. Jamais d'accord reporté sur un montant que le client n'a pas lu.
 *
 * La mention est juste : l'accord est une TRANSMISSION HORODATÉE, pas une
 * signature (conception, § 16.6).
 */

export function QuoteCard({
  quote,
  awaiting,
  timeZone,
  busy,
  onAction,
  who,
}: {
  quote: ClientQuoteN;
  /** Le devis attend une décision (étape « Devis à valider », décision vide). */
  awaiting: boolean;
  timeZone: string;
  busy: boolean;
  onAction: OnAction;
  /** « le garage », « l'atelier ». */
  who: string;
}) {
  const [confirm, setConfirm] = useState<null | 'accept' | 'decline'>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const seenN = useRef(quote.n);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const amount = formatAmount(quote.amountCents);
  // « le garage » → « au garage » ; « l'atelier » → « à l'atelier ».
  const toWho = who.startsWith('le ') ? `au ${who.slice(3)}` : `à ${who}`;
  const [units, cents] = splitAmount(amount);

  // Un nouveau devis arrive (renvoyé par l'atelier) : on referme une
  // confirmation ouverte sur l'ancien, et on le signale.
  useEffect(() => {
    if (quote.n === seenN.current) return;
    seenN.current = quote.n;
    setConfirm(null);
    setNotice((n) => n ?? 'Nouveau devis : relisez-le avant de répondre.');
  }, [quote.n]);

  useEffect(() => {
    if (confirm) confirmRef.current?.focus({ preventScroll: true });
  }, [confirm]);

  const decide = async (kind: 'accept' | 'decline') => {
    setFailure(null);
    const result = await onAction(kind === 'accept' ? 'quote_accept' : 'quote_decline', quote.n ?? undefined);
    if (result.ok) {
      setConfirm(null);
      setNotice(null);
      return;
    }
    setConfirm(null);
    if (result.code === 'quote_changed') {
      setNotice(`${capitalize(who)} vient de modifier le devis : relisez-le avant de répondre.`);
    } else {
      setFailure(result.message);
    }
  };

  if (quote.decision) {
    const accepted = quote.decision === 'accepted';
    return (
      <section className={styles.quoteDone} data-decision={quote.decision} aria-label="Devis">
        <span className={styles.quoteDoneMark} aria-hidden="true">
          {accepted ? <CheckIcon size={16} /> : <CrossIcon />}
        </span>
        <div className={styles.quoteDoneText}>
          <p className={styles.quoteDoneTitle}>
            {accepted ? 'Devis accepté' : 'Devis refusé'} · <span className="t-num">{amount}</span>
          </p>
          <p className={styles.quoteDoneBody}>
            {quote.label ? `${quote.label}. ` : ''}
            {accepted ? `Votre accord a été transmis ${toWho}, avec l’heure.` : `${capitalize(who)} est informé de votre refus.`}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className={styles.quote} aria-labelledby="devis-titre" data-awaiting={awaiting ? 'true' : undefined}>
      <header className={styles.quoteHead}>
        <p id="devis-titre" className={styles.quoteKicker}>
          <span className={styles.quotePip} aria-hidden="true" />
          {awaiting ? 'Devis à valider' : 'Devis'}
        </p>
        {quote.sentAt && <p className={styles.quoteSent}>reçu à {formatTime(quote.sentAt, timeZone)}</p>}
      </header>

      <p className={styles.quoteAmount} aria-label={amount}>
        <span className={styles.quoteUnits} aria-hidden="true">{units}</span>
        <span className={styles.quoteCents} aria-hidden="true">{cents}</span>
      </p>
      {quote.label && <p className={styles.quoteLabel}>{quote.label}</p>}

      {notice && (
        <p className={styles.quoteNotice} role="alert">{notice}</p>
      )}
      {failure && (
        <p className="error-text" role="alert">{failure}</p>
      )}

      {awaiting && (confirm ? (
        <div className={styles.quoteConfirm} role="group" aria-label={confirm === 'accept' ? 'Accepter le devis' : 'Refuser le devis'}>
          <p className={styles.quoteConfirmText}>
            {confirm === 'accept'
              ? <>Accepter ce devis de <strong className="t-num">{amount}</strong> ?</>
              : <>Refuser ce devis ? {capitalize(who)} en sera informé.</>}
          </p>
          <div className={styles.quoteConfirmRow}>
            <button type="button" className="btn btn--quiet" onClick={() => setConfirm(null)} disabled={busy}>
              Annuler
            </button>
            <button
              ref={confirmRef}
              type="button"
              className={confirm === 'accept' ? 'btn btn--signal' : 'btn btn--danger'}
              onClick={() => void decide(confirm)}
              disabled={busy}
            >
              {busy ? 'Un instant…' : confirm === 'accept' ? 'Confirmer l’accord' : 'Confirmer le refus'}
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.quoteActions}>
          <button type="button" className="btn btn--signal btn--lg btn--block" onClick={() => { setNotice(null); setConfirm('accept'); }} disabled={busy}>
            Accepter le devis
          </button>
          <button type="button" className="btn btn--quiet" onClick={() => { setNotice(null); setConfirm('decline'); }} disabled={busy}>
            Refuser
          </button>
        </div>
      ))}

      <p className={styles.quoteFine}>
        Votre accord est transmis {toWho} avec l’heure. Il ne remplace pas le devis signé si {who} vous en demande un.
      </p>
    </section>
  );
}

/** « 184,00 € » → [« 184 », « ,00 € »] ; le chiffre qui compte en grand. */
function splitAmount(amount: string): [string, string] {
  const i = amount.indexOf(',');
  return i < 0 ? [amount, ''] : [amount.slice(0, i), amount.slice(i)];
}

function capitalize(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function CrossIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="m5 5 8 8M13 5l-8 8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
