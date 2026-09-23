/**
 * LE SEUIL — la sortie de la file : deux poteaux et un linteau de 3 px,
 * marqué « Comptoir ». Il encadre ce qui se passe au bout de la file
 * (« C'est votre tour », la plaque de fin d'onboarding…).
 *
 * `draw` : le cadre se dessine une fois au montage (poteaux puis linteau,
 * CSS pur, mouvement permis seulement). Rendu pur, compatible serveur.
 */

export interface SeuilProps {
  /** Défaut « Comptoir ». Chaîne vide : pas de libellé. */
  label?: string;
  /** Couleur du cadre : signal (vermillon, défaut), ink (sur fond vermillon) ou bone. */
  tone?: 'signal' | 'ink' | 'bone';
  /** Dessin unique au montage. */
  draw?: boolean;
  className?: string;
  children: React.ReactNode;
}

const TONES = {
  signal: 'var(--accent)',
  ink: 'var(--ink-1000)',
  bone: 'var(--bone-100)',
} as const;

export function Seuil({
  label = 'Comptoir',
  tone = 'signal',
  draw = false,
  className,
  children,
}: SeuilProps): React.JSX.Element {
  return (
    <div
      className={className ? `seuil ${className}` : 'seuil'}
      data-draw={draw ? '1' : undefined}
      style={{ ['--seuil-color' as string]: TONES[tone] } as React.CSSProperties}
    >
      <span className="seuil__post seuil__post--l" aria-hidden="true" />
      <span className="seuil__post seuil__post--r" aria-hidden="true" />
      <span className="seuil__lintel" aria-hidden="true" />
      {label && (
        <span className="seuil__label" aria-hidden="true">
          {label}
        </span>
      )}
      {children}
    </div>
  );
}
