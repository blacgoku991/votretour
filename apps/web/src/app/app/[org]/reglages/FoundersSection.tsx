'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Section, SettingRow, Toggle } from '@/components/Page';
import { FounderTicketPreview } from '@/components/founders/FoundersQueue';
import { FOUNDERS_PLACES, type FounderPlace } from '@/components/founders/places';
import { setFoundersShowcase } from '@/server/actions/founders';
import styles from '@/components/founders/FoundersSettings.module.css';

/**
 * RÉGLAGES — « Apparaître parmi les premiers commerces sur Rangvia ».
 *
 * Le pied de page du site public montre les dix premiers commerces
 * inscrits, avec leur accord. Ici, le commerce donne ou retire cet accord,
 * en sachant exactement ce qui sera montré : l'aperçu est le ticket réel
 * (nom et ville), et la phrase dit sa place, ou qu'il attend qu'une place
 * se libère. Désactivé par défaut ; réservé au propriétaire et aux
 * administrateurs (`settings.manage`), l'action le revérifie.
 */
export function FoundersSection({
  orgSlug,
  canManage,
  optIn,
  place,
  name,
  city,
}: {
  orgSlug: string;
  canManage: boolean;
  /** Accord en cours (organization_settings.founders_opt_in). */
  optIn: boolean;
  /** Place dans la file des volontaires (null sans accord). */
  place: number | null;
  /** Nom du commerce, tel qu'il s'afficherait. */
  name: string;
  /** Ville du premier établissement actif, s'il en a une. */
  city: string | null;
}) {
  const router = useRouter();
  const [state, setState] = useState({ optIn, place });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const toggle = (next: boolean) => {
    setError(null);
    const previous = state;
    // L'interrupteur bascule tout de suite ; il revient si l'action échoue.
    setState({ optIn: next, place: next ? state.place : null });
    startTransition(async () => {
      const result = await setFoundersShowcase({ orgSlug, optIn: next });
      if (!result.ok) {
        setState(previous);
        setError(result.error);
        return;
      }
      setState(result.data);
      router.refresh();
    });
  };

  // L'aperçu : le vrai ticket, numéroté à sa place s'il en a une parmi les
  // dix ; sinon, le talon montre « –– » plutôt qu'un numéro qu'il n'a pas.
  const shown = state.optIn && state.place !== null && state.place <= FOUNDERS_PLACES ? state.place : null;
  const preview: FounderPlace = { place: shown ?? 1, kind: 'taken', name, city };

  let status: string;
  if (!state.optIn) {
    status = 'Vous n’apparaissez pas sur le site. Rien n’est montré sans votre accord.';
  } else if (state.place === null) {
    status = pending ? 'Enregistrement…' : 'Votre accord est enregistré.';
  } else if (state.place <= FOUNDERS_PLACES) {
    status = `Vous apparaissez en place n° ${state.place} sur ${FOUNDERS_PLACES}, dans le pied de page de chaque page publique.`;
  } else {
    status = `Les ${FOUNDERS_PLACES} places sont prises par des commerces inscrits avant vous. Vous êtes ${state.place}ᵉ parmi les volontaires, dans l’ordre d’inscription\u00a0: vous apparaîtrez dès qu’une place se libère.`;
  }

  return (
    <Section
      title="Premiers commerces sur Rangvia"
      description="Le pied de page du site public montre les dix premiers commerces inscrits sur Rangvia, du 1ᵉʳ au 10ᵉ, avec leur accord."
    >
      <SettingRow
        label="Apparaître parmi les premiers commerces sur Rangvia"
        hint="Seuls le nom de votre commerce et sa ville sont affichés. Jamais de logo, d’adresse ni de prénom. Vous pouvez vous retirer à tout moment : le retrait est immédiat."
      >
        <Toggle
          checked={state.optIn}
          label="Apparaître parmi les premiers commerces sur Rangvia"
          disabled={!canManage || pending}
          onChange={toggle}
        />
      </SettingRow>

      <div className={styles.row}>
        <div className={styles.stage}>
          <FounderTicketPreview place={preview} unranked={shown === null} />
        </div>
        <div className={styles.text}>
          <p className={styles.label}>Ce qui s’affiche</p>
          <p className={styles.status} role="status" aria-live="polite">{status}</p>
          {!city && (
            <p className={styles.hint}>
              Aucune ville n’est renseignée pour vos établissements&nbsp;: seul le nom apparaîtra.
              Ajoutez-la dans «&nbsp;Établissement&nbsp;».
            </p>
          )}
          {!canManage && (
            <p className={styles.hint}>Seuls le propriétaire et les administrateurs peuvent changer ce choix.</p>
          )}
          {error && <p className="error-text" role="alert">{error}</p>}
        </div>
      </div>
    </Section>
  );
}
