import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { getQueueSnapshot } from '@/server/queue';
import { getTvDeviceByToken, TV_COOKIE } from '@/server/tv-kiosk';
import { TVBoard } from '../app/[org]/ecran/TVBoard';
import { PairTV } from './PairTV';

export const metadata: Metadata = {
  title: 'Rangvia Display',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

export default async function TVKioskPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const query = await searchParams;
  const jar = await cookies();
  const device = await getTvDeviceByToken(jar.get(TV_COOKIE)?.value);

  if (!device) {
    return <PairTV initialCode={query.code ?? ''} />;
  }

  const snapshot = await getQueueSnapshot(device.queueId);

  return (
    <TVBoard
      orgSlug={device.organizationSlug}
      organizationName={device.organizationName}
      logoUrl={device.organizationLogoUrl}
      initialSnapshot={snapshot}
      queues={[{ id: device.queueId, name: device.queueName }]}
      snapshotEndpoint="/api/tv/snapshot"
      eventTheme={device.event}
      kioskMode
    />
  );
}
