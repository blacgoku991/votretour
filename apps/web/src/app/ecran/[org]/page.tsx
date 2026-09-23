import type { Metadata } from 'next';
import { requireOrgAccess } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getQueueSnapshot } from '@/server/queue';
import { TVBoard } from '../../app/[org]/ecran/TVBoard';

export const metadata: Metadata = {
  title: 'Écran TV',
  robots: { index: false },
};

export const dynamic = 'force-dynamic';

export default async function StandaloneTVPage({
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
  const selected = list.find((queue) => queue.id === file) ?? list[0] ?? null;
  const snapshot = selected ? await getQueueSnapshot(selected.id) : null;

  const { data: liveEvent } = selected
    ? await db.from('event_campaigns')
        .select('id, name, status, hero_title, logo_url, cover_url, accent_hex, rules_text, qr_label')
        .eq('queue_id', selected.id)
        .in('status', ['live', 'paused'])
        .order('started_at', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  const eventTheme = liveEvent ? {
    id: liveEvent.id,
    name: liveEvent.name,
    status: liveEvent.status,
    heroTitle: liveEvent.hero_title ?? null,
    logoUrl: liveEvent.logo_url ?? null,
    coverUrl: liveEvent.cover_url ?? null,
    accentHex: liveEvent.accent_hex ?? '#FF4B1F',
    rulesText: liveEvent.rules_text ?? null,
    qrLabel: liveEvent.qr_label ?? null,
  } : null;

  return (
    <TVBoard
      orgSlug={org}
      organizationName={organization?.name ?? access.organization.name}
      logoUrl={organization?.logo_url ?? null}
      initialSnapshot={snapshot}
      queues={list.map((queue) => ({ id: queue.id, name: queue.name }))}
      eventTheme={eventTheme}
    />
  );
}
