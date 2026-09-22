import type { Metadata } from 'next';
import { requireOrgAccess } from '@/server/auth';
import { PageHeader, Section, SettingRow } from '@/components/Page';
import { AccountActions } from './AccountActions';

export const metadata: Metadata = { title: 'Mon compte', robots: { index: false } };
export const dynamic = 'force-dynamic';

const ROLE_LABEL: Record<string, string> = {
  owner: 'Propriétaire', admin: 'Administrateur',
  manager: 'Responsable', member: 'Équipier',
};

export default async function AccountPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const access = await requireOrgAccess(org);

  return (
    <div className="shell" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--sp-6)', paddingTop: 'var(--sp-5)' }}>
      <PageHeader title="Mon compte" description="Vos informations et votre accès." />

      <Section title="Identité">
        <SettingRow label="Nom">
          <span className="t-small">{access.user.fullName ?? '—'}</span>
        </SettingRow>
        <SettingRow label="Adresse e-mail" hint="Sert à vous connecter et à vous répondre.">
          <span className="t-small">{access.user.email ?? '—'}</span>
        </SettingRow>
        <SettingRow label="Votre rôle" hint={`Sur ${access.organization.name}.`}>
          <span className="chip">{ROLE_LABEL[access.role] ?? access.role}</span>
        </SettingRow>
        {access.user.isPlatformAdmin && (
          <SettingRow label="Administration plateforme" hint="Vous avez accès à l’espace super-admin.">
            <a className="btn btn--ghost btn--sm" href="/admin">Ouvrir</a>
          </SettingRow>
        )}
      </Section>

      <Section title="Session">
        <div style={{ padding: 'var(--sp-5)' }}>
          <AccountActions />
        </div>
      </Section>
    </div>
  );
}
