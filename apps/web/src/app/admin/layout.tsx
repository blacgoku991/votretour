import { requirePlatformAdmin } from '@/server/auth';
import { AdminShell } from './AdminShell';

export const dynamic = 'force-dynamic';

/**
 * Espace plateforme strictement réservé aux comptes
 * profiles.is_platform_admin = true.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePlatformAdmin();

  return (
    <AdminShell
      user={{
        fullName: user.fullName,
        email: user.email,
      }}
    >
      {children}
    </AdminShell>
  );
}
