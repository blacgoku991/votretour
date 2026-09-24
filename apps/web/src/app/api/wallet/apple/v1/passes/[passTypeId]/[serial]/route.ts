import { appleWebServiceDeps, safely } from '@/server/wallet/apple/routes';
import { getLatestPass } from '@/server/wallet/apple/webservice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Service web Apple Wallet : dernière version d'un pass (.pkpass signé),
 * ou 304 si l'appareil l'a déjà (If-Modified-Since). Logique : webservice.ts.
 */
export async function GET(request: Request, context: { params: Promise<{ passTypeId: string; serial: string }> }) {
  const params = await context.params;
  return safely(() => getLatestPass(request, params, appleWebServiceDeps()));
}
