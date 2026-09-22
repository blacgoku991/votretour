import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * La gestion des plaques est volontairement réservée au super-admin
 * plateforme. Les commerçants n'ont aucun réglage NFC/QR à manipuler.
 */
export default async function PlatesPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  redirect(`/app/${org}/file`);
}
