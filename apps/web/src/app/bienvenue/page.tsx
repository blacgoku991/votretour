import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireUser, getMyOrganizations } from '@/server/auth';
import { OnboardingFlow } from './OnboardingFlow';
import { DEFAULT_ACTIVITY, parseActivityParam } from './metiers';

export const metadata: Metadata = { title: 'Créer votre file', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ nouveau?: string; activite?: string | string[] }>;
}) {
  const user = await requireUser();
  const { nouveau, activite } = await searchParams;
  const organizations = await getMyOrganizations();

  // Un compte qui a déjà une organisation n'a rien à faire ici, sauf
  // s'il vient explicitement en ajouter une.
  if (organizations.length > 0 && nouveau !== '1') {
    redirect(`/app/${organizations[0]!.slug}/file`);
  }

  // `?activite=garage` (pages métier, lien d'inscription) présélectionne le
  // métier. Liste blanche : une valeur inconnue est ignorée, sans erreur.
  const initialActivity = parseActivityParam(activite) ?? DEFAULT_ACTIVITY;

  // L'activité est présélectionnée, jamais le métier : la file naît au
  // passage, et l'équipe Rangvia active l'interface du métier à
  // l'installation.
  return <OnboardingFlow userName={user.fullName} initialActivity={initialActivity} />;
}
