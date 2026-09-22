import { redirect } from 'next/navigation';
import { requireUser, getMyOrganizations } from '@/server/auth';

/** Point d'entrée du tableau de bord : redirige vers la bonne organisation. */
export default async function AppIndexPage() {
  await requireUser();
  const organizations = await getMyOrganizations();

  if (organizations.length === 0) redirect('/bienvenue');
  redirect(`/app/${organizations[0]!.slug}/file`);
}
