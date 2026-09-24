'use client';

import type { ActivityType } from '@/lib/profiles/types';
import { METIER_FAMILIES, metierLabel } from './metiers';
import styles from './onboarding.module.css';

/**
 * LA GRILLE DE MÉTIERS — remplace le `<select>` d'activité.
 *
 * Chaque métier est une tuile illustrée, posée en relief comme une latte ;
 * le métier choisi prend le vermillon (« c'est vous », comme la latte de
 * l'étape en cours dans la colonne de progression) et se soulève de 2 px.
 *
 * Accessibilité : ce sont de VRAIS boutons radio (`<input type="radio">`,
 * même `name`), rendus invisibles sous la tuile. Le navigateur fournit
 * donc tout le comportement attendu, sans script : Tab entre dans le
 * groupe sur le métier choisi, les flèches passent d'un métier à l'autre
 * (d'une famille à la suivante aussi), le lecteur d'écran annonce
 * « Garage, bouton radio, sélectionné, 5 sur 15 » dans le groupe
 * « Automobile ». Le focus clavier se voit sur la tuile.
 *
 * Mise en page : sur téléphone (390 px d'abord), deux tuiles par ligne,
 * les familles se suivant en paires ; leur nom reste lu par les lecteurs
 * d'écran. À partir de 720 px, une famille par ligne, son nom à gauche,
 * comme un rayon de métiers.
 *
 * Choisir une tuile DÉCLARE l'activité ; elle ne choisit pas le métier,
 * que l'équipe Rangvia active à l'installation.
 *
 * `note` : sur téléphone, la grille est haute ; ce qui concerne le métier
 * touché (la phrase de l'installation) se lit donc juste sous SA famille,
 * pas vingt tuiles plus bas. Le parcours la place aussi sous la grille
 * pour l'étagère (à partir de 720 px) ; le CSS n'en montre qu'une.
 */

