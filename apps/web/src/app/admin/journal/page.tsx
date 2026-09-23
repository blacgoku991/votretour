import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { requirePlatformAdmin } from '@/server/auth';
import { Section, EmptyState } from '@/components/Page';
import { formatDateTime } from '@/lib/format';
import { AdminHero } from '../AdminKit';
import { ScrollTable } from '../ScrollTable';
import { auditActionLabel, targetTypeLabel } from '../labels';
import styles from '../admin.module.css';

export const metadata: Metadata = { title: 'Journal d’audit', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function AdminAuditPage() {
  // Chaque page revérifie le rôle elle-même : une requête RSC forgée
  // peut sauter le layout /admin, jamais la page qu'elle demande.
  await requirePlatformAdmin();
  const db = supabaseAdmin();

  const { data: logs } = await db
    .from('audit_logs')
    .select('id, organization_id, actor, actor_user_id, action, target_type, target_id, created_at, metadata, organizations(name), profiles(full_name, email)')
    .order('created_at', { ascending: false })
    .limit(150);

  return (
    <div className={`shell ${styles.page}`}>
      <AdminHero
        kicker="AUDIT"
        title="Journal d’audit"
        description="Les actions sensibles : équipe, réglages, facturation, suspensions. Le flux des files est tracé séparément."
      />

      <Section>
        {(logs ?? []).length === 0 ? (
          <EmptyState title="Journal vide" />
        ) : (
          <ScrollTable label="Journal d’audit">
            <table className={`${styles.table} ${styles.stackTable}`}>
              <thead>
                <tr>
                  <th scope="col">Quand</th>
                  <th scope="col">Action</th>
                  <th scope="col">Qui</th>
                  <th scope="col">Organisation</th>
                  <th scope="col">Cible</th>
                </tr>
              </thead>
              <tbody>
                {(logs ?? []).map((log) => {
                  const org = Array.isArray(log.organizations) ? log.organizations[0] : log.organizations;
                  const profile = Array.isArray(log.profiles) ? log.profiles[0] : log.profiles;
                  return (
                    <tr key={log.id}>
                      <td className="t-num" data-label="Quand">{formatDateTime(log.created_at)}</td>
                      <th scope="row" className={`${styles.orgName} ${styles.stackLead}`}>
                        {auditActionLabel(log.action)}
                      </th>
                      <td data-label="Qui">
                        {/* Une seule enveloppe : en fiche (mobile), la valeur
                            tient dans une seule case de la grille. */}
                        <span>
                          {profile?.full_name ?? profile?.email ?? '—'}
                          {log.actor === 'platform_admin' && (
                            <span className="chip chip--signal" style={{ marginLeft: 6 }}>plateforme</span>
                          )}
                        </span>
                      </td>
                      <td data-label="Organisation">{org?.name ?? '—'}</td>
                      <td data-label="Cible">
                        <span>
                          {targetTypeLabel(log.target_type)}
                          {log.target_id && <span className="t-micro t-faint"> · {log.target_id.slice(0, 12)}</span>}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollTable>
        )}
      </Section>
    </div>
  );
}
