'use client';

export function PrintButton() {
  return (
    <button type="button" className="btn btn--signal btn--sm" onClick={() => window.print()}>
      Imprimer / enregistrer en PDF
    </button>
  );
}
