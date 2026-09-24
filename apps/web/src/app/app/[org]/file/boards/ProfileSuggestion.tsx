'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { QueueProfile } from '@/lib/profiles/types';
import common from './board-common.module.css';

/**
 * LA CARTE DE PROPOSITION — pour un garage, un restaurant ou un guichet
 * inscrit avant les profils, et resté en passage au fauteuil.
 *
 * Zéro changement imposé (conception, § 11.1) : la carte propose, le pro
 * décide. « Activer » mène à Réglages (le changement de profil y est
 * refusé tant que des tickets sont en cours) ; « Plus tard » la masque
 * sur cet appareil (`localStorage`, confort seulement). Rendue vide au
 * serveur et à l'hydratation : elle n'apparaît qu'une fois la mémoire de
 * l'appareil relue, sans clignoter pour qui l'a déjà écartée.
 */

const PITCH: Partial<Record<QueueProfile, { title: string; body: string }>> = {
  vehicle: {
    title: 'Nouveau : le poste Atelier pour les garages',
    body: 'Plaques d’immatriculation, étapes, devis validés depuis le téléphone, « Prêt · prévenir » en un geste.',
  },
  device: {
    title: 'Nouveau : le poste Atelier pour la réparation',
    body: 'Numéro de dossier, étapes, devis validés depuis le téléphone, « Prêt · prévenir » en un geste.',
  },
  table: {
    title: 'Nouveau : le poste Salle pour les restaurants',
    body: 'Couverts par groupe, « Table libre pour 4 » qui propose le bon groupe, avis Google après le repas.',
  },
  desk: {
    title: 'Nouveau : le poste Guichet',
    body: 'Numéros de ticket, plusieurs guichets, « Appeler le suivant » en un geste, aucun nom affiché.',
  },
  retail: {
    title: 'Nouveau : le poste Boutique',
    body: 'Le conseil dans l’ordre d’arrivée, et « Commande prête » pour les retraits.',
  },
};

export function ProfileSuggestion({ orgSlug, profile, label }: { orgSlug: string; profile: QueueProfile; label: string }) {
  const key = `rangvia:suggestion-profil:${orgSlug}:${profile}`;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try { dismissed = window.localStorage.getItem(key) === '1'; } catch { /* navigation privée */ }
    setVisible(!dismissed);
  }, [key]);

  const pitch = PITCH[profile];
  if (!visible || !pitch) return null;

  const later = () => {
    try { window.localStorage.setItem(key, '1'); } catch { /* confort seulement */ }
    setVisible(false);
  };

  return (
    <aside className={common.suggestion} aria-labelledby="suggestion-profil">
      <span className={common.suggestionTag}>{label}</span>
      <div className={common.suggestionText}>
        <h2 id="suggestion-profil" className={common.suggestionTitle}>{pitch.title}</h2>
        <p className={common.suggestionBody}>{pitch.body}</p>
      </div>
      <div className={common.suggestionActions}>
        <Link href="/design/metiers" className="btn btn--ghost btn--sm">Voir l’aperçu</Link>
        <Link href={`/app/${orgSlug}/reglages#profil`} className="btn btn--solid btn--sm">Activer</Link>
        <button type="button" className="btn btn--quiet btn--sm" onClick={later}>Plus tard</button>
      </div>
    </aside>
  );
}
