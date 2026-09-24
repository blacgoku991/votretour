'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState, useTransition } from 'react';
import { Icon } from '@/components/AppShell';
import { TicketNumber } from '@/components/objects/TicketNumber';
import { TicketNumberFlap } from '@/components/objects/TicketNumberFlap';
import { getProfile } from '@/lib/profiles';
import type { ProfileQueueSnapshot, ProfileStaffEntry } from '@/lib/profiles/types';
import { addProfileEntryAction, callNextAtDesk } from '@/server/actions/profile-queue';
import { useNow } from '../QueueBoard';
import { BoardToasts, NoticeBadge, ProfileStatusHeader, StatusNotice, useDisclosure, waitShort } from './BoardChrome';
import {
  currentCallAt,
  deskDisplayName,
  desksOf,
  isRetailPickup,
  resolveDesk,
  shortRef,
  type DeskRef,
} from './logic';
import { useProfileBoard, type ProfileBoardApi } from './useBoardActions';
import common from './board-common.module.css';
import styles from './desk.module.css';

/**
 * LE POSTE DE GUICHET — et sa variante « comptoir » pour les boutiques.
 *
 * Guichet (comptoir, service administratif, santé) : un numéro, un
 * guichet. Le pro choisit SON guichet en tête du poste (par défaut la
 * fiche liée à son compte ; sinon son choix est mémorisé sur l'appareil,
 * l'autorisation restant côté serveur). Une grosse touche « Appeler le
 * suivant » fait tomber le volet sur le numéro suivant ; « Terminer »
 * appelle automatiquement le suivant au même guichet. On appelle un
 * NUMÉRO : en santé (`sensitive`), aucun prénom n'est jamais affiché,
 * même si la base en a un.
 *
 * Boutique : pas de guichet. Le conseil suit la file (« Appeler le
 * suivant ») ; les retraits de commande avancent à part, dans le
 * désordre : « Préparer », puis « Commande prête » (le client est
 * prévenu), puis « Remise faite ».
 */

interface QueueRef { id: string; name: string; locationName: string; status: string }

interface Props {
  orgSlug: string;
  initialSnapshot: ProfileQueueSnapshot;
  queues: QueueRef[];
  canOperate: boolean;
  canConfigure: boolean;
  actorStaffId?: string | null;
}

function readStored(key: string): string | null {
  try { return window.localStorage.getItem(key); } catch { return null; }
}
function writeStored(key: string, value: string | null): void {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch { /* confort seulement */ }
}

/** « A-042 » ; sans numérotation, une référence courte (jamais le prénom). */
function ticketOf(entry: ProfileStaffEntry): string {
  return entry.ticketNo ?? shortRef(entry.id);
}

export function DeskBoard(props: Props) {
  const api = useProfileBoard({ orgSlug: props.orgSlug, initialSnapshot: props.initialSnapshot, canOperate: props.canOperate });
  const { snapshot } = api;
  const retail = snapshot.queue.profile === 'retail';

  return (
    <div className={`shell ${styles.board}`} data-profile={snapshot.queue.profile}>
      {retail ? <RetailCounter {...props} api={api} /> : <DeskStation {...props} api={api} />}
    </div>
  );
}

/* ==================================================================
   GUICHET
   ================================================================== */

