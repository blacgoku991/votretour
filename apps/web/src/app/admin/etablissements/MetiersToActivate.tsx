import 'server-only';
import Link from 'next/link';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isLegacyProfile, QUEUE_PROFILES } from '@/lib/profiles';
import { formatNumber } from '@/lib/format';
import { ACTIVITIES_WITH_METIER, metiersToActivate } from './metier-pending';
import styles from './metier-pending.module.css';

/**
 * VUE D'ENSEMBLE /admin — « MÉTIERS À ACTIVER ».
 *
 * Le compteur des organisations qui attendent l'interface de leur métier
 * (règle : `metier-pending.ts`). Une latte cliquable, sous les huit
 * indicateurs de la salle de contrôle (une neuvième tuile laisserait une
 * orpheline), qui mène à la liste filtrée. Vermillon quand il y a du
 * travail, calme sinon.
 *
 * À rendre depuis une page qui a déjà vérifié le rôle super-admin.
 */

export interface MetiersToActivateData {
  /** null : la lecture a échoué (la tuile le dit, sans chiffre inventé). */
  count: number | null;
  /** Les plus anciennes inscriptions en attente, pour donner des noms. */
  names: string[];
}

/** Profils propres (hors passage et événement) : seules ces files éteignent un signal. */
const METIER_PROFILES = QUEUE_PROFILES.filter((p) => !isLegacyProfile(p));

export async function loadMetiersToActivate(db: SupabaseClient): Promise<MetiersToActivateData> {
  // Deux lectures sans liste d'identifiants dans l'URL : les organisations
  // d'une activité à métier, et les seules files déjà dans un métier.
  const [orgs, queues] = await Promise.all([
    db.from('organizations')
      .select('id, name, activity')
      .in('activity', [...ACTIVITIES_WITH_METIER])
      .order('created_at', { ascending: true })
      .limit(1000),
    db.from('queues')
      .select('organization_id, profile')
      .in('profile', METIER_PROFILES)
      .limit(5000),
  ]);
  if (orgs.error || queues.error) return { count: null, names: [] };
  const rows = (orgs.data ?? []) as { id: string; name: string; activity: string | null }[];
  const pending = metiersToActivate(rows, (queues.data ?? []) as { organization_id: string; profile: string | null }[]);
  return {
    count: pending.size,
    names: rows.filter((o) => pending.has(o.id)).slice(0, 3).map((o) => o.name),
  };
}

export function MetiersToActivateCard({ data }: { data: MetiersToActivateData }) {
  const { count, names } = data;
  const waiting = (count ?? 0) > 0;
  const detail = count === null
    ? 'Lecture impossible pour l’instant.'
    : count === 0
      ? 'Aucune installation en attente\u00a0: chaque garage, restaurant, guichet ou boutique inscrit a son métier.'
      : `${names.join(' · ')}${count > names.length ? ` et ${formatNumber(count - names.length)} autre${count - names.length > 1 ? 's' : ''}` : ''} ${count > 1 ? 'attendent l’interface de leur métier' : 'attend l’interface de son métier'}.`;
  return (
    <Link
      href="/admin/etablissements?metier=a-activer"
      className={styles.card}
      data-waiting={waiting ? '1' : undefined}
    >
      <span className={styles.cardKicker}>Métiers à activer</span>
      <strong className={styles.cardCount}>{count === null ? '—' : formatNumber(count)}</strong>
      <span className={styles.cardText}>{detail}</span>
      <span className={styles.cardGo} aria-hidden="true">
        Voir la liste
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" />
        </svg>
      </span>
    </Link>
  );
}
