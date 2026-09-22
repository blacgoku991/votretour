import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireUser, getMyOrganizations } from '@/server/auth';
import { OnboardingFlow } from './OnboardingFlow';

export const metadata: Metadata = { title: 'Créer votre file', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ nouveau?: string }>;
}) {
  const user = await requireUser();
  const { nouveau } = await searchParams;
  const organizations = await getMyOrganizations();

  // Un compte qui a déjà une organisation n'a rien à faire ici, sauf
  // s'il vient explicitement en ajouter une.
  if (organizations.length > 0 && nouveau !== '1') {
    redirect(`/app/${organizations[0]!.slug}/file`);
  }

  return <OnboardingFlow userName={user.fullName} />;
}
