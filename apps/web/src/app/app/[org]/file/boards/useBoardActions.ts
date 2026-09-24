'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/browser';
import { changeQueueStatus } from '@/server/actions/queue';
import {
  advanceProfileEntry,
  fetchProfileQueueSnapshot,
  type ActionResult,
  type SentNotice,
} from '@/server/actions/profile-queue';
import type { StaffAction } from '@/server/queue';
import type { ProfileStaffAction } from '@/server/profiles/queue';
import type { ProfileQueueSnapshot } from '@/lib/profiles/types';
import type { QueueStatus } from '@/lib/types';
import { noticeLabel, type Reach } from './logic';

/**
 * LA MÉCANIQUE COMMUNE DES POSTES À PROFIL — temps réel, actions, retours.
 *
 * C'est la logique `act` / flash / erreur de `QueueBoard`, DUPLIQUÉE ici
 * plutôt que partagée : le fichier des barbiers ne reçoit que des
 * `export`, et son comportement reste octet pour octet celui
 * d'aujourd'hui. Trois différences, propres aux profils :
 *
 *  1. l'instantané vient de `fetchProfileQueueSnapshot`, qui appelle
 *     `queue_snapshot` avec `p_include_details` (immatriculation, devis) ;
 *  2. chaque action rapporte l'état RÉEL de l'envoi (`SentNotice`), gardé
 *     par fiche pour que le poste l'affiche (« Prévenu 14:32 ✓ »,
 *     « Non joignable », « Envoi indisponible ») ;
 *  3. les annonces passent par une région `aria-live` : le pro qui
 *     travaille au clavier ou au lecteur d'écran entend ce qui s'est passé.
 */

export type AnyStaffAction = ProfileStaffAction | StaffAction;

export interface BoardError {
  message: string;
  code: string;
}

/** Ce que le poste sait d'un envoi, et quand il l'a appris. */
export interface EntryNotice extends SentNotice {
  at: number;
}

interface Options {
  orgSlug: string;
  initialSnapshot: ProfileQueueSnapshot;
  canOperate: boolean;
}

