import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'Activation du laisser-passer',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export const dynamic = 'force-dynamic';

/**
 * Le secret Event n'est utilisé qu'une fois : cette page ne le rend
 * jamais dans du HTML. Elle l'échange immédiatement contre un cookie
 * HttpOnly signé puis l'URL visible devient simplement /pass.
 */
export default async function ActivatePassPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!/^[a-f0-9]{64}$/i.test(token)) redirect('/pass?etat=invalide');
  redirect(`/api/pass/activate/${encodeURIComponent(token)}`);
}