function DeskStation({ orgSlug, queues, canOperate, actorStaffId = null, api }: Props & { api: ProfileBoardApi }) {
  const { snapshot } = api;
  const options = snapshot.queue.profileOptions ?? {};
  const sensitive = options.sensitive === true;
  const vocab = getProfile('desk').vocab;
  const now = useNow(15_000);
  const desks = useMemo(() => desksOf(snapshot), [snapshot]);
  const storeKey = `rangvia:guichet:${snapshot.queue.id}`;
  const [desk, setDesk] = useState<string | null>(null);
  const [giving, setGiving] = useState(false);
  const selectRef = useRef<HTMLSelectElement | null>(null);
  const deskSelectId = useId();

  // Le guichet mémorisé est relu après le montage (jamais au rendu
  // serveur), et abandonné s'il n'existe plus.
  useEffect(() => {
    setDesk(resolveDesk(desks, readStored(storeKey), actorStaffId));
  }, [desks, storeKey, actorStaffId]);

  const chooseDesk = (id: string | null) => {
    setDesk(id);
    writeStored(storeKey, id);
  };

  const mine = desks.find((d) => d.id === desk) ?? null;
  const current = currentCallAt(snapshot, desk);
  const busyCall = api.busy === 'call-next';
  const waiting = snapshot.waiting;
  const serviceName = useCallback((id: string | null) => snapshot.services.find((s) => s.id === id)?.name ?? null, [snapshot.services]);

  const callNext = async () => {
    if (!desk) {
      selectRef.current?.focus();
      api.say('Choisissez d’abord votre guichet.', 'warn');
      return;
    }
    const result = await api.run('call-next', () => callNextAtDesk(orgSlug, { queueId: snapshot.queue.id, deskStaffId: desk }));
    if (!result.ok) {
      // Guichet supprimé ou renommé entre-temps : on l'oublie, et le pro
      // en choisit un autre dans la liste relue.
      if (result.code === 'invalid_desk') {
        chooseDesk(null);
        await api.refresh();
        // La liste est déjà relue : inutile de dire « rechargez la page ».
        api.setError({ message: 'Ce guichet n’existe plus. Vérifiez « Mon guichet » avant d’appeler.', code: result.code });
        selectRef.current?.focus();
      }
      return;
    }
    if (!result.data.calledId) api.say('Personne n’attend pour le moment.', 'muted');
  };

  return (
    <>
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
            <label className={styles.deskPick} htmlFor={deskSelectId}>
              <span className={styles.deskPickLabel}>Mon guichet</span>
              <select
                ref={selectRef}
                id={deskSelectId}
                className="select"
                value={desk ?? ''}
                onChange={(e) => chooseDesk(e.target.value || null)}
              >
                <option value="">Choisir…</option>
                {desks.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
              </select>
            </label>
            <button type="button" className={`btn ${giving ? 'btn--ghost' : 'btn--solid'} ${styles.giveBtn}`}
              aria-expanded={giving} aria-controls="guichet-ticket" onClick={() => setGiving((v) => !v)}>
              <span aria-hidden="true" className={styles.plus}>{giving ? '×' : '+'}</span>
              {giving ? 'Fermer' : 'Donner un ticket'}
            </button>
          </div>
        )}
      </ProfileStatusHeader>

      <BoardToasts error={api.error} flash={api.flash} onClose={api.clearError} />
      <StatusNotice
        status={snapshot.queue.status}
        pauseReason={snapshot.queue.pauseReason}
        closedText="Guichets fermés : plus personne ne peut prendre de ticket."
      />

      {giving && canOperate && (
        <div id="guichet-ticket">
          <GiveTicket orgSlug={orgSlug} snapshot={snapshot} api={api} onDone={() => setGiving(false)} />
        </div>
      )}

      <div className={styles.columns}>
        <div className={styles.main}>
          {/* ---------------------------------------- Mon guichet */}
          <section className={styles.station} data-state={current ? current.status : 'free'} aria-labelledby="mon-guichet">
            <div className={styles.stationHead}>
              <h2 id="mon-guichet" className={styles.deskName}>{mine?.label ?? 'Aucun guichet choisi'}</h2>
              <p className={styles.stationState}>
                {!mine ? 'Choisissez votre guichet pour appeler.'
                  : !current ? 'Libre'
                  : current.status === 'serving' ? `En cours depuis ${now == null ? '…' : waitShort(current.serviceStartedAt, now)}`
                  : `Appelé il y a ${now == null ? '…' : waitShort(current.calledAt, now)}`}
              </p>
            </div>

            <div className={styles.board3}>
              {current ? (
                <TicketNumberFlap value={ticketOf(current)} size="clamp(3.25rem, 2rem + 6vw, 5.5rem)" live />
              ) : (
                // Guichet libre : les cases du tableau, vides, attendent le numéro.
                <span className={styles.idleNumber} aria-hidden="true">
                  <span /><span className={styles.idleDash} /><span /><span /><span />
                </span>
              )}
              {current && (
                <p className={styles.callMeta}>
                  {serviceName(current.serviceId) && <span className="chip">{serviceName(current.serviceId)}</span>}
                  {deskDisplayName(current, options) && <span className={styles.callName}>{deskDisplayName(current, options)}</span>}
                </p>
              )}
              {current && <NoticeBadge notice={api.notices[current.id]} timeZone={api.timeZone} />}
            </div>

            {canOperate && (
              <div className={styles.stationActions}>
                {current ? (
                  <>
                    <button type="button" className={`btn btn--solid ${styles.finish}`} disabled={api.busy === current.id}
                      onClick={() => api.advance(current.id, 'complete', undefined, { success: `${ticketOf(current)} terminé` })}>
                      {api.busy === current.id ? 'Un instant…' : vocab.complete}
                    </button>
                    <div className={styles.stationMinor}>
                      {current.status === 'next' && (
                        <button type="button" className="btn btn--ghost btn--sm" disabled={api.busy === current.id}
                          onClick={() => api.advance(current.id, 'start_serving', undefined, { success: `${ticketOf(current)} au guichet` })}>
                          {vocab.start}
                        </button>
                      )}
                      <button type="button" className="btn btn--ghost btn--sm" disabled={api.busy === current.id || current.status !== 'next'}
                        onClick={() => api.advance(current.id, 'recall', undefined, { subject: ticketOf(current) })}>
                        Rappeler
                      </button>
                      <button type="button" className="btn btn--ghost btn--sm" disabled={api.busy === current.id}
                        onClick={() => api.advance(current.id, 'mark_absent', undefined, { success: `${ticketOf(current)} absent` })}>
                        Absent
                      </button>
                    </div>
                    {snapshot.queue.advanceMode === 'call_next' && waiting.length > 0 && (
                      <p className={styles.autoHint}>« {vocab.complete} » appelle aussitôt le numéro suivant à ce guichet.</p>
                    )}
                  </>
                ) : (
                  <button type="button" className={`btn btn--signal btn--key ${styles.callKey}`}
                    disabled={busyCall || waiting.length === 0}
                    aria-busy={busyCall || undefined}
                    onClick={callNext}>
                    {busyCall ? 'Un instant…' : waiting.length === 0 ? 'Personne n’attend' : 'Appeler le suivant'}
                  </button>
                )}
              </div>
            )}
          </section>

          {/* ---------------------------------------- Autres guichets */}
          {desks.length > 1 && (
            <section className={styles.others} aria-labelledby="autres-guichets">
              <h2 id="autres-guichets" className={`t-label ${common.label}`}>Autres guichets</h2>
              <ul className={styles.otherList}>
                {desks.filter((d) => d.id !== desk).map((d) => <OtherDesk key={d.id} desk={d} snapshot={snapshot} />)}
              </ul>
            </section>
          )}
        </div>

        {/* ---------------------------------------- File d'attente */}
        <section className={styles.queue} aria-labelledby="guichet-attente">
          <h2 id="guichet-attente" className={`t-label ${common.label}`}>
            En attente <span className={common.count}>{waiting.length}</span>
          </h2>
          {waiting.length === 0 ? (
            <p className={styles.nobody}>Personne n’attend. Les tickets se prennent en scannant la plaque de l’accueil.</p>
          ) : (
            <ol className={styles.waitList}>
              {waiting.map((entry, i) => (
                <DeskWaitingRow
                  key={entry.id}
                  entry={entry}
                  position={i + 1}
                  motif={serviceName(entry.serviceId)}
                  name={deskDisplayName(entry, options)}
                  now={now}
                  api={api}
                  canOperate={canOperate}
                  desk={mine}
                  deskBusy={!!current}
                />
              ))}
            </ol>
          )}
          {sensitive && (
            <p className={styles.privacy}>
              Accueil de patients : aucun prénom n’est affiché, ici comme sur l’écran de la salle.
            </p>
          )}
        </section>
      </div>
    </>
  );
}

