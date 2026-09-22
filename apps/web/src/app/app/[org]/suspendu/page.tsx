import type { Metadata } from 'next';
import Link from 'next/link';
import { requireUser } from '@/server/auth';

export const metadata: Metadata = { title: 'Compte suspendu', robots: { index: false } };

export default async function SuspendedPage() {
  await requireUser();
  return (
    <main className="shell shell--read center" style={{ minHeight: '100dvh', padding: 'var(--sp-7) var(--sp-5)' }}>
      <div className="stack g4" style={{ textAlign: 'center', maxWidth: '46ch' }}>
        <p className="t-label">Accès suspendu</p>
        <h1 className="t-title">Votre espace est temporairement suspendu</h1>
        <p className="t-body t-muted">
          Vos files sont fermées et vos plaques n’ouvrent plus la file. Vos données sont
          intactes. Contactez-nous pour rétablir l’accès.
        </p>
        <Link className="btn btn--signal" href="/">Retour à l’accueil</Link>
      </div>
    </main>
  );
}
