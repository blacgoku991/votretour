'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabaseBrowser } from '@/lib/supabase/browser';
import type { PublicQueueState } from '@/lib/types';

/**
 * Temps réel côté client.
 *
 * On s'abonne à un canal Broadcast (et non à Postgres Changes) : la
 * charge utile est construite par le serveur et ne contient aucune
 * donnée personnelle. Le navigateur n'a donc jamais le droit de lire la
 * table des tickets — il reçoit seulement « le ticket X a N personnes
 * devant lui », et il est le seul à savoir que X est le sien.
 *
 * Le temps réel n'est jamais considéré comme acquis :
 *   - reconnexion automatique avec repli exponentiel ;
 *   - interrogation de secours tant que le canal n'est pas établi ;
 *   - resynchronisation au retour de veille et au retour du réseau.
 * L'utilisateur ne rafraîchit jamais manuellement.
 */

export type ConnectionState = 'connecting' | 'live' | 'polling' | 'offline';

interface Options {
  queueId: string | null;
  /** Appelé à chaque nouvel état diffusé. */
  onState?: (state: PublicQueueState) => void;
  /** Appelé pour les événements ciblant un ticket précis. */
  onTicketEvent?: (event: { entryId: string; event: string } & Record<string, unknown>) => void;
  /** Resynchronisation complète (repli et retour de veille). */
  onResync?: () => void | Promise<void>;
  enabled?: boolean;
}

const POLL_INTERVAL_MS = 15_000;
const POLL_INTERVAL_LIVE_MS = 90_000; // filet de sécurité même en temps réel

export function useQueueRealtime({
  queueId,
  onState,
  onTicketEvent,
  onResync,
  enabled = true,
}: Options): { connection: ConnectionState; lastEventAt: number | null; resync: () => void } {
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [lastEventAt, setLastEventAt] = useState<number | null>(null);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const retryRef = useRef(0);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Les callbacks changent à chaque rendu : on les garde dans des refs
  // pour ne pas réabonner le canal à chaque fois.
  const stateRef = useRef(onState);
  const ticketRef = useRef(onTicketEvent);
  const resyncRef = useRef(onResync);
  useEffect(() => { stateRef.current = onState; }, [onState]);
  useEffect(() => { ticketRef.current = onTicketEvent; }, [onTicketEvent]);
  useEffect(() => { resyncRef.current = onResync; }, [onResync]);

  const resync = useCallback(() => {
    void resyncRef.current?.();
  }, []);

  useEffect(() => {
    if (!enabled || !queueId) return;

    const supabase = supabaseBrowser();
    let disposed = false;

    const connect = () => {
      if (disposed) return;

      const channel = supabase.channel(`queue:${queueId}`, {
        config: { broadcast: { self: false, ack: false } },
      });

      channel
        .on('broadcast', { event: 'state' }, ({ payload }) => {
          setLastEventAt(Date.now());
          stateRef.current?.(payload as PublicQueueState);
        })
        .on('broadcast', { event: 'ticket' }, ({ payload }) => {
          setLastEventAt(Date.now());
          ticketRef.current?.(payload as { entryId: string; event: string });
        })
        .subscribe((status) => {
          if (disposed) return;
          if (status === 'SUBSCRIBED') {
            retryRef.current = 0;
            setConnection('live');
            // Un événement a pu être manqué pendant l'établissement.
            void resyncRef.current?.();
            return;
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            setConnection(navigator.onLine ? 'polling' : 'offline');
            scheduleRetry();
          }
        });

      channelRef.current = channel;
    };

    const scheduleRetry = () => {
      if (disposed || retryTimer.current) return;
      const attempt = Math.min(retryRef.current, 5);
      const delay = Math.min(1000 * 2 ** attempt, 20_000) + Math.random() * 500;
      retryRef.current += 1;
      retryTimer.current = setTimeout(() => {
        retryTimer.current = null;
        if (disposed) return;
        const previous = channelRef.current;
        channelRef.current = null;
        if (previous) void supabase.removeChannel(previous);
        setConnection('connecting');
        connect();
      }, delay);
    };

    connect();

    /* ---- Filet de sécurité : interrogation périodique ---- */
    let pollTimer: ReturnType<typeof setInterval> | null = null;
    const startPolling = () => {
      if (pollTimer) clearInterval(pollTimer);
      pollTimer = setInterval(
        () => {
          if (document.visibilityState === 'visible') void resyncRef.current?.();
        },
        connection === 'live' ? POLL_INTERVAL_LIVE_MS : POLL_INTERVAL_MS,
      );
    };
    startPolling();

    /* ---- Retour de veille, retour du réseau ---- */
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void resyncRef.current?.();
        if (channelRef.current?.state !== 'joined') scheduleRetry();
      }
    };
    const onOnline = () => {
      setConnection('connecting');
      void resyncRef.current?.();
      scheduleRetry();
    };
    const onOffline = () => setConnection('offline');

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    window.addEventListener('pageshow', onVisible);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('pageshow', onVisible);
      if (retryTimer.current) clearTimeout(retryTimer.current);
      if (pollTimer) clearInterval(pollTimer);
      const channel = channelRef.current;
      channelRef.current = null;
      if (channel) void supabase.removeChannel(channel);
    };
    // `connection` est volontairement exclu : il ne sert qu'à cadencer
    // l'interrogation de secours et provoquerait un réabonnement en boucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queueId, enabled]);

  return { connection, lastEventAt, resync };
}
