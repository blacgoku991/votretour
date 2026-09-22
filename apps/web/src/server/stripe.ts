import 'server-only';
import Stripe from 'stripe';
import { env } from '@/lib/env';

let client: Stripe | null = null;

export function stripeConfigured(): boolean {
  return Boolean(env.stripe.secretKey);
}

/**
 * Client Stripe.
 *
 * L'abonnement est facultatif : sans clé configurée, le produit
 * fonctionne entièrement en mode essai et l'interface le dit, plutôt que
 * d'afficher un bouton de paiement qui ne mène nulle part.
 */
export function stripe(): Stripe {
  if (!env.stripe.secretKey) {
    throw new Error(
      'Stripe non configuré (STRIPE_SECRET_KEY). La facturation est désactivée sur cette installation.',
    );
  }
  if (!client) {
    client = new Stripe(env.stripe.secretKey, {
      // Version d'API figée : une évolution côté Stripe ne doit pas
      // changer silencieusement le comportement de la facturation.
      apiVersion: '2026-08-26.dahlia',
      appInfo: { name: 'VotreTour', version: '1.0.0' },
      maxNetworkRetries: 2,
    });
  }
  return client;
}
