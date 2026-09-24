import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getDisplaySnapshot } from '@/server/display';
import { getTvDeviceByToken, TV_COOKIE } from '@/server/tv-kiosk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Forme de réponse attendue par le bundle de l'écran (TV_SNAPSHOT_SHAPE dans
 * TVBoard.tsx, même valeur). Un téléviseur appairé reste allumé pendant les
 * déploiements et continue de faire tourner l'ancien bundle, qui ne sait pas
 * lire la réponse d'aujourd'hui : il planterait au rendu et resterait figé
 * sur la page d'erreur jusqu'à ce que quelqu'un prenne la télécommande.
 * Sans ce marqueur, on répond donc 401 avant toute lecture : l'ancien bundle
 * se recharge de lui-même, son cookie d'appairage est intact, et la page
 * rechargée apporte le nouveau bundle, qui envoie le marqueur.
 * Jamais l'ancienne forme en retour : elle transportait les notes du pro.
 */
const TV_SNAPSHOT_SHAPE = 'display-1';

export async function GET(request: Request) {
  if (request.headers.get('x-tv-shape') !== TV_SNAPSHOT_SHAPE) {
    return NextResponse.json(
      { ok: false, error: 'Écran à recharger.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  const jar = await cookies();
  const device = await getTvDeviceByToken(jar.get(TV_COOKIE)?.value);

  if (!device) {
    return NextResponse.json(
      { ok: false, error: 'Écran non appairé.' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    );
  }

  // Le téléviseur est public : il ne reçoit que ce qu'il affiche (0031),
  // jamais l'instantané du poste du pro (notes, journal des notifications).
  const snapshot = await getDisplaySnapshot(device.queueId);

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
