import type { Metadata } from 'next';
import { requireOrgAccess } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getDisplaySnapshot, refreshDisplaySnapshot } from '@/server/display';
import { PageHeader } from '@/components/Page';
import { isQueueProfile } from '@/lib/profiles';
import { resolveProfileOptions } from '@/lib/profiles/options';
import type { QueueProfile } from '@/lib/profiles/types';
import { TVBoard } from './TVBoard';
import styles from './ecran.module.css';

export const metadata: Metadata = { title: 'Écran TV', robots: { index: false } };
export const dynamic = 'force-dynamic';

/** Le texte d'hier, pour les barbiers et les événements : inchangé. */
const WALKIN_DESCRIPTION =
  'La file en grand, au mur de votre salon : qui est au comptoir (le prénom que le client a saisi, pour qu’il se reconnaisse), combien attendent, et les places à suivre en initiales seulement. L’aperçu ci-dessous est l’écran réel, en direct.';

/**
 * Ce que montre l'écran de la salle, dit au professionnel dans les mots
 * de son métier, et dans les limites RÉELLES de `display_snapshot` (0036) :
 * une immatriculation n'y est jamais entière, un guichet n'y affiche
 * jamais de nom. Le texte suit le réglage de la file (plaque masquée,
 * modèle seul ou compteurs).
 */
function screenDescription(profile: QueueProfile, options: unknown): string {
  const live = 'L’aperçu ci-dessous est l’écran réel, en direct.';
  switch (profile) {
    case 'vehicle': {
      const mode = resolveProfileOptions('vehicle', options).tvRegistration ?? 'masked';
      const lead = mode === 'none'
        ? 'Les véhicules prêts, en compteurs seulement : aucune ligne de véhicule à l’écran.'
        : mode === 'model_only'
          ? 'Les véhicules prêts, par leur modèle, sans aucune immatriculation.'
          : 'Les véhicules prêts, immatriculation masquée : seuls les trois derniers caractères restent visibles.';
      return `${lead} Et combien sont à l’atelier. ${live}`;
    }
    case 'device':
      return `Les appareils prêts, par numéro de dossier : jamais de nom ni de modèle complet. Et combien sont à l’atelier. ${live}`;
    case 'table':
      return `Les tables prêtes et le groupe qu’on appelle, avec ses couverts ; à côté, l’attente en groupes et en couverts. ${live}`;
    case 'desk':
      return `Le tableau d’appel : le numéro et le guichet, jamais de nom. ${live}`;
    case 'retail':
      return `Les commandes prêtes, par la fin de leur numéro, jamais par un nom. ${live}`;
    default:
      return WALKIN_DESCRIPTION;
  }
}

/**
 * Rafraîchissement de l'aperçu, toutes les 5 secondes : l'action revérifie
 * l'accès à chaque appel et ne renvoie que l'instantané d'affichage (0031).
 */
async function refreshScreen(queueId: string) {
  'use server';
  return refreshDisplaySnapshot(queueId);
}

export default async function TVPage({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ file?: string }>;
}) {
  const { org } = await params;
  const { file } = await searchParams;
  const access = await requireOrgAccess(org);
  const db = supabaseAdmin();

  const [{ data: organization }, { data: queues }] = await Promise.all([
    db.from('organizations')
      .select('name, logo_url')
      .eq('id', access.organization.organization_id)
      .maybeSingle(),
    db.from('queues')
      .select('id, name, is_default, profile, profile_options')
      .eq('organization_id', access.organization.organization_id)
      .order('is_default', { ascending: false })
      .order('created_at'),
  ]);

  const list = queues ?? [];
  const selected = list.find((q) => q.id === file) ?? list[0] ?? null;
  const snapshot = selected ? await getDisplaySnapshot(selected.id) : null;
  const screenHref = `/ecran/${org}${selected && list.length > 1 ? `?file=${encodeURIComponent(selected.id)}` : ''}`;

  return (
    <div className={`shell ${styles.page}`}>
      <PageHeader
        title="Écran TV"
        description={selected && isQueueProfile(selected.profile)
          ? screenDescription(selected.profile, selected.profile_options)
          : WALKIN_DESCRIPTION}
        actions={
          <a className="btn btn--signal" href={screenHref}>
            Ouvrir l’écran TV
          </a>
        }
      />

      <figure className={styles.preview}>
        <TVBoard
          orgSlug={org}
          organizationName={organization?.name ?? access.organization.name}
          logoUrl={organization?.logo_url ?? null}
          initialSnapshot={snapshot}
          refresh={refreshScreen}
          queues={list.map((q) => ({ id: q.id, name: q.name }))}
          variant="preview"
        />
        <figcaption className={styles.caption}>
          <span className={styles.stand} aria-hidden="true" />
          <span className="t-label">Aperçu en direct · mis à jour toutes les 5 secondes</span>
        </figcaption>
      </figure>

      <ol className={`rail-list ${styles.steps}`}>
        <li>
          <span className={styles.stepKey}>01</span>
          <span>Ouvrez l’écran TV sur l’ordinateur ou la clé branchée au téléviseur.</span>
        </li>
        <li>
          <span className={styles.stepKey}>02</span>
          <span>Passez en plein écran : l’affichage s’adapte à l’écran, horizontal ou vertical.</span>
        </li>
        <li>
          <span className={styles.stepKey}>03</span>
          <span>Laissez-le allumé : il se met à jour tout seul et se décale de deux pixels toutes les dix minutes pour ménager la dalle.</span>
        </li>
      </ol>
    </div>
  );
}