function OtherDesk({ desk, snapshot }: { desk: DeskRef; snapshot: ProfileQueueSnapshot }) {
  const call = currentCallAt(snapshot, desk.id);
  return (
    <li className={styles.other} data-state={call ? call.status : 'free'}>
      <span className={styles.otherName}>{desk.label}</span>
      {call ? (
        <span className={styles.otherTicket}>
          <TicketNumber value={ticketOf(call)} size="1.125rem" />
          <span className={styles.otherState}>{call.status === 'serving' ? 'en cours' : 'appelé'}</span>
        </span>
      ) : (
        <span className={styles.otherState}>libre</span>
      )}
    </li>
  );
}

function DeskWaitingRow({
  entry, position, motif, name, now, api, canOperate, desk, deskBusy,
}: {
  entry: ProfileStaffEntry;
  position: number;
  motif: string | null;
  name: string | null;
  now: number | null;
  api: ProfileBoardApi;
  canOperate: boolean;
  desk: DeskRef | null;
  deskBusy: boolean;
}) {
  const menu = useDisclosure();
  const t = ticketOf(entry);
  const busy = api.busy === entry.id;
  return (
    <li className={styles.row}>
      <span className={styles.pos} aria-label={`Position ${position}`}>{String(position).padStart(2, '0')}</span>
      <TicketNumber value={t} size="1.375rem" />
      <div className={styles.who}>
        <p className={styles.rowMain}>
          {motif ? <span className={styles.motif}>{motif}</span> : <span className={styles.motif}>Sans motif</span>}
          {name && <span className={styles.rowName}>· {name}</span>}
        </p>
        <p className={styles.rowMeta}>{now == null ? ' ' : `${waitShort(entry.joinedAt, now)} d’attente`}</p>
      </div>
      {canOperate && (
        <button
          ref={menu.buttonRef}
          type="button"
          className={common.moreBtn}
          aria-expanded={menu.open}
          aria-controls={`menu-${entry.id}`}
          aria-label={`Plus d’actions pour le ticket ${t}`}
          onClick={() => menu.setOpen((v) => !v)}
        >
          <Icon name="more" />
        </button>
      )}
      {menu.open && (
        <div ref={menu.panelRef} id={`menu-${entry.id}`} className={`${common.menu} ${styles.rowMenu}`}>
          {desk && (
            <button type="button" disabled={busy || deskBusy}
              title={deskBusy ? 'Votre guichet a déjà un appel en cours' : undefined}
              onClick={() => { menu.setOpen(false); void api.advance(entry.id, 'call', { notify: true, staffId: desk.id }, { subject: t }); }}>
              Appeler à {desk.label.toLowerCase().startsWith('guichet') ? 'mon guichet' : desk.label}
            </button>
          )}
          <button type="button" onClick={() => { menu.setOpen(false); void api.advance(entry.id, 'defer', { by: 2 }, { success: `${t} décalé de 2 places` }); }}>
            Décaler +2
          </button>
          <button type="button" className={common.danger}
            onClick={() => { menu.setOpen(false); void api.advance(entry.id, 'remove', undefined, { success: `${t} retiré` }); }}>
            Retirer
          </button>
        </div>
      )}
    </li>
  );
}

