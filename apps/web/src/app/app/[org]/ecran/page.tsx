import type { Metadata } from 'next';
import { requireOrgAccess } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { getQueueSnapshot } from '@/server/queue';
import { PageHeader } from '@/components/Page';
import { TVBoard } from './TVBoard';
import styles from './ecran.module.css';

export const metadata: Metadata = { title: 'Écran TV', robots: { index: false } };
export const dynamic = 'force-dynamic';

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
      .select('id, name, is_default')
      .eq('organization_id', access.organization.organization_id)
      .order('is_default', { ascending: false })
      .order('created_at'),
  ]);

  const list = queues ?? [];
  const selected = list.find((q) => q.id === file) ?? list[0] ?? null;
  const snapshot = selected ? await getQueueSnapshot(selected.id) : null;
  const screenHref = `/ecran/${org}${selected && list.length > 1 ? `?file=${encodeURIComponent(selected.id)}` : ''}`;

  return (
    <div className={`shell ${styles.page}`}>
      <PageHeader
        title="Écran TV"
        description="La file en grand, au mur de votre salon : qui est au comptoir (le prénom que le client a saisi, pour qu’il se reconnaisse), combien attendent, et les places à suivre en initiales seulement. L’aperçu ci-dessous est l’écran réel, en direct."
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