export function useProfileBoard({ orgSlug, initialSnapshot, canOperate }: Options) {
  const router = useRouter();
  const [snapshot, setSnapshotState] = useState<ProfileQueueSnapshot>(initialSnapshot);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<BoardError | null>(null);
  const [flash, setFlash] = useState<{ text: string; tone: 'ok' | 'warn' | 'error' | 'muted' } | null>(null);
  const [notices, setNotices] = useState<Record<string, EntryNotice>>({});
  const [statusPending, startStatus] = useTransition();
  const [, startTransition] = useTransition();
  const queueId = snapshot.queue.id;
  const timeZone = snapshot.location.timezone || 'Europe/Paris';

  /** Un instantané nul (file supprimée entre-temps) ne remplace pas l'écran. */
  const setSnapshot = useCallback((next: ProfileQueueSnapshot | null | undefined) => {
    if (next) setSnapshotState(next);
  }, []);

  /* ---------------------------------------------------------------
     Temps réel : le même mécanisme que le poste des barbiers.
     Postgres Changes sous RLS (voie principale), Broadcast de la file
     comme simple signal, relecture toutes les 20 s en dernier filet.
     On ne lit JAMAIS la charge utile : l'instantané complet est relu par
     l'action serveur authentifiée.
     --------------------------------------------------------------- */
  const refresh = useCallback(async () => {
    const result = await fetchProfileQueueSnapshot(orgSlug, queueId);
    if (result.ok) setSnapshot(result.data.snapshot);
  }, [orgSlug, queueId, setSnapshot]);

  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  useEffect(() => {
    const supabase = supabaseBrowser();
    const changes = supabase
      .channel(`staff:${queueId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'queue_entries', filter: `queue_id=eq.${queueId}` },
        () => { void refreshRef.current(); },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'queues', filter: `id=eq.${queueId}` },
        () => { void refreshRef.current(); },
      )
      .subscribe();
    const signal = supabase
      .channel(`queue:${queueId}`, { config: { broadcast: { self: false, ack: false } } })
      .on('broadcast', { event: 'state' }, () => { void refreshRef.current(); })
      .on('broadcast', { event: 'ticket' }, () => { void refreshRef.current(); })
      .subscribe();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refreshRef.current();
    }, 20_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refreshRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      void supabase.removeChannel(changes);
      void supabase.removeChannel(signal);
    };
  }, [queueId]);

  /* ---------------------------------------------------------------
     Retours : une erreur reste lisible 8 s, une annonce 4 s.
     --------------------------------------------------------------- */
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 8000);
    return () => clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 4200);
    return () => clearTimeout(timer);
  }, [flash]);

  const say = useCallback((text: string, tone: 'ok' | 'warn' | 'error' | 'muted' = 'ok') => {
    setFlash({ text, tone });
  }, []);

  /** Garde l'état d'un envoi sur la fiche, et l'annonce. */
  const recordNotice = useCallback((entryId: string, notice: SentNotice | null, subject?: string) => {
    if (!notice) return;
    const at = Date.now();
    setNotices((all) => ({ ...all, [entryId]: { ...notice, at } }));
    const label = noticeLabel(notice.reach as Reach, at, timeZone);
    say(subject ? `${subject} : ${label.text}` : label.text, label.tone);
  }, [say, timeZone]);

  /**
   * Exécute une action serveur « à la manière du poste » : un seul geste
   * à la fois par clé (fiche, formulaire), l'instantané renvoyé remplace
   * l'écran, l'erreur s'affiche en clair. Rend le résultat, pour que
   * l'appelant réagisse à un code précis (`invalid_desk`…).
   */
  const run = useCallback(
    async <T extends object>(
      key: string,
      action: () => Promise<ActionResult<T>>,
    ): Promise<ActionResult<T>> => {
      setError(null);
      setBusy(key);
      try {
        const result = await action();
        if (!result.ok) {
          setError({ message: result.error, code: result.code });
        } else if ('snapshot' in result.data) {
          setSnapshot((result.data as { snapshot?: ProfileQueueSnapshot | null }).snapshot);
        }
        return result;
      } finally {
        setBusy(null);
      }
    },
    [setSnapshot],
  );

  /**
   * Faire avancer une fiche. `success` est annoncé quand l'action n'a pas
   * déclenché d'envoi ; sinon, c'est l'état de l'envoi qui l'est.
   */
  const advance = useCallback(
    (
      entryId: string,
      action: AnyStaffAction,
      options?: Record<string, unknown>,
      { success, subject }: { success?: string; subject?: string } = {},
    ): Promise<ActionResult<{ snapshot: ProfileQueueSnapshot | null; notice: SentNotice | null }>> => {
      if (!canOperate) {
        return Promise.resolve({ ok: false, error: 'Action réservée à l’équipe.', code: 'forbidden' });
      }
      return new Promise((resolve) => {
        startTransition(async () => {
          const result = await run(entryId, () => advanceProfileEntry(orgSlug, { entryId, action, options }));
          if (result.ok) {
            if (result.data.notice) recordNotice(entryId, result.data.notice, subject);
            else if (success) say(success);
          }
          resolve(result);
        });
      });
    },
    [canOperate, orgSlug, recordNotice, run, say],
  );

  const setStatus = useCallback((status: QueueStatus, reason?: string) => {
    setError(null);
    startStatus(async () => {
      const result = await changeQueueStatus({ queueId, status, reason: reason ?? null });
      if (!result.ok) { setError({ message: result.error, code: result.code }); return; }
      // `changeQueueStatus` rend l'instantané SANS les informations métier :
      // on relit celui du poste.
      await refreshRef.current();
      router.refresh();
    });
  }, [queueId, router]);

  return {
    snapshot,
    setSnapshot,
    refresh,
    busy,
    error,
    setError,
    clearError: () => setError(null),
    flash,
    say,
    notices,
    recordNotice,
    run,
    advance,
    setStatus,
    statusPending,
    timeZone,
  };
}

export type ProfileBoardApi = ReturnType<typeof useProfileBoard>;
