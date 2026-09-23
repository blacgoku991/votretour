import { AppShell } from '@/components/AppShell';
import { requireOrgAccess, getMyOrganizations } from '@/server/auth';

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  // Revérifie l'appartenance à chaque navigation : le middleware ne
  // contrôle que la présence d'une session, jamais les droits.
  const access = await requireOrgAccess(org, undefined, { allowSuspended: true });

  // Organisation suspendue : ni coque ni navigation. Chaque page appelle
  // requireOrgAccess et redirige vers /suspendu, seule page rendue ici.
  // Rediriger depuis le layout bouclerait : /suspendu est sous ce layout.
  if (access.organization.status === 'suspended') return children;

  const organizations = await getMyOrganizations();

  return (
    <AppShell
      organization={access.organization}
      organizations={organizations}
      user={{
        fullName: access.user.fullName,
        email: access.user.email,
        isPlatformAdmin: access.user.isPlatformAdmin,
      }}
    >
      {children}
    </AppShell>
  );
}
