import type { Metadata } from 'next';
import Link from 'next/link';
import { requireOrgAccess } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getQueueSnapshot } from '@/server/queue';
import { QueueBoard } from './QueueBoard';
import styles from './board.module.css';

export const metadata: Metadata = { title: 'File en cours', robots: { index: false } };
export const dynamic = 'force-dynamic';

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
          <h1 className="t-title">Aucune file pour l&apos;instant</h1>
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
  const snapshot = await getQueueSnapshot(selected.id);

  return (
    <QueueBoard
      orgSlug={org}
      initialSnapshot={snapshot}
      queues={list.map((q) => ({
        id: q.id,
        name: q.name,
        locationName: locationName(q.locations),
        status: q.status,
      }))}
      canOperate={access.can('queue.operate')}
      canConfigure={access.can('queue.configure')}
    />
  );
}
