/**
 * Revenu mensuel récurrent : une seule définition pour tout l'admin.
 *
 * Seuls les abonnements « active » comptent : un essai n'a rien payé
 * et peut ne jamais être converti. Les formules annuelles sont ramenées
 * au mois. Le tableau de bord et la page Offres appellent tous deux
 * cette fonction, ils affichent donc forcément le même chiffre.
 */
export interface BillableSubscription {
  status: string;
  billing_interval: string | null;
  priceMonthCents: number | null | undefined;
  priceYearCents: number | null | undefined;
}

export const isBillable = (status: string) => status === 'active';

export function monthlyRecurringCents(subscriptions: BillableSubscription[]): number {
  return subscriptions.reduce((total, s) => {
    if (!isBillable(s.status)) return total;
    return total + (s.billing_interval === 'year'
      ? Math.round((s.priceYearCents ?? 0) / 12)
      : (s.priceMonthCents ?? 0));
  }, 0);
}
