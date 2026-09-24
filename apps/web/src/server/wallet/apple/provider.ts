import 'server-only';
import type { WalletProvider } from '../types';

/**
 * Fournisseur Apple Wallet : VERSION PROVISOIRE du lot W1.
 *
 * Le lot W2 prend possession de ce fichier et le remplace (configuration,
 * signature du .pkpass, APNs, service web). D'ici là, le fournisseur se
 * déclare « non prêt » : aucun bouton n'apparaît, la route de
 * distribution refuse, et le vidage de la file d'envoi l'ignore. Rien
 * n'est simulé.
 */
export const appleProvider: WalletProvider = {
  id: 'apple',
  async status() {
    return { ready: false, reason: 'non construit' };
  },
  async distribute() {
    return new Response('Introuvable', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  },
  async process() {
    return { ok: false, error: 'Fournisseur Apple Wallet non construit', retryAfterSeconds: 300, dead: false, haltProvider: true };
  },
};
