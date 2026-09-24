import type { Metadata } from 'next';
import Link from 'next/link';
import { getStaffRecord, requireOrgAccess } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getQueueSnapshot } from '@/server/queue';
import { fetchProfileQueueSnapshot } from '@/server/actions/profile-queue';
import { getProfile, isLegacyProfile, profileForActivity } from '@/lib/profiles';
import { profileAvailable } from '@/lib/profiles/capabilities';
import { QueueBoard } from './QueueBoard';
import { boardKindFor } from './boards/logic';
import { WorkshopBoard } from './boards/WorkshopBoard';
import { TableBoard } from './boards/TableBoard';
import { DeskBoard } from './boards/DeskBoard';
import { ProfileSuggestion } from './boards/ProfileSuggestion';
import styles from './board.module.css';

export const metadata: Metadata = { title: 'File en cours', robots: { index: false } };
export const dynamic = 'force-dynamic';

/**
 * LE POSTE DU PRO, AIGUILLÉ PAR MÉTIER.
 *
 * `snapshot.queue.profile` choisit le poste : walkin et event gardent
 * `QueueBoard`, avec EXACTEMENT les mêmes props qu'avant les profils
 * (mêmes pixels pour les barbiers) ; un atelier, une salle de restaurant,
 * un guichet ou une boutique ont le leur. Les postes à profil relisent
 * l'instantané par `fetchProfileQueueSnapshot`, le seul qui porte les
 * informations métier (immatriculation, devis, couverts), réservé à la
 * permission `queue.operate`.
 */
export default async function QueuePage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ file?: string }>;
}) {
  const { org } = await params;
  const { file } = await searchParams;
  const access = await requireOrgAccess(org);

  const db = supabaseAdmin();
  const { data: queues } = await db
    .from('queues')
    .select('id, name, status, mode, location_id, is_default, locations(name, slug)')
    .eq('organization_id', access.organization.organization_id)
    .order('is_default', { ascending: false })
    .order('created_at');

  // PostgREST renvoie les relations imbriquées sous forme de tableau,
  // même pour une relation « plusieurs vers un ».
  const list = (queues ?? []) as unknown as {
    id: string; name: string; status: string; mode: string;
    location_id: string; is_default: boolean;
    locations: { name: string; slug: string }[] | { name: string; slug: string } | null;
  }[];

  const locationName = (value: (typeof list)[number]['locations']): string =>
    (Array.isArray(value) ? value[0]?.name : value?.name) ?? 'Établissement';

  if (list.length === 0) {
    return (
      <div className="shell">
        <div className={styles.empty}>
          <p className="t-label">Rien à afficher</p>
          <h1 className="t-title">Aucune file pour l’instant</h1>
          <p className="t-body t-muted">
            Créez votre premier établissement : sa file, son QR code et sa plaque NFC
            seront générés automatiquement.
          </p>
          <Link href="/bienvenue" className="btn btn--signal btn--lg">
            Créer un établissement
          </Link>
        </div>
      </div>
    );
  }

  const selected = list.find((q) => q.id === file) ?? list[0]!;
  const [snapshot, staff] = await Promise.all([
    getQueueSnapshot(selected.id),
    getStaffRecord(access.user.id, selected.location_id),
  ]);

  const queueRefs = list.map((q) => ({
    id: q.id,
    name: q.name,
    locationName: locationName(q.locations),
    status: q.status,
  }));
  const common = {
    orgSlug: org,
    queues: queueRefs,
    canOperate: access.can('queue.operate'),
    canConfigure: access.can('queue.configure'),
    actorStaffId: staff?.id ?? null,
  };

  // `queue_snapshot` ajoute la clé `profile` (0035) ; absente, c'est une
  // base d'avant les profils : le poste d'aujourd'hui.
  const profile = (snapshot?.queue as { profile?: string } | undefined)?.profile ?? 'walkin';
  const kind = boardKindFor(profile);

  // Un membre sans `queue.operate` (lecture seule) garde le poste
  // d'aujourd'hui : les informations métier (immatriculation, devis) sont
  // réservées à ceux qui font avancer la file.
  if (kind === 'queue' || !common.canOperate) {
    const board = (
      <QueueBoard
        orgSlug={org}
        initialSnapshot={snapshot}
        queues={queueRefs}
        canOperate={common.canOperate}
        canConfigure={common.canConfigure}
        actorStaffId={common.actorStaffId}
      />
    );
    // Un garage, un restaurant ou un guichet inscrit AVANT les profils
    // reste en passage au fauteuil tant qu'il n'a rien demandé : une carte
    // discrète lui propose son poste. Un barbier (profil par défaut
    // walkin) ne lit rien de plus, et sa page ne change pas d'un pixel.
    const suggested = profileForActivity(access.organization.activity);
    if (!isLegacyProfile(profile) || isLegacyProfile(suggested) || !common.canConfigure) return board;
    const features = await loadFeatures(access.organization.organization_id);
    if (!profileAvailable(suggested, features)) return board;
    return (
      <>
        <div className="shell">
          <ProfileSuggestion orgSlug={org} profile={suggested} label={getProfile(suggested).label} />
        </div>
        {board}
      </>
    );
  }

  const result = await fetchProfileQueueSnapshot(org, selected.id);
  const profileSnapshot = result.ok ? result.data.snapshot : null;
  if (!profileSnapshot) {
    return (
      <QueueBoard
        orgSlug={org}
        initialSnapshot={null}
        queues={queueRefs}
        canOperate={common.canOperate}
        canConfigure={common.canConfigure}
        actorStaffId={common.actorStaffId}
      />
    );
  }

  if (kind === 'workshop') return <WorkshopBoard {...common} initialSnapshot={profileSnapshot} />;
  if (kind === 'table') {
    // Délai pour se présenter à l'accueil : le compte à rebours du groupe appelé.
    const { data: grace } = await db
      .from('queues').select('absent_grace_minutes').eq('id', selected.id).maybeSingle();
    const graceMinutes = typeof grace?.absent_grace_minutes === 'number'
      ? grace.absent_grace_minutes
      : getProfile('table').queueDefaults.absentGraceMinutes ?? 5;
    return <TableBoard {...common} initialSnapshot={profileSnapshot} graceMinutes={graceMinutes} />;
  }
  return <DeskBoard {...common} initialSnapshot={profileSnapshot} />;
}

async function loadFeatures(organizationId: string): Promise<Record<string, unknown> | null> {
  const { data } = await supabaseAdmin()
    .from('organization_settings')
    .select('features')
    .eq('organization_id', organizationId)
    .maybeSingle();
  const features = data?.features;
  return features && typeof features === 'object' && !Array.isArray(features)
    ? (features as Record<string, unknown>)
    : null;
}
