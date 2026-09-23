import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getQueueSnapshot } from '@/server/queue';
import { getTvDeviceByToken, TV_COOKIE } from '@/server/tv-kiosk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const jar = await cookies();
  const device = await getTvDeviceByToken(jar.get(TV_COOKIE)?.value);

  if (!device) {
    return NextResponse.json(
      { ok: false, error: 'Écran non appairé.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const snapshot = await getQueueSnapshot(device.queueId);

  return NextResponse.json(
    {
      ok: true,
      data: {
        device: {
          id: device.id,
          name: device.name,
          organizationName: device.organizationName,
          organizationLogoUrl: device.organizationLogoUrl,
          organizationSlug: device.organizationSlug,
          locationName: device.locationName,
          locationSlug: device.locationSlug,
          city: device.city,
          queueId: device.queueId,
          queueName: device.queueName,
        },
        event: device.event,
        snapshot,
      },
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
