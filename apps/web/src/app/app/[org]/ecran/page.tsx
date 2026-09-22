import type { Metadata } from 'next';
import { requireOrgAccess } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getQueueSnapshot } from '@/server/queue';
import { TVBoard } from './TVBoard';

export const metadata: Metadata = { title: 'Écran TV', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function TVPage({
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

  const [{ data: organization }, { data: queues }] = await Promise.all([
    db.from('organizations')
      .select('name, logo_url')
      .eq('id', access.organization.organization_id)
      .maybeSingle(),
    db.from('queues')
      .select('id, name, is_default')
      .eq('organization_id', access.organization.organization_id)
      .order('is_default', { ascending: false })
      .order('created_at'),
  ]);

  const list = queues ?? [];
  const selected = list.find((q) => q.id === file) ?? list[0] ?? null;
  const snapshot = selected ? await getQueueSnapshot(selected.id) : null;

  return (
    <TVBoard
      orgSlug={org}
      organizationName={organization?.name ?? access.organization.name}
      logoUrl={organization?.logo_url ?? null}
      initialSnapshot={snapshot}
      queues={list.map((q) => ({ id: q.id, name: q.name }))}
    />
  );
}
