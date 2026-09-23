import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requirePlatformAdmin } from '@/server/auth';
import { PageHeader, Section, EmptyState } from '@/components/Page';
import { relativeTime, formatDateTime } from '@/lib/format';
import { ResolveButton } from './ResolveButton';
import styles from '../admin.module.css';

export const metadata: Metadata = { title: 'Incidents', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function AdminErrorsPage({
  searchParams,
}: {
  searchParams: Promise<{ etat?: string }>;
}) {
  // Chaque page revérifie le rôle elle-même : une requête RSC forgée
  // peut sauter le layout /admin, jamais la page qu'elle demande.
  await requirePlatformAdmin();
  const { etat } = await searchParams;
  const resolved = etat === 'resolus';

  const { data: errors } = await supabaseAdmin()
    .from('system_errors')
    .select('id, level, source, message, stack, occurrences, created_at, last_seen_at, resolved_at, organization_id')
    .order('last_seen_at', { ascending: false })
    .limit(100);

  const rows = (errors ?? []).filter((e) => (resolved ? e.resolved_at : !e.resolved_at));

  return (
    <div className={`shell ${styles.page}`}>
      <PageHeader
        title="Incidents"
        description="Remontées automatiques du serveur. Une même erreur est regroupée et comptée."
        actions={
          <div className="row g2">
            <a className={`btn btn--sm ${resolved ? 'btn--ghost' : 'btn--solid'}`} href="/admin/erreurs">
              Ouverts
            </a>
            <a className={`btn btn--sm ${resolved ? 'btn--solid' : 'btn--ghost'}`} href="/admin/erreurs?etat=resolus">
              Résolus
            </a>
          </div>
        }
      />

      <Section>
        {rows.length === 0 ? (
          <EmptyState
            title={resolved ? 'Aucun incident résolu' : 'Aucun incident ouvert'}
            description={resolved ? undefined : 'Tout fonctionne.'}
          />
        ) : (
          rows.map((error) => (
            <div key={error.id} className={styles.errorRow}>
              <span className={
                error.level === 'fatal' ? 'chip chip--brique'
                : error.level === 'warn' ? 'chip chip--copper' : 'chip'
              }>
                {error.level}
              </span>
              <div className={styles.errorBody}>
                <p className={styles.errorMessage}>{error.message}</p>
                <p className="t-micro t-faint">
                  {error.source} · {error.occurrences} occurrence{error.occurrences > 1 ? 's' : ''} ·
                  vue {relativeTime(error.last_seen_at)} · première fois {formatDateTime(error.created_at)}
                </p>
                {error.stack && <pre className={styles.errorStack}>{error.stack}</pre>}
              </div>
              {!error.resolved_at && <ResolveButton errorId={error.id} />}
            </div>
          ))
        )}
      </Section>
    </div>
  );
}
