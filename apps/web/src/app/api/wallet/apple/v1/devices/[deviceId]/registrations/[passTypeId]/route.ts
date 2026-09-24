import { appleWebServiceDeps, safely } from '@/server/wallet/apple/routes';
import { listUpdatedSerials } from '@/server/wallet/apple/webservice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Service web Apple Wallet : passes de cet appareil modifiés depuis
 * `passesUpdatedSince` (200 avec la liste et `lastUpdated`, 204 sinon).
 * Logique : webservice.ts.
 */
export async function GET(request: Request, context: { params: Promise<{ deviceId: string; passTypeId: string }> }) {
  const params = await context.params;
  return safely(() => listUpdatedSerials(request, params, appleWebServiceDeps()));
}
