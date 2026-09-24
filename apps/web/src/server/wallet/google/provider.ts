import 'server-only';
import type { WalletProvider } from '../types';

/**
 * Fournisseur Google Wallet : VERSION PROVISOIRE du lot W1.
 *
 * Le lot W3 prend possession de ce fichier et le remplace (compte de
 * service, classes, objets, JWT d'enregistrement, messages). D'ici là, le
 * fournisseur se déclare « non prêt » : aucun bouton, aucune simulation.
 */
export const googleProvider: WalletProvider = {
  id: 'google',
  async status() {
    return { ready: false, reason: 'non construit' };
  },
  async distribute() {
    return new Response('Introuvable', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  },
  async process() {
    return { ok: false, error: 'Fournisseur Google Wallet non construit', retryAfterSeconds: 300, dead: false, haltProvider: true };
  },
};
