'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from 'react';
import { Icon } from '@/components/AppShell';
import { PartySize } from '@/components/objects/PartySize';
import { getProfile } from '@/lib/profiles';
import { PARTY_MAX_LIMIT } from '@/lib/profiles/options';
import { suggestTable, tableKeys, type TableKey } from '@/lib/profiles/table-suggest';
import { defaultTemplates } from '@/lib/profiles/templates';
import type { ProfileQueueSnapshot, ProfileStaffEntry, TableNeed, TableSeating } from '@/lib/profiles/types';
import { addProfileEntryAction, sendTemplateMessage } from '@/server/actions/profile-queue';
import { useNow } from '../QueueBoard';
import { BoardToasts, NoticeBadge, ProfileStatusHeader, StatusNotice, useDisclosure, waitShort } from './BoardChrome';
import { tableCountdown } from './logic';
import { useProfileBoard, type ProfileBoardApi } from './useBoardActions';
import common from './board-common.module.css';
import styles from './table.module.css';

/**
 * LE POSTE DE SALLE — l'hôte d'un restaurant, debout, une tablette à la main.
 *
 * Ce qui décide, c'est la table qui se libère : « Table libre pour 4 ».
 * Une pression met en évidence le groupe à appeler selon une règle
 * TRANSPARENTE (`lib/profiles/table-suggest.ts`) : le premier arrivé qui
 * tient, et, s'il est bien plus petit que la table, un groupe mieux ajusté
 * proposé À CÔTÉ, jamais à sa place. Un second geste confirme : l'ordre
 * n'est jamais sauté sans le choix de l'hôte.
 *
 * Le chiffre qui compte (les couverts) est lu avant le prénom : chaque
 * groupe est un chevalet (`PartySize`). Un groupe appelé passe au cuivre,
 * avec le compte à rebours réel de présentation, puis en brique s'il est
 * dépassé.
 */

interface QueueRef { id: string; name: string; locationName: string; status: string }

interface Props {
  orgSlug: string;
  initialSnapshot: ProfileQueueSnapshot;
  queues: QueueRef[];
  canOperate: boolean;
  canConfigure: boolean;
  actorStaffId?: string | null;
  /** Délai pour se présenter à l'accueil (`absent_grace_minutes`). */
  graceMinutes: number;
}

/**
 * Espace insécable avant « : », « ? » et « ! » (typographie française) :
 * au téléphone, le deux-points ne doit jamais commencer une ligne
 * (« … à une table de 4 / : 4 couverts »).
 */
function frenchSpacing(text: string): string {
  return text.replace(/ ([:?!;])/g, '\u00a0$1');
}

const SEATING_LABEL: Record<TableSeating, string> = { any: 'Peu importe', indoor: 'Salle', terrace: 'Terrasse' };
const NEED_LABEL: Record<TableNeed, string> = { highchair: 'Chaise haute', accessible: 'Accès PMR' };

function partyOf(entry: ProfileStaffEntry): number {
  const n = entry.details?.partySize;
  return typeof n === 'number' && n > 0 ? n : 1;
}

