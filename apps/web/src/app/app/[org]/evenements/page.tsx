import type { Metadata } from 'next';
import { requireOrgAccess } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { EventsPanel } from './EventsPanel';

export const metadata: Metadata = { title: 'Événements', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function EventsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  const access = await requireOrgAccess(org);
  const db = supabaseAdmin();
  const organizationId = access.organization.organization_id;

  const [{ data: queues }, { data: events }] = await Promise.all([
    db.from('queues')
      .select('id, name, location_id, locations(name)')
      .eq('organization_id', organizationId)
      .order('created_at'),
    db.from('event_campaigns')
      .select('id, name, status, queue_id, location_id, wave_size, pass_valid_minutes, grace_minutes, public_note, started_at, ended_at, created_at')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false }),
  ]);

  const eventIds = (events ?? []).map((e) => e.id);
  const queueIds = (events ?? []).map((e) => e.queue_id);

  const [{ data: passes }, { data: entries }] = await Promise.all([
    eventIds.length
      ? db.from('event_access_passes').select('event_id, status').in('event_id', eventIds)
      : Promise.resolve({ data: [] }),
    queueIds.length
      ? db.from('queue_entries').select('queue_id, status').in('queue_id', queueIds)
      : Promise.resolve({ data: [] }),
  ]);

  const stats = (events ?? []).reduce<Record<string, {
    waiting: number; issued: number; redeemed: number; expired: number; revoked: number;
  }>>((acc, event) => {
    const queueEntries = (entries ?? []).filter((entry) => entry.queue_id === event.queue_id);
    const eventPasses = (passes ?? []).filter((pass) => pass.event_id === event.id);
    acc[event.id] = {
      waiting: queueEntries.filter((entry) =>
        ['waiting', 'returning', 'present', 'next'].includes(entry.status)).length,
      issued: eventPasses.filter((pass) => pass.status === 'issued').length,
      redeemed: eventPasses.filter((pass) => pass.status === 'redeemed').length,
      expired: eventPasses.filter((pass) => pass.status === 'expired').length,
      revoked: eventPasses.filter((pass) => pass.status === 'revoked').length,
    };
    return acc;
  }, {});

  return (
    <EventsPanel
      orgSlug={org}
      canOperate={access.can('queue.operate')}
      canConfigure={access.can('queue.configure')}
      queues={(queues ?? []).map((q) => {
        const location = Array.isArray(q.locations) ? q.locations[0] : q.locations;
        return {
          id: q.id,
          name: q.name,
          locationName: location?.name ?? 'Établissement',
        };
      })}
      events={(events ?? []).map((event) => ({
        ...event,
        stats: stats[event.id] ?? { waiting: 0, issued: 0, redeemed: 0, expired: 0, revoked: 0 },
      }))}
    />
  );
}
