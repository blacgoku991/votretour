'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { markSetupDone } from '@/server/actions/admin';
import styles from './plans.module.css';

export interface SetupTodoRow {
  organizationId: string;
  name: string;
  /** Date de paiement des frais, déjà mise en forme par le serveur. */
  paidOn: string;
}

/**
 * INSTALLATIONS À FAIRE : frais d'installation payés (webhook Stripe),
 * installation pas encore faite par l'équipe. Une ligne par commerce, du
 * plus ancien paiement au plus récent : le premier servi est celui qui
 * attend depuis le plus longtemps. Le bouton pose `setup_done_at` ; la
 * ligne disparaît au rafraîchissement.
 *
 * Les dates arrivent mises en forme par le serveur : aucun calcul de date
 * dans le navigateur, donc aucun écart d'hydratation.
 */
export function SetupTodo({ rows }: { rows: readonly SetupTodoRow[] }) {
  if (rows.length === 0) {
    return (
      <p className={`t-small t-muted ${styles.none}`}>
        Aucune installation en attente. Chaque installation payée apparaît ici jusqu’à ce que vous la marquiez faite.
      </p>
    );
  }
  return (
    <ol className={styles.todo}>
      {rows.map((row) => <SetupTodoItem key={row.organizationId} row={row} />)}
    </ol>
  );
}

function SetupTodoItem({ row }: { row: SetupTodoRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const done = () => {
    setError(null);
    startTransition(async () => {
      const result = await markSetupDone({ organizationId: row.organizationId, done: true });
      if (!result.ok) { setError(result.error); return; }
      router.refresh();
    });
  };

  return (
    <li className={styles.todoRow}>
      <div className={styles.todoText}>
        <Link href={`/admin/etablissements/${row.organizationId}`} className={styles.todoName}>
          {row.name}
        </Link>
        <span className="t-micro t-muted">Installation réglée le {row.paidOn}</span>
        {error && <span className="error-text" role="alert">{error}</span>}
      </div>
      <button type="button" className="btn btn--ghost btn--sm" disabled={pending} onClick={done}>
        {pending ? 'Enregistrement…' : 'Marquer faite'}
        <span className="sr-only">, {row.name}</span>
      </button>
    </li>
  );
}