/** Un ticket donné au comptoir, pour une personne sans téléphone : son numéro, en grand. */
function GiveTicket({ orgSlug, snapshot, api, onDone }: { orgSlug: string; snapshot: ProfileQueueSnapshot; api: ProfileBoardApi; onDone: () => void }) {
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [given, setGiven] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();
  const give = () => {
    setError(null);
    startTransition(async () => {
      const result = await api.run('give', () => addProfileEntryAction(orgSlug, { queueId: snapshot.queue.id, serviceId, details: {} }));
      if (!result.ok) { setError(result.error); return; }
      const t = ticketOf(result.data.entry);
      setGiven(t);
      api.say(`Ticket ${t} donné`);
    });
  };
  return (
    <section className={common.addPanel} aria-labelledby={`${id}-t`}>
      <div className={common.addHead}>
        <h2 id={`${id}-t`} className={common.addTitle}>Donner un ticket</h2>
        <button type="button" className="btn btn--quiet btn--sm" onClick={onDone}>Fermer</button>
      </div>
      {given ? (
        <div className={styles.given}>
          <TicketNumber value={given} size="3.5rem" />
          <p className="t-small t-muted">Annoncez ce numéro à la personne : il sera appelé sur l’écran de la salle.</p>
          <button type="button" className="btn btn--solid btn--sm" onClick={() => setGiven(null)}>Un autre ticket</button>
        </div>
      ) : (
        <>
          {snapshot.services.length > 0 && (
            <div className={common.chips} role="radiogroup" aria-label="Motif">
              {snapshot.services.map((s) => (
                <button key={s.id} type="button" role="radio" aria-checked={serviceId === s.id} className={common.chipBtn}
                  onClick={() => setServiceId((v) => (v === s.id ? null : s.id))}>
                  {s.name}
                </button>
              ))}
            </div>
          )}
          {error && <p className={common.formError} role="alert">{error}</p>}
          <div className={common.addActions}>
            <button type="button" className="btn btn--solid" disabled={pending} onClick={give}>{pending ? 'Un instant…' : 'Donner le ticket'}</button>
          </div>
        </>
      )}
    </section>
  );
}

