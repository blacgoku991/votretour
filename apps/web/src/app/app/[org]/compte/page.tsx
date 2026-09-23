import type { Metadata } from 'next';
import { requireOrgAccess } from '@/server/auth';
import { PageHeader } from '@/components/Page';
import { initials } from '@/lib/format';
import { AccountActions } from './AccountActions';
import styles from './account.module.css';

export const metadata: Metadata = { title: 'Mon compte', robots: { index: false } };
export const dynamic = 'force-dynamic';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Propriétaire', admin: 'Administrateur',
  manager: 'Responsable', member: 'Équipier',
};

/**
 * MON COMPTE — une carte d'identité (rayon 14) aux champs accrochés au
 * rail, et une carte de session. Sobre, sans effet.
 */
export default async function AccountPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const access = await requireOrgAccess(org);
  const name = access.user.fullName ?? access.user.email ?? 'Compte';

  return (
    <div className={`shell ${styles.page}`}>
      <PageHeader title="Mon compte" description="Vos informations et votre accès." />

      <div className={styles.grid}>
        <section className={styles.block} aria-labelledby="identite">
          <h2 id="identite" className={`t-label ${styles.head}`}>Identité</h2>
          <div className={`card ${styles.card}`}>
            <div className={styles.who}>
              <span className={styles.tile} aria-hidden="true">{initials(name)}</span>
              <div className={styles.whoText}>
                <p className={styles.whoName}>{access.user.fullName ?? '—'}</p>
                <p className={styles.whoOrg}>{access.organization.name}</p>
              </div>
            </div>

            <dl className={`field-rail ${styles.fields}`}>
              <div className="field">
                <dt className={styles.label}>Nom</dt>
                <dd className={styles.value}>{access.user.fullName ?? '—'}</dd>
              </div>
              <div className="field">
                <dt className={styles.label}>Adresse e-mail</dt>
                <dd className={styles.value}>{access.user.email ?? '—'}</dd>
                <dd className={styles.hint}>Sert à vous connecter et à vous répondre.</dd>
              </div>
              <div className="field">
                <dt className={styles.label}>Votre rôle</dt>
                <dd className={styles.value}>
                  <span className="chip chip--signal">{ROLE_LABEL[access.role] ?? access.role}</span>
                </dd>
                <dd className={styles.hint}>Sur {access.organization.name}.</dd>
              </div>
              {access.user.isPlatformAdmin && (
                <div className="field">
                  <dt className={styles.label}>Administration plateforme</dt>
                  <dd className={styles.value}>
                    <a className="btn btn--ghost btn--sm" href="/admin">Ouvrir l’espace super-admin</a>
                  </dd>
                </div>
              )}
            </dl>
          </div>
        </section>

        <section className={styles.block} aria-labelledby="session">
          <h2 id="session" className={`t-label ${styles.head}`}>Session</h2>
          <div className={`card ${styles.card}`}>
            <AccountActions />
          </div>
        </section>
      </div>
    </div>
  );
}
