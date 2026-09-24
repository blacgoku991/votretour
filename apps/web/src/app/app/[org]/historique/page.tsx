import type { Metadata } from 'next';
import { Fragment } from 'react';
import { requireOrgAccess } from '@/server/auth';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { PageHeader, Section, EmptyState } from '@/components/Page';
import { STAFF_STATUS_LABEL, SOURCE_LABEL } from '@/lib/copy';
import { formatDurationBounded, formatTime } from '@/lib/format';
import type { EntryStatus } from '@/lib/types';
import { Immatriculation } from '@/components/objects/Immatriculation';
import { isLegacyProfile, isQueueProfile } from '@/lib/profiles';
import { displayRegistration, maskRegistration, type MaskedRegistration } from '@/lib/profiles/registration';
import { formatTicketNo } from '@/lib/profiles/ticket';
import type { EntryDetails, QueueProfile } from '@/lib/profiles/types';
import { DayLabel } from './DayLabel';
import styles from './history.module.css';

export const metadata: Metadata = { title: 'Historique', robots: { index: false } };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;
const TZ = 'Europe/Paris';

const FILTERS = [
  { key: 'tous', label: 'Tous', statuses: null },
  { key: 'termines', label: 'Terminés', statuses: ['completed'] },
  { key: 'absents', label: 'Absents', statuses: ['absent', 'expired'] },
  { key: 'partis', label: 'Partis', statuses: ['cancelled', 'skipped'] },
] as const;

/** Puce d'issue : jade Terminé, cuivre Absent, ardoise Parti, brique Retiré. */
const TONE: Partial<Record<EntryStatus, 'jade' | 'copper' | 'ardoise' | 'brique' | 'signal'>> = {
  completed: 'jade',
  absent: 'copper',
  expired: 'copper',
  cancelled: 'ardoise',
  skipped: 'brique',
  serving: 'signal',
};

const dayKeyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
});
const dayLabelFmt = new Intl.DateTimeFormat('fr-FR', {
  timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short',
});

interface Entry {
  public_id: string; client_name: string | null; status: string; source: string;
  joined_at: string; service_started_at: string | null; completed_at: string | null;
  staff_id: string | null; location_id: string;
  /* Profils métier (0033) : lus seulement si l'organisation a une file à métier. */
  queue_id?: string; details?: EntryDetails | null; ticket_no?: number | null;
  served_by_staff_id?: string | null; called_at?: string | null;
}

interface QueueRow { id: string; profile: string; ticket_prefix: string | null }

/** Titre de la colonne « fiche » : le mot du métier quand il n'y en a qu'un. */
const FICHE_HEAD: Partial<Record<QueueProfile, string>> = {
  vehicle: 'Véhicule',
  device: 'Dossier',
  table: 'Couverts',
  desk: 'Ticket',
  retail: 'Commande',
};

/**
 * Ce que la colonne « fiche » montre d'un passage, selon le métier de sa
 * file. L'historique est réservé aux membres, mais il s'affiche sur un
 * écran de comptoir : l'immatriculation y reste MASQUÉE (trois derniers
 * caractères), comme à la TV. La recherche d'un véhicule précis se fait
 * au poste, sur l'instantané, pas en parcourant l'historique.
 */
interface Fiche {
  text: string;
  masked: MaskedRegistration | null;
}

function ficheOf(entry: Entry, queue: QueueRow | undefined, deskLabel: (id: string | null | undefined) => string | null): Fiche | null {
  const profile: QueueProfile = queue && isQueueProfile(queue.profile) ? queue.profile : 'walkin';
  if (isLegacyProfile(profile)) return null;
  const d = entry.details ?? {};
  switch (profile) {
    case 'vehicle': {
      const masked = d.registration ? maskRegistration(displayRegistration(d.registration, d.country ?? 'FR')) : null;
      return { text: d.model?.trim() || (masked ? '' : 'Véhicule'), masked };
    }
    case 'device': {
      const no = formatTicketNo('device', entry.ticket_no);
      return { text: [no ? `Dossier ${no}` : null, d.model?.trim() || null].filter(Boolean).join(' · ') || 'Appareil', masked: null };
    }
    case 'table': {
      const n = d.partySize;
      return { text: n ? `${n} couvert${n > 1 ? 's' : ''}` : 'Groupe', masked: null };
    }
    case 'desk': {
      const no = formatTicketNo('desk', entry.ticket_no, queue?.ticket_prefix ?? 'A');
      const desk = deskLabel(entry.served_by_staff_id ?? entry.staff_id);
      return { text: [no, desk].filter(Boolean).join(' · ') || 'Ticket', masked: null };
    }
    case 'retail': {
      const no = formatTicketNo('retail', entry.ticket_no, queue?.ticket_prefix ?? 'A');
      const ref = d.orderRef?.trim();
      return { text: [no, ref ? `n°\u00a0${ref}` : null].filter(Boolean).join(' · ') || 'Passage', masked: null };
    }
    default:
      return null;
  }
}