export function MetierPicker({
  value,
  onChange,
  note,
}: {
  value: ActivityType;
  onChange: (activity: ActivityType) => void;
  /** Rendu sous la famille du métier choisi (voir plus haut). */
  note?: React.ReactNode;
}) {
  return (
    <fieldset className={styles.metiers}>
      <legend className={styles.metiersLegend}>Activité</legend>
      {METIER_FAMILIES.map((family) => (
        <div
          key={family.id}
          role="group"
          aria-labelledby={`famille-${family.id}`}
          className={styles.family}
          style={{ ['--n' as string]: family.activities.length } as React.CSSProperties}
        >
          <span id={`famille-${family.id}`} className={styles.familyLabel}>
            <span className={styles.familyText}>{family.label}</span>
          </span>
          <div className={styles.tiles}>
            {family.activities.map((activity) => {
              const checked = activity === value;
              return (
                <label key={activity} className={styles.tile} data-checked={checked ? '1' : undefined}>
                  <input
                    type="radio"
                    name="activity"
                    value={activity}
                    checked={checked}
                    onChange={() => onChange(activity)}
                    className={styles.tileInput}
                  />
                  <span className={styles.tileFace}>
                    <span className={styles.tileGlyph} aria-hidden="true">
                      <MetierGlyph activity={activity} />
                    </span>
                    <span className={styles.tileLabel}>{tileLabel(activity)}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {note && family.activities.includes(value) ? note : null}
        </div>
      ))}
    </fieldset>
  );
}

/**
 * Nom affiché sur la tuile : celui de `ACTIVITY_LABEL`, la barre collée au
 * mot qui la précède (« Guichet / comptoir » ne laisse jamais « / comptoir »
 * seul sur sa ligne, ni « Événement / » sans « Drop »).
 */
function tileLabel(activity: ActivityType): string {
  return metierLabel(activity).replace(/ \/ /g, '\u00a0/ ');
}

/**
 * Les pictogrammes des métiers, dans la géométrie des icônes de
 * l'application (grille de 20, trait de 1,6, angles et bouts arrondis),
 * comme `DeviceGlyph`. Toujours décoratifs : le nom du métier est écrit.
 */
const GLYPHS: Readonly<Record<ActivityType, React.ReactNode>> = {
  // L'enseigne du barbier : le poteau rayé.
  barber: (
    <>
      <path d="M8.4 4.4V3.3a1.6 1.6 0 0 1 3.2 0v1.1" />
      <path d="M6.2 4.6h7.6M6.2 15.4h7.6" />
      <rect x="7.2" y="4.6" width="5.6" height="10.8" rx="1" />
      <path d="M7.2 9.4 12.8 6.8M7.2 13.2l5.6-2.6" />
      <path d="M8.6 15.4v1.8h2.8v-1.8" />
    </>
  ),
  hair_salon: (
    <>
      <circle cx="5.6" cy="14.6" r="2.5" />
      <circle cx="14.4" cy="14.6" r="2.5" />
      <path d="M7.4 12.8 15 2.8M12.6 12.8 5 2.8" />
    </>
  ),
  nail_bar: (
    <>
      <rect x="8" y="2.4" width="4" height="4.8" rx="1" />
      <rect x="5.4" y="7.2" width="9.2" height="10.4" rx="2.6" />
      <path d="M8.2 10.4v3.6" />
    </>
  ),
  beauty: (
    <>
      <path d="M10 17.4c-3.5-1.7-5.4-4.4-5.4-7.9 2.3 0 4.2 1 5.4 2.9 1.2-1.9 3.1-2.9 5.4-2.9 0 3.5-1.9 6.2-5.4 7.9z" />
      <path d="M10 12.4c-1.5-1.6-2-3.7-1.4-6.1.3-1.1.8-2.1 1.4-3 .6.9 1.1 1.9 1.4 3 .6 2.4.1 4.5-1.4 6.1z" />
    </>
  ),
  // Une voiture de face : c'est ce que voit le réceptionnaire.
  garage: (
    <>
      <path d="M3.6 11.2 5.1 7a2 2 0 0 1 1.9-1.4h6a2 2 0 0 1 1.9 1.4l1.5 4.2" />
      <rect x="2.6" y="11.2" width="14.8" height="4.6" rx="1.4" />
      <path d="M4.9 15.8v1.4M15.1 15.8v1.4" />
      <path d="M5.4 13.5h1.3M13.3 13.5h1.3" />
    </>
  ),
  auto_center: (
    <>
      <circle cx="10" cy="10" r="7.6" />
      <circle cx="10" cy="10" r="4.2" />
      <path d="M10 2.4v1.6M10 16v1.6M2.4 10H4M16 10h1.6M4.6 4.6l1.1 1.1M14.3 14.3l1.1 1.1M4.6 15.4l1.1-1.1M14.3 5.7l1.1-1.1" />
      <circle cx="10" cy="10" r="1.1" />
    </>
  ),
  // L'écran fêlé : ce qu'on vient faire réparer.
  phone_repair: (
    <>
      <rect x="5.4" y="1.8" width="9.2" height="16.4" rx="2.4" />
      <path d="M8.6 15.6h2.8" />
      <path d="M11.8 4.6 9.6 7.6l2 1.8-2.4 3" />
    </>
  ),
  // La flèche du retour, et la prise en charge.
  aftersales: (
    <>
      <path d="M16.2 10.4a6.2 6.2 0 1 1-2.1-5.1" />
      <path d="M14.8 2.6 14.2 5.6l3 .5" />
      <path d="M7.4 10.3 9.3 12.2l3.4-3.8" />
    </>
  ),
  restaurant: (
    <>
      <path d="M5.2 2.6v4.3a2 2 0 0 0 4 0V2.6M7.2 2.6v14.8" />
      <path d="M14.8 17.4V2.6c-1.9 1-3.1 3.2-3.1 6.1v2.2h3.1" />
    </>
  ),
  // Le guichet : une vitre, une tablette, un comptoir.
  counter: (
    <>
      <path d="M2.6 17.4h14.8" />
      <path d="M4.2 17.4V6.2a3 3 0 0 1 3-3h5.6a3 3 0 0 1 3 3v11.2" />
      <path d="M4.2 11.2h11.6" />
      <path d="M7 11.2V7.8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3.4" />
    </>
  ),
  admin_service: (
    <>
      <path d="M2.6 7 10 3l7.4 4" />
      <path d="M3.6 7.6h12.8" />
      <path d="M5.6 8.4v6M10 8.4v6M14.4 8.4v6" />
      <path d="M3.4 14.8h13.2M2.6 17.2h14.8" />
    </>
  ),
  health: (
    <>
      <rect x="2.8" y="2.8" width="14.4" height="14.4" rx="4" />
      <path d="M10 6.4v7.2M6.4 10h7.2" />
    </>
  ),
  shop: (
    <>
      <path d="M4.4 7h11.2l-.9 9.3a1.5 1.5 0 0 1-1.5 1.4H6.8a1.5 1.5 0 0 1-1.5-1.4z" />
      <path d="M7.4 9.2V5.8a2.6 2.6 0 0 1 5.2 0v3.4" />
    </>
  ),
  // Le billet d'un drop, avec ses encoches.
  event: (
    <>
      <path d="M3 6.6A1.6 1.6 0 0 1 4.6 5h10.8A1.6 1.6 0 0 1 17 6.6v1.8a1.6 1.6 0 0 0 0 3.2v1.8a1.6 1.6 0 0 1-1.6 1.6H4.6A1.6 1.6 0 0 1 3 13.4v-1.8a1.6 1.6 0 0 0 0-3.2z" />
      <path d="M12.6 5.4v1.4M12.6 9.3v1.4M12.6 13.2v1.4" />
    </>
  ),
  other: (
    <>
      <rect x="3" y="3" width="5.6" height="5.6" rx="1.6" />
      <rect x="11.4" y="3" width="5.6" height="5.6" rx="1.6" />
      <rect x="3" y="11.4" width="5.6" height="5.6" rx="1.6" />
      <rect x="11.4" y="11.4" width="5.6" height="5.6" rx="1.6" />
    </>
  ),
};

export function MetierGlyph({ activity, size = 22 }: { activity: ActivityType; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {GLYPHS[activity]}
    </svg>
  );
}
