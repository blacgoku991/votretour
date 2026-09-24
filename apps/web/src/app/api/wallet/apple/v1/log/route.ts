import { appleWebServiceDeps, safely } from '@/server/wallet/apple/routes';
import { receiveLog } from '@/server/wallet/apple/webservice';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Service web Apple Wallet : journal d'erreurs envoyé par l'iPhone.
 * Tronqué, jetons masqués, écrit dans les journaux applicatifs seulement
 * (jamais en base). Logique : webservice.ts.
 */
export async function POST(request: Request) {
  return safely(() => receiveLog(request, appleWebServiceDeps()));
}
