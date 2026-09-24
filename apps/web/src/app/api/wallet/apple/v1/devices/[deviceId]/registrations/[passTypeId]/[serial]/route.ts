import { appleWebServiceDeps, safely } from '@/server/wallet/apple/routes';
import { registerDevice, unregisterDevice } from '@/server/wallet/apple/webservice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Service web Apple Wallet : inscription (POST) et désinscription (DELETE)
 * d'un appareil pour un pass. Appelé par l'iPhone lui-même, sans cookie ;
 * authentifié par l'en-tête `ApplePass`. Logique : webservice.ts.
 */

type Params = { params: Promise<{ deviceId: string; passTypeId: string; serial: string }> };

export async function POST(request: Request, context: Params) {
  const params = await context.params;
  return safely(() => registerDevice(request, params, appleWebServiceDeps()));
}

export async function DELETE(request: Request, context: Params) {
  const params = await context.params;
  return safely(() => unregisterDevice(request, params, appleWebServiceDeps()));
}