/* ==================================================================
   BOUTIQUE : conseil dans l'ordre, retraits dans le désordre
   ================================================================== */

function RetailCounter({ orgSlug, queues, canOperate, api }: Props & { api: ProfileBoardApi }) {
  const { snapshot } = api;
  const vocab = getProfile('retail').vocab;
  const now = useNow(15_000);
  const [adding, setAdding] = useState(false);
  const services = snapshot.services;
  const pickup = (e: ProfileStaffEntry) => isRetailPickup(e, services);

  const all = [...snapshot.called, ...snapshot.serving, ...snapshot.waiting];
  const orders = all.filter(pickup);
  const toPrepare = orders.filter((e) => !e.stage);
  const preparing = orders.filter((e) => e.stage === 'preparing');
  const ready = orders.filter((e) => e.stage === 'ready' || (!!e.stage && e.status === 'next'));
  const advice = all.filter((e) => !pickup(e));
  const atCounter = advice.filter((e) => e.status === 'next' || e.status === 'serving');
  const adviceWaiting = snapshot.waiting.filter((e) => !pickup(e));
  const nextUp = adviceWaiting[0] ?? null;

  const callNext = async () => {
    if (!nextUp) return;
    await api.advance(nextUp.id, 'call', { notify: true }, { subject: nextUp.name ?? 'Client' });
  };

  return (
    <>
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
            <button type="button" className={`btn ${adding ? 'btn--ghost' : 'btn--solid'} ${styles.giveBtn}`}
              aria-expanded={adding} aria-controls="boutique-ajout" onClick={() => setAdding((v) => !v)}>
              <span aria-hidden="true" className={styles.plus}>{adding ? '×' : '+'}</span>
              {adding ? 'Fermer' : 'Ajouter un client'}
            </button>
          </div>
        )}
      </ProfileStatusHeader>

      <BoardToasts error={api.error} flash={api.flash} onClose={api.clearError} />
      <StatusNotice status={snapshot.queue.status} pauseReason={snapshot.queue.pauseReason} closedText="File fermée : plus personne ne peut s’inscrire." />

      {adding && canOperate && (
        <div id="boutique-ajout">
          <AddRetail orgSlug={orgSlug} snapshot={snapshot} api={api} onDone={() => setAdding(false)} />
        </div>
      )}

      <div className={styles.retailCols}>
        {/* ---------------------------------------- Conseil */}
        <section className={styles.advice} aria-labelledby="boutique-conseil">
          <h2 id="boutique-conseil" className={`t-label ${common.label}`}>
            Conseil <span className={common.count}>{adviceWaiting.length}</span>
          </h2>
          {canOperate && (
            <button type="button" className={`btn btn--signal btn--key ${styles.callKey}`}
              disabled={!nextUp || api.busy === nextUp.id} onClick={callNext}>
              {nextUp ? `Appeler ${nextUp.name ?? 'le suivant'}` : 'Personne n’attend'}
            </button>
          )}
          {atCounter.length > 0 && (
            <ul className={styles.counterList}>
              {atCounter.map((e) => (
                <li key={e.id} className={styles.atCounter}>
                  <div className={styles.who}>
                    <p className={styles.rowMain}><span className={styles.motif}>{e.name ?? 'Client'}</span></p>
                    <p className={styles.rowMeta}>{e.status === 'serving' ? 'avec un vendeur' : 'appelé à la caisse'}</p>
                    <NoticeBadge notice={api.notices[e.id]} timeZone={api.timeZone} />
                  </div>
                  {canOperate && (
                    <div className={styles.inlineActions}>
                      {e.status === 'next' && (
                        <button type="button" className="btn btn--ghost btn--sm" disabled={api.busy === e.id}
                          onClick={() => api.advance(e.id, 'start_serving', undefined, { success: `${e.name ?? 'Client'} avec un vendeur` })}>
                          {vocab.start}
                        </button>
                      )}
                      <button type="button" className="btn btn--solid btn--sm" disabled={api.busy === e.id}
                        onClick={() => api.advance(e.id, 'complete', undefined, { success: `${e.name ?? 'Client'} servi` })}>
                        Terminer
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {adviceWaiting.length === 0 ? (
            <p className={styles.nobody}>Personne n’attend un conseil.</p>
          ) : (
            <ol className={styles.waitList}>
              {adviceWaiting.map((e, i) => (
                <li key={e.id} className={styles.row} data-kind="advice">
                  <span className={styles.pos} aria-label={`Position ${i + 1}`}>{String(i + 1).padStart(2, '0')}</span>
                  <div className={styles.who}>
                    <p className={styles.rowMain}><span className={styles.motif}>{e.name ?? 'Client sans prénom'}</span></p>
                    <p className={styles.rowMeta}>{now == null ? ' ' : `${waitShort(e.joinedAt, now)} d’attente`}</p>
                  </div>
                  {canOperate && (
                    <button type="button" className="btn btn--quiet btn--sm" disabled={api.busy === e.id}
                      onClick={() => api.advance(e.id, 'remove', undefined, { success: `${e.name ?? 'Client'} retiré` })}>
                      Retirer
                    </button>
                  )}
                </li>
              ))}
            </ol>
          )}
        </section>

        {/* ---------------------------------------- Retraits */}
        <section className={styles.orders} aria-labelledby="boutique-commandes">
          <h2 id="boutique-commandes" className={`t-label ${common.label}`}>
            Retraits de commande <span className={common.count}>{orders.length}</span>
          </h2>
          {orders.length === 0 && <p className={styles.nobody}>Aucune commande à préparer.</p>}
          <OrderGroup title="Prêtes" tone="ready" list={ready} api={api} canOperate={canOperate} now={now} vocabComplete={vocab.complete} vocabCall={vocab.call} />
          <OrderGroup title="En préparation" tone="preparing" list={preparing} api={api} canOperate={canOperate} now={now} vocabComplete={vocab.complete} vocabCall={vocab.call} />
          <OrderGroup title="À préparer" tone="todo" list={toPrepare} api={api} canOperate={canOperate} now={now} vocabComplete={vocab.complete} vocabCall={vocab.call} />
        </section>
      </div>
    </>
  );
}

function OrderGroup({
  title, tone, list, api, canOperate, now, vocabComplete, vocabCall,
}: {
  title: string;
  tone: 'ready' | 'preparing' | 'todo';
  list: ProfileStaffEntry[];
  api: ProfileBoardApi;
  canOperate: boolean;
  now: number | null;
  vocabComplete: string;
  vocabCall: string;
}) {
  if (list.length === 0) return null;
  return (
    <div className={styles.orderGroup} data-tone={tone}>
      <p className={styles.orderGroupTitle}>{title}</p>
      <ul className={styles.orderList}>
        {list.map((e) => {
          const ref = e.details?.orderRef ?? null;
          const who = e.name ?? 'Client';
          const busy = api.busy === e.id;
          return (
            <li key={e.id} className={styles.order} data-tone={tone}>
              <span className={styles.bagEyelet} aria-hidden="true" />
              <div className={styles.orderMain}>
                <p className={styles.orderRef}>{ref ? <>n°&nbsp;{ref}</> : 'Sans numéro'}</p>
                <p className={styles.rowMeta}>
                  {who}
                  {now != null && ` · ${tone === 'ready' ? `prête depuis ${waitShort(e.stageChangedAt ?? e.calledAt, now)}` : `${waitShort(e.joinedAt, now)} d’attente`}`}
                </p>
                <NoticeBadge notice={api.notices[e.id]} timeZone={api.timeZone} silenced={tone === 'ready' && e.notified?.your_turn === 'silenced'} />
              </div>
              {canOperate && (
                <div className={styles.inlineActions}>
                  {tone === 'todo' && (
                    <button type="button" className="btn btn--ghost btn--sm" disabled={busy}
                      onClick={() => api.advance(e.id, 'set_stage', { stage: 'preparing', notify: false }, { success: `Commande ${ref ?? ''} en préparation`.replace('  ', ' ') })}>
                      Préparer
                    </button>
                  )}
                  {(tone === 'todo' || tone === 'preparing') && (
                    <button type="button" className={`btn btn--outline-signal btn--sm ${styles.readyBtn}`} disabled={busy}
                      onClick={() => api.advance(e.id, 'set_stage', { stage: 'ready', notify: true }, { subject: ref ? `Commande ${ref}` : who })}>
                      {vocabCall}
                    </button>
                  )}
                  {tone === 'ready' && (
                    <>
                      <button type="button" className="btn btn--ghost btn--sm" disabled={busy}
                        onClick={() => api.advance(e.id, 'recall', undefined, { subject: ref ? `Commande ${ref}` : who })}>
                        Rappeler
                      </button>
                      <button type="button" className="btn btn--solid btn--sm" disabled={busy}
                        onClick={() => api.advance(e.id, 'complete', undefined, { success: `${vocabComplete} · ${ref ?? who}` })}>
                        {vocabComplete}
                      </button>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function AddRetail({ orgSlug, snapshot, api, onDone }: { orgSlug: string; snapshot: ProfileQueueSnapshot; api: ProfileBoardApi; onDone: () => void }) {
  const [name, setName] = useState('');
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [orderRef, setOrderRef] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();
  const pickupService = snapshot.services.find((s) => s.id === serviceId && /commande/i.test(s.name));
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await api.run('add', () => addProfileEntryAction(orgSlug, {
        queueId: snapshot.queue.id,
        name: name.trim() || null,
        serviceId,
        details: orderRef.trim() ? { orderRef: orderRef.trim() } : {},
      }));
      if (!result.ok) { setError(result.error); return; }
      api.say(`${name.trim() || 'Client'} ajouté`);
      setName(''); setOrderRef('');
    });
  };
  return (
    <form className={common.addPanel} onSubmit={submit} aria-labelledby={`${id}-t`} noValidate>
      <div className={common.addHead}>
        <h2 id={`${id}-t`} className={common.addTitle}>Un client à la caisse</h2>
        <button type="button" className="btn btn--quiet btn--sm" onClick={onDone}>Fermer</button>
      </div>
      <div className={common.grid}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Prénom <span className={common.muted}>(facultatif)</span></span>
          <input className="input" maxLength={40} autoComplete="off" autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {(pickupService || orderRef) && (
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Numéro de commande</span>
            <input className="input" maxLength={24} autoComplete="off" value={orderRef} onChange={(e) => setOrderRef(e.target.value.toUpperCase())} />
          </label>
        )}
        {snapshot.services.length > 0 && (
          <div className={`${styles.field} ${common.full}`}>
            <span className={styles.fieldLabel} id={`${id}-m`}>Motif</span>
            <div className={common.chips} role="radiogroup" aria-labelledby={`${id}-m`}>
              {snapshot.services.map((s) => (
                <button key={s.id} type="button" role="radio" aria-checked={serviceId === s.id} className={common.chipBtn}
                  onClick={() => setServiceId((v) => (v === s.id ? null : s.id))}>
                  {s.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      {error && <p className={common.formError} role="alert">{error}</p>}
      <div className={common.addActions}>
        <button type="submit" className="btn btn--solid" disabled={pending}>{pending ? 'Ajout…' : 'Ajouter'}</button>
      </div>
    </form>
  );
}