/**
 * HISTORIQUE — une chronologie accrochée au rail.
 *
 * Séparateurs de jour collants façon panneau de gare ; une ligne dense
 * par passage (44 px sur ordinateur, deux lignes sur téléphone). Les
 * durées passent par formatDurationBounded : jamais « 240 h 00 ».
 */
export default async function HistoryPage({
  params, searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ filtre?: string; page?: string }>;
}) {
  const { org } = await params;
  const { filtre, page } = await searchParams;
  const access = await requireOrgAccess(org, 'stats.view');
  const db = supabaseAdmin();

  const filter = FILTERS.find((f) => f.key === filtre) ?? FILTERS[0];
  const pageIndex = Math.max(0, Number(page ?? '0') || 0);

  // Une organisation qui n'a que des files au passage lit EXACTEMENT les
  // mêmes colonnes qu'avant : rien de nouveau pour un barbier.
  const { data: queueRows } = await db
    .from('queues').select('id, profile, ticket_prefix')
    .eq('organization_id', access.organization.organization_id);
  const queues = (queueRows ?? []) as QueueRow[];
  const profiled = queues.filter((q) => isQueueProfile(q.profile) && !isLegacyProfile(q.profile));
  const withFiche = profiled.length > 0;
  const ficheProfiles = [...new Set(profiled.map((q) => q.profile as QueueProfile))];
  const ficheHead = ficheProfiles.length === 1 ? (FICHE_HEAD[ficheProfiles[0]!] ?? 'Fiche') : 'Fiche';

  let query = db
    .from('queue_entries')
    .select(withFiche
      ? 'public_id, client_name, status, source, joined_at, service_started_at, completed_at, staff_id, location_id, queue_id, details, ticket_no, served_by_staff_id, called_at'
      : 'public_id, client_name, status, source, joined_at, service_started_at, completed_at, staff_id, location_id')
    .eq('organization_id', access.organization.organization_id)
    .order('joined_at', { ascending: false })
    .range(pageIndex * PAGE_SIZE, pageIndex * PAGE_SIZE + PAGE_SIZE - 1);

  if (filter.statuses) query = query.in('status', filter.statuses as unknown as string[]);

  const [{ data: entries }, { data: staff }, { data: locations }] = await Promise.all([
    query,
    db.from('staff').select(withFiche ? 'id, display_name, accent, desk_label' : 'id, display_name, accent')
      .eq('organization_id', access.organization.organization_id),
    db.from('locations').select('id, name')
      .eq('organization_id', access.organization.organization_id),
  ]);

  const rows = (entries ?? []) as unknown as Entry[];
  const staffById = new Map(((staff ?? []) as unknown as { id: string; display_name: string; desk_label?: string | null }[])
    .map((s) => [s.id, s]));
  const queueById = new Map(queues.map((q) => [q.id, q]));
  const deskLabel = (id: string | null | undefined): string | null => {
    const member = id ? staffById.get(id) : null;
    return member ? member.desk_label?.trim() || member.display_name : null;
  };
  const locationById = new Map((locations ?? []).map((l) => [l.id, l]));

  // Regroupement par jour (heure de Paris), dans l'ordre de la requête.
  const days: { key: string; label: string; rows: Entry[] }[] = [];
  for (const entry of rows) {
    const date = new Date(entry.joined_at);
    const key = Number.isNaN(date.getTime()) ? 'inconnu' : dayKeyFmt.format(date);
    let group = days[days.length - 1];
    if (!group || group.key !== key) {
      group = {
        key,
        label: key === 'inconnu' ? 'Date inconnue' : dayLabelFmt.format(date),
        rows: [],
      };
      days.push(group);
    }
    group.rows.push(entry);
  }

  return (
    <div className={`shell ${styles.page}`}>
      <PageHeader
        title="Historique"
        description="Tous les passages, dans l’ordre d’arrivée. Les prénoms disparaissent au-delà de votre durée de conservation."
      />

      <nav className={`seg ${styles.filters}`} aria-label="Filtrer les passages">
        {FILTERS.map((f) => (
          <a key={f.key} href={`/app/${org}/historique?filtre=${f.key}`}
            aria-current={f.key === filter.key ? 'page' : undefined}>
            {f.label}
          </a>
        ))}
      </nav>

      {rows.length === 0 ? (
        <Section>
          <EmptyState
            title="Aucun passage sur cette période"
            description="Les passages apparaîtront ici dès que des clients auront rejoint votre file."
          />
        </Section>
      ) : (
        <div className={styles.timeline} data-fiche={withFiche ? '1' : undefined}>
          <div className={styles.head} aria-hidden="true">
            <span>Heure</span>
            <span>Client</span>
            {withFiche && <span>{ficheHead}</span>}
            <span>Attente</span>
            <span>Prestation</span>
            <span>Professionnel</span>
            <span>Origine</span>
            <span className={styles.headIssue}>Issue</span>
          </div>

          {days.map((day) => (
            <section key={day.key} className={styles.day} aria-labelledby={`jour-${day.key}`}>
              <h2 id={`jour-${day.key}`} className={`t-board ${styles.dayHead}`}>
                <DayLabel dayKey={day.key} date={day.label} />
              </h2>
              <ol className={styles.rows}>
                {day.rows.map((entry) => {
                  const fiche = withFiche && entry.queue_id
                    ? ficheOf(entry, queueById.get(entry.queue_id), deskLabel)
                    : null;
                  // Attente jusqu'à la prise en charge ; pour une file à métier
                  // sans prise en charge (la table passe de « appelé » à
                  // « installé »), jusqu'à l'appel. Un barbier : inchangé.
                  const waitEnd = entry.service_started_at ?? (fiche ? entry.called_at ?? null : null);
                  const wait = waitEnd
                    ? (new Date(waitEnd).getTime() - new Date(entry.joined_at).getTime()) / 1000
                    : null;
                  const service = entry.completed_at && entry.service_started_at
                    ? (new Date(entry.completed_at).getTime() - new Date(entry.service_started_at).getTime()) / 1000
                    : null;
                  const member = entry.staff_id ? staffById.get(entry.staff_id) : null;
                  const status = entry.status as EntryStatus;
                  const tone = TONE[status];
                  const where = locationById.size > 1 ? locationById.get(entry.location_id)?.name : null;
                  const waitText = formatDurationBounded(wait);
                  const serviceText = formatDurationBounded(service);
                  const sourceText = SOURCE_LABEL[entry.source] ?? entry.source;
                  // Ligne 2 sur téléphone : seulement ce qui est connu.
                  const meta = [
                    waitText !== '—' ? `Attente ${waitText}` : null,
                    serviceText !== '—' ? `Prestation ${serviceText}` : null,
                    member?.display_name ?? null,
                    sourceText,
                  ].filter((m): m is string => Boolean(m));

                  return (
                    <li key={entry.public_id} className={styles.row} data-tone={tone}>
                      <span className={`t-num ${styles.time}`}>{formatTime(entry.joined_at)}</span>
                      <span className={styles.client}>
                        {entry.client_name
                          ? <span className={styles.name}>{entry.client_name}</span>
                          : <span className={`${styles.name} ${styles.anon}`}>Client</span>}
                        {where && <span className={styles.where}>{where}</span>}
                      </span>
                      <span className={`t-num ${styles.meta}`}>
                        {fiche && (
                          <span className={styles.metaFiche}>
                            {fiche.masked && <Immatriculation maskedValue={fiche.masked} width={84} />}
                            {fiche.text && <span className={styles.seg}>{fiche.text}</span>}
                          </span>
                        )}
                        {fiche && meta.length > 0 && '\u00a0· '}
                        {meta.map((m, i) => (
                          <Fragment key={i}>
                            {i > 0 && '\u00a0· '}
                            <span className={styles.seg}>{m}</span>
                          </Fragment>
                        ))}
                      </span>
                      {withFiche && (
                        <span className={`${styles.cell} ${styles.cFiche}`}>
                          <span className={styles.k}>{ficheHead} </span>
                          {fiche ? (
                            <>
                              {fiche.masked && <Immatriculation maskedValue={fiche.masked} width={84} />}
                              {fiche.text && <span className={styles.ficheText}>{fiche.text}</span>}
                            </>
                          ) : '—'}
                        </span>
                      )}
                      <span className={`t-num ${styles.cell}`}>
                        <span className={styles.k}>Attente </span>{waitText}
                      </span>
                      <span className={`t-num ${styles.cell}`}>
                        <span className={styles.k}>Prestation </span>{serviceText}
                      </span>
                      <span className={`${styles.cell} ${styles.cStaff}`}>
                        <span className={styles.k}>Professionnel </span>{member?.display_name ?? '—'}
                      </span>
                      <span className={styles.cell}>
                        <span className={styles.k}>Origine </span>{sourceText}
                      </span>
                      <span className={styles.issue}>
                        <span className={`${styles.chip} chip`} data-tone={tone}>
                          {STAFF_STATUS_LABEL[status] ?? entry.status}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}

      {(pageIndex > 0 || rows.length === PAGE_SIZE) && (
        <nav className={styles.pager} aria-label="Pages">
          {pageIndex > 0 ? (
            <a className="btn btn--ghost btn--sm"
              href={`/app/${org}/historique?filtre=${filter.key}&page=${pageIndex - 1}`}>
              Plus récents
            </a>
          ) : <span />}
          <span className={`t-num ${styles.pageNum}`}>Page {pageIndex + 1}</span>
          {rows.length === PAGE_SIZE ? (
            <a className="btn btn--ghost btn--sm"
              href={`/app/${org}/historique?filtre=${filter.key}&page=${pageIndex + 1}`}>
              Plus anciens
            </a>
          ) : <span />}
        </nav>
      )}
    </div>
  );
}
