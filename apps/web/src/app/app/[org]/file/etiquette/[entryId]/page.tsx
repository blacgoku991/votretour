import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { requireOrgAccess } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { fetchProfileQueueSnapshot } from '@/server/actions/profile-queue';
import { getProfile } from '@/lib/profiles';
import { displayRegistration, maskRegistration } from '@/lib/profiles/registration';
import { labelKind } from '../../boards/logic';
import { LabelSheet } from './LabelSheet';
import styles from './etiquette.module.css';

export const dynamic = 'force-dynamic';

/**
 * L'ÉTIQUETTE D'ATELIER — imprimable au format 62 × 100 mm (rouleau
 * d'étiquettes courant), par l'impression du navigateur : aucune
 * intégration d'imprimante inventée.
 *
 * Au garage, c'est l'étiquette de CLÉ : elle relie la clé, la voiture et
 * le client, avec l'immatriculation MASQUÉE (une clé pend au tableau, à la
 * vue de tous). À l'atelier d'appareils, c'est l'étiquette de DÉPÔT, collée
 * sur le sachet du téléphone : le numéro de dossier et le modèle. Le QR de
 * suivi n'est PAS créé à l'ouverture de la page : une page qui s'ouvre (ou
 * se précharge) ne doit rien changer. Il est émis au geste « Imprimer », et
 * il remplace alors celui affiché sur le poste.
 *
 * Accès : membre de l'organisation avec `queue.operate`, et fiche de cette
 * organisation (contrôlé par `fetchProfileQueueSnapshot`) ; sinon 404.
 */

/**
 * Lecture partagée par le titre de l'onglet et la page : `cache` la fait
 * une seule fois par requête.
 */
const loadLabel = cache(async (org: string, entryId: string) => {
  const access = await requireOrgAccess(org, 'queue.operate');
  if (!/^[0-9a-zA-Z]{8,32}$/.test(entryId)) notFound();

  const { data } = await supabaseAdmin()
    .from('queue_entries')
    .select('queue_id, organization_id')
    .eq('public_id', entryId)
    .maybeSingle();
  if (!data || data.organization_id !== access.organization.organization_id) notFound();

  const result = await fetchProfileQueueSnapshot(org, data.queue_id);
  const snapshot = result.ok ? result.data.snapshot : null;
  const entry = snapshot
    ? [...snapshot.called, ...snapshot.serving, ...snapshot.waiting].find((e) => e.id === entryId) ?? null
    : null;
  return { queueId: data.queue_id as string, snapshot, entry };
});

export async function generateMetadata(
  { params }: { params: Promise<{ org: string; entryId: string }> },
): Promise<Metadata> {
  const { org, entryId } = await params;
  const { snapshot } = await loadLabel(org, entryId);
  const profile = snapshot?.queue.profile;
  return {
    title: profile === 'vehicle' || profile === 'device' ? labelKind(profile).title : 'Étiquette',
    robots: { index: false, follow: false },
  };
}

export default async function LabelPage({ params }: { params: Promise<{ org: string; entryId: string }> }) {
  const { org, entryId } = await params;
  const { queueId, snapshot, entry } = await loadLabel(org, entryId);

  if (!snapshot || !entry) {
    const kind = snapshot && snapshot.queue.profile === 'device' ? labelKind('device') : labelKind('vehicle');
    return (
      <div className="shell">
        <div className={styles.gone}>
          <p className="t-label">{kind.title}</p>
          <h1 className="t-title">Cette fiche n’est plus en cours</h1>
          <p className="t-body t-muted">Elle a été rendue ou retirée : il n’y a plus d’étiquette à imprimer.</p>
          <Link href={`/app/${org}/file?file=${queueId}`} className="btn btn--ghost">Retour à l’atelier</Link>
        </div>
      </div>
    );
  }

  const profile = snapshot.queue.profile;
  if (profile !== 'vehicle' && profile !== 'device') notFound();
  const d = entry.details ?? {};
  // La forme masquée seulement part vers le navigateur : c'est tout ce
  // que l'étiquette imprime.
  const masked = profile === 'vehicle' && d.registration
    ? maskRegistration(displayRegistration(d.registration, d.country ?? 'FR'))
    : null;

  return (
    <LabelSheet
      orgSlug={org}
      entryId={entryId}
      backHref={`/app/${org}/file?file=${snapshot.queue.id}`}
      label={{
        profile,
        locationName: snapshot.location.name,
        timeZone: snapshot.location.timezone || 'Europe/Paris',
        maskedRegistration: masked,
        country: d.country ?? 'FR',
        ticketNo: entry.ticketNo,
        model: d.model ?? null,
        deviceKind: d.deviceKind ?? null,
        subject: getProfile(profile).vocab.subject,
      }}
    />
  );
}