export function TableBoard({ orgSlug, initialSnapshot, queues, canOperate, graceMinutes }: Props) {
  const api = useProfileBoard({ orgSlug, initialSnapshot, canOperate });
  const { snapshot } = api;
  const vocab = getProfile('table').vocab;
  const now = useNow(15_000);
  const [picked, setPicked] = useState<TableKey | null>(null);
  const [adding, setAdding] = useState(false);
  const liveRef = useRef<HTMLDivElement | null>(null);

  const keys = useMemo(() => tableKeys(snapshot.queue.profileOptions?.tableSizes ?? [2, 4, 6, 8]), [snapshot.queue.profileOptions]);
  const waiting = snapshot.waiting;
  const called = snapshot.called;
  const groups = useMemo(
    () => waiting.map((e, i) => ({ id: e.id, partySize: partyOf(e), order: i, entry: e })),
    [waiting],
  );
  const suggestion = picked ? suggestTable(picked, groups) : null;

  // Une nouvelle liste (quelqu'un appelé, installé) rend la suggestion caduque
  // si son groupe n'attend plus.
  useEffect(() => {
    if (!suggestion && picked && groups.length === 0) setPicked(null);
  }, [groups.length, picked, suggestion]);

  const call = useCallback(async (entry: ProfileStaffEntry) => {
    const n = partyOf(entry);
    const result = await api.advance(entry.id, 'call', { notify: true }, {
      subject: `${entry.name ?? 'Groupe'} · ${n}`,
      success: `${entry.name ?? 'Groupe'} appelé`,
    });
    if (result.ok) setPicked(null);
  }, [api]);

  const pickLabel = (k: TableKey) => (k.plus ? `${k.size}+` : String(k.size));

  return (
    <div className={`shell ${styles.board}`}>
      <ProfileStatusHeader
        snapshot={snapshot}
        queues={queues}
        orgSlug={orgSlug}
        canOperate={canOperate}
        pending={api.statusPending}
        onStatus={api.setStatus}
      >
        {canOperate && (
          <div className={common.toolbar}>
            <button
              type="button"
              className={`btn ${adding ? 'btn--ghost' : 'btn--solid'} ${styles.addBtn}`}
              aria-expanded={adding}
              aria-controls="salle-ajout"
              onClick={() => setAdding((v) => !v)}
            >
              <span aria-hidden="true" className={styles.plus}>{adding ? '×' : '+'}</span>
              {adding ? 'Fermer' : 'Ajouter un groupe'}
            </button>
          </div>
        )}
      </ProfileStatusHeader>

      <BoardToasts error={api.error} flash={api.flash} onClose={api.clearError} />
      <StatusNotice
        status={snapshot.queue.status}
        pauseReason={snapshot.queue.pauseReason}
        closedText="Liste fermée : personne ne peut s’inscrire. Les groupes déjà en attente restent affichés."
      />

      {adding && canOperate && (
        <div id="salle-ajout">
          <AddGroup orgSlug={orgSlug} snapshot={snapshot} api={api} onDone={() => setAdding(false)} />
        </div>
      )}

      <div className={styles.columns}>
        <div className={styles.main}>
          {/* ------------------------------------------ Table libre pour */}
          {canOperate && (
            <section className={styles.free} aria-labelledby="table-libre">
              <h2 id="table-libre" className={`t-label ${common.label}`}>Table libre pour</h2>
              <div className={styles.keys} role="group" aria-label="Taille de la table libérée">
                {keys.map((k) => {
                  const on = picked?.size === k.size && picked.plus === k.plus;
                  return (
                    <button
                      key={`${k.size}${k.plus ? '+' : ''}`}
                      type="button"
                      className={styles.freeKey}
                      aria-pressed={on}
                      onClick={() => setPicked(on ? null : k)}
                    >
                      <span className={styles.freeNum}>{pickLabel(k)}</span>
                      <span className={styles.freeUnit}>couverts</span>
                    </button>
                  );
                })}
              </div>

              <div ref={liveRef} aria-live="polite">
                {picked && !suggestion && (
                  <p className={styles.noFit}>
                    Aucun groupe en attente ne tient à cette table.
                  </p>
                )}
                {suggestion && (
                  <div className={styles.suggest}>
                    <p className={styles.reason}>{frenchSpacing(suggestion.reason)}</p>
                    <div className={styles.suggestRow}>
                      <button
                        type="button"
                        className={`btn btn--signal btn--key ${styles.callKey}`}
                        disabled={api.busy === suggestion.primary.id}
                        onClick={() => call(suggestion.primary.entry)}
                      >
                        <span className={styles.callVerb}>Appeler</span>{' '}
                        {suggestion.primary.entry.name ?? 'le groupe'}&nbsp;· {suggestion.primary.partySize}
                      </button>
                      {suggestion.alternative && (
                        <button
                          type="button"
                          className={`btn btn--outline-signal ${styles.altKey}`}
                          disabled={api.busy === suggestion.alternative.id}
                          onClick={() => call(suggestion.alternative!.entry)}
                        >
                          ou {suggestion.alternative.entry.name ?? 'le groupe'}&nbsp;· {suggestion.alternative.partySize}
                          <span className={styles.altHint}>mieux ajusté</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {/* ------------------------------------------ Appelés */}
          {called.length > 0 && (
            <section className={styles.section} aria-labelledby="salle-appeles">
              <h2 id="salle-appeles" className={`t-label ${common.label}`}>
                Appelés <span className={common.count}>{called.length}</span>
              </h2>
              <ul className={styles.calledList}>
                {called.map((entry) => (
                  <CalledRow key={entry.id} entry={entry} api={api} canOperate={canOperate} graceMinutes={graceMinutes} completeLabel={vocab.complete} />
                ))}
              </ul>
            </section>
          )}
        </div>

        <div className={styles.list}>
          {/* ------------------------------------------ En attente */}
          <section className={styles.section} aria-labelledby="salle-attente">
            <h2 id="salle-attente" className={`t-label ${common.label}`}>
              En attente <span className={common.count}>{waiting.length}</span>
            </h2>
            {waiting.length === 0 ? (
              <p className={styles.nobody}>
                Personne n’attend. Les clients s’inscrivent en scannant la plaque à l’entrée.
              </p>
            ) : (
              <ol className={styles.waitList}>
                {waiting.map((entry, i) => (
                  <WaitingGroupRow
                    key={entry.id}
                    entry={entry}
                    position={i + 1}
                    api={api}
                    orgSlug={orgSlug}
                    canOperate={canOperate}
                    now={now}
                    highlight={suggestion?.primary.id === entry.id ? 'primary' : suggestion?.alternative?.id === entry.id ? 'alternative' : null}
                    onCall={call}
                    callLabel={vocab.call}
                  />
                ))}
              </ol>
            )}
          </section>

        {snapshot.parked.length > 0 && (
          <section className={styles.side} aria-labelledby="salle-absents">
            <h2 id="salle-absents" className={`t-label ${common.label}`}>
              Absents <span className={common.count}>{snapshot.parked.length}</span>
            </h2>
            <ul className={styles.parked}>
              {snapshot.parked.map((entry) => (
                <li key={entry.id}>
                  <PartySize count={partyOf(entry)} size="sm" />
                  <span className={styles.parkedName}>{entry.name ?? 'Groupe'}</span>
                  {canOperate && (
                    <button type="button" className="btn btn--ghost btn--sm" disabled={api.busy === entry.id}
                      onClick={() => api.advance(entry.id, 'restore', undefined, { success: `${entry.name ?? 'Groupe'} remis en liste` })}>
                      Remettre
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        </div>
      </div>
    </div>
  );
}

/* ==================================================================
   Un groupe appelé : compte à rebours réel de présentation
   ================================================================== */

function useSecondClock(active: boolean): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function CalledRow({
  entry, api, canOperate, graceMinutes, completeLabel,
}: { entry: ProfileStaffEntry; api: ProfileBoardApi; canOperate: boolean; graceMinutes: number; completeLabel: string }) {
  const now = useSecondClock(true);
  const left = now == null ? null : tableCountdown(entry.calledAt, graceMinutes, now);
  const late = left != null && left < 0;
  const abs = left == null ? 0 : Math.abs(left);
  const mmss = `${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`;
  const busy = api.busy === entry.id;
  const name = entry.name ?? 'Groupe';
  return (
    <li className={styles.calledRow} data-late={late ? '1' : undefined}>
      <PartySize count={partyOf(entry)} state="called" size="md" name={entry.name ?? undefined} />
      <div className={styles.calledWho}>
        <p className={styles.calledName}>{name}</p>
        {/* Un minuteur (role="timer") n'est pas annoncé à chaque seconde ;
            le texte visible se lit tel quel au lecteur d'écran. */}
        <p className={styles.countdown} role="timer">
          {left == null ? ' ' : late ? <>dépassé de <span className="t-num">{mmss}</span></> : <>se présente dans <span className="t-num">{mmss}</span></>}
        </p>
        <NoticeBadge notice={api.notices[entry.id]} timeZone={api.timeZone} />
      </div>
      {canOperate && (
        <div className={styles.calledActions}>
          <button type="button" className={`btn btn--solid ${styles.seat}`} disabled={busy}
            onClick={() => api.advance(entry.id, 'complete', undefined, { success: `${name} installé` })}>
            {busy ? 'Un instant…' : completeLabel}
          </button>
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy}
            onClick={() => api.advance(entry.id, 'recall', undefined, { subject: name })}>
            Rappeler
          </button>
          <button type="button" className="btn btn--ghost btn--sm" disabled={busy}
            onClick={() => api.advance(entry.id, 'mark_absent', undefined, { success: `${name} marqué absent` })}>
            Absent
          </button>
        </div>
      )}
    </li>
  );
}

/* ==================================================================
   Un groupe en attente
   ================================================================== */

function WaitingGroupRow({
  entry, position, api, orgSlug, canOperate, now, highlight, onCall, callLabel,
}: {
  entry: ProfileStaffEntry;
  position: number;
  api: ProfileBoardApi;
  orgSlug: string;
  canOperate: boolean;
  now: number | null;
  highlight: 'primary' | 'alternative' | null;
  onCall: (entry: ProfileStaffEntry) => void;
  callLabel: string;
}) {
  const menu = useDisclosure();
  const [messaging, setMessaging] = useState(false);
  const busy = api.busy === entry.id || api.busy === `msg:${entry.id}`;
  const name = entry.name ?? 'Groupe sans prénom';
  const seating = entry.details?.seating;
  const needs = entry.details?.needs ?? [];
  return (
    <li className={styles.row} data-highlight={highlight ?? undefined}>
      <span className={styles.pos} aria-label={`Position ${position}`}>{String(position).padStart(2, '0')}</span>
      <PartySize count={partyOf(entry)} size="sm" />
      <div className={styles.who}>
        <p className={styles.name}>
          <span className="truncate">{name}</span>
          {highlight && <span className="chip chip--signal">{highlight === 'primary' ? 'Proposé' : 'Mieux ajusté'}</span>}
        </p>
        <p className={styles.meta}>
          {seating && seating !== 'any' && <span className="chip">{SEATING_LABEL[seating]}</span>}
          {needs.map((n) => <span key={n} className="chip chip--copper">{NEED_LABEL[n]}</span>)}
          <span className={styles.waitFor}>{now == null ? '' : `${waitShort(entry.joinedAt, now)} d’attente`}</span>
        </p>
        <NoticeBadge notice={api.notices[entry.id]} timeZone={api.timeZone} />
      </div>
      {canOperate && (
        <div className={styles.rowActions}>
          <button type="button" className={`btn btn--ghost btn--sm ${styles.callBtn}`} disabled={busy} onClick={() => onCall(entry)}>
            {callLabel}
          </button>
          <button
            ref={menu.buttonRef}
            type="button"
            className={common.moreBtn}
            aria-expanded={menu.open}
            aria-controls={`menu-${entry.id}`}
            aria-label={`Plus d’actions pour ${name}`}
            onClick={() => menu.setOpen((v) => !v)}
          >
            <Icon name="more" />
          </button>
        </div>
      )}
      {menu.open && (
        <div ref={menu.panelRef} id={`menu-${entry.id}`} className={`${common.menu} ${styles.rowMenu}`}>
          <button type="button" onClick={() => { menu.setOpen(false); void api.advance(entry.id, 'defer', { by: 2 }, { success: `${name} décalé de 2 places` }); }}>
            Décaler +2
          </button>
          <button type="button" onClick={() => { menu.setOpen(false); setMessaging(true); }}>Envoyer un message</button>
          <button type="button" className={common.danger}
            onClick={() => { menu.setOpen(false); void api.advance(entry.id, 'remove', undefined, { success: `${name} retiré de la liste` }); }}>
            Retirer
          </button>
        </div>
      )}
      {messaging && (
        <div className={`${common.inline} ${styles.rowMenu}`} style={{ ['--tone' as string]: 'var(--ardoise-500)' }}>
          <p className={common.inlineTitle}>Message en un geste</p>
          <div className={common.chips}>
            {defaultTemplates('table').map((t) => (
              <button key={t.key} type="button" className={common.chipBtn} disabled={busy}
                onClick={async () => {
                  const r = await api.run(`msg:${entry.id}`, () => sendTemplateMessage(orgSlug, { entryId: entry.id, templateKey: t.key }));
                  if (r.ok) {
                    api.recordNotice(entry.id, r.data.notice, name);
                    if (!r.data.notice) api.say('Message envoyé');
                    setMessaging(false);
                  }
                }}>
                {t.label}
              </button>
            ))}
          </div>
          <div className={common.inlineRow}>
            <button type="button" className="btn btn--quiet btn--sm" onClick={() => setMessaging(false)}>Annuler</button>
          </div>
        </div>
      )}
    </li>
  );
}

/* ==================================================================
   Ajouter un groupe à l'accueil
   ================================================================== */

function AddGroup({
  orgSlug, snapshot, api, onDone,
}: { orgSlug: string; snapshot: ProfileQueueSnapshot; api: ProfileBoardApi; onDone: () => void }) {
  const [name, setName] = useState('');
  const [party, setParty] = useState(2);
  const [seating, setSeating] = useState<TableSeating>('any');
  const [needs, setNeeds] = useState<TableNeed[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) { setError('Indiquez un prénom : l’accueil appelle les noms.'); return; }
    setError(null);
    startTransition(async () => {
      const result = await api.run('add', () => addProfileEntryAction(orgSlug, {
        queueId: snapshot.queue.id,
        name: name.trim(),
        details: { partySize: party, seating, ...(needs.length ? { needs } : {}) },
      }));
      if (!result.ok) { setError(result.error); return; }
      api.say(`${name.trim()} · ${party} ajouté à la liste`);
      setName(''); setParty(2); setSeating('any'); setNeeds([]);
    });
  };

  return (
    <form className={common.addPanel} onSubmit={submit} aria-labelledby={`${id}-t`} noValidate>
      <div className={common.addHead}>
        <h2 id={`${id}-t`} className={common.addTitle}>Un groupe à l’accueil</h2>
        <button type="button" className="btn btn--quiet btn--sm" onClick={onDone}>Fermer</button>
      </div>
      <div className={styles.addGrid}>
        <div className={styles.stepper} role="group" aria-labelledby={`${id}-n`}>
          <span id={`${id}-n`} className={styles.fieldLabel}>Couverts</span>
          <div className={styles.stepperRow}>
            <button type="button" className={styles.stepBtn} aria-label="Un couvert de moins" disabled={party <= 1} onClick={() => setParty((n) => Math.max(1, n - 1))}>−</button>
            <PartySize count={party} size="md" />
            <button type="button" className={styles.stepBtn} aria-label="Un couvert de plus" disabled={party >= PARTY_MAX_LIMIT} onClick={() => setParty((n) => Math.min(PARTY_MAX_LIMIT, n + 1))}>+</button>
          </div>
          <span className="sr-only" aria-live="polite">{party} couvert{party > 1 ? 's' : ''}</span>
        </div>
        <div className={styles.addFields}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Prénom</span>
            <input className="input" maxLength={40} autoComplete="off" autoFocus placeholder="Karim" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className={styles.field}>
            <span className={styles.fieldLabel} id={`${id}-s`}>Préférence</span>
            <div className={common.chips} role="radiogroup" aria-labelledby={`${id}-s`}>
              {(Object.keys(SEATING_LABEL) as TableSeating[]).map((s) => (
                <button key={s} type="button" role="radio" aria-checked={seating === s} className={common.chipBtn} onClick={() => setSeating(s)}>
                  {SEATING_LABEL[s]}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.field}>
            <span className={styles.fieldLabel} id={`${id}-b`}>Besoins</span>
            <div className={common.chips} role="group" aria-labelledby={`${id}-b`}>
              {(Object.keys(NEED_LABEL) as TableNeed[]).map((n) => (
                <button key={n} type="button" aria-pressed={needs.includes(n)} className={common.chipBtn}
                  onClick={() => setNeeds((list) => (list.includes(n) ? list.filter((x) => x !== n) : [...list, n]))}>
                  {NEED_LABEL[n]}
                </button>
              ))}
            </div>
          </div>
          <p className="hint">Les allergies se disent au serveur, de vive voix : elles ne sont jamais enregistrées.</p>
        </div>
      </div>
      {error && <p className={common.formError} role="alert">{error}</p>}
      <div className={common.addActions}>
        <button type="submit" className="btn btn--solid" disabled={pending}>{pending ? 'Ajout…' : 'Ajouter à la liste'}</button>
      </div>
    </form>
  );
}
