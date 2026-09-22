'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  buildUrlMessage, describeNfcError, detectNfcSupport,
  readUrlFromRecords, samePlateUrl, type NfcSupport,
} from '@/lib/nfc';

/**
 * Écriture réelle d'un tag NFC, via l'API Web NFC.
 *
 * Déroulé, tel qu'il se passe vraiment avec la puce :
 *
 *   1. scan()  — on se met à l'écoute. Le premier tag qui passe nous
 *                donne son numéro de série : on sait lequel on programme.
 *   2. write() — on écrit l'enregistrement URI pendant que le tag est
 *                encore dans le champ.
 *   3. relecture — le tag suivant lu est comparé à ce qu'on a écrit.
 *                C'est la seule preuve que la plaque porte bien la bonne
 *                adresse. Sans cette étape on afficherait « programmée »
 *                sur la foi d'une promesse résolue.
 *
 * L'étape 3 peut être sautée par l'utilisateur ; dans ce cas on
 * enregistre verified = false côté serveur, et l'interface le dit.
 */

export type NfcPhase =
  | 'idle'          // rien en cours
  | 'waiting'       // en attente du premier contact
  | 'writing'       // écriture en cours
  | 'verify'        // écrit, en attente de la relecture de contrôle
  | 'locking'       // passage en lecture seule
  | 'done'          // terminé
  | 'error';

export interface NfcState {
  phase: NfcPhase;
  error: string | null;
  serialNumber: string | null;
  verified: boolean;
  locked: boolean;
}

const IDLE: NfcState = {
  phase: 'idle', error: null, serialNumber: null, verified: false, locked: false,
};

/** Au-delà, on rend la main : l'utilisateur a probablement posé le téléphone. */
const TIMEOUT_MS = 120_000;

export function useNfcWriter() {
  const [support, setSupport] = useState<NfcSupport | null>(null);
  const [state, setState] = useState<NfcState>(IDLE);
  const abortRef = useRef<AbortController | null>(null);
  const aliveRef = useRef(true);

  // La détection n'a de sens que dans le navigateur ; la faire au rendu
  // serveur produirait un premier rendu différent du second.
  useEffect(() => {
    setSupport(detectNfcSupport());
    return () => {
      aliveRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const set = useCallback((patch: Partial<NfcState>) => {
    if (aliveRef.current) setState((prev) => ({ ...prev, ...patch }));
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(IDLE);
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setState(IDLE);
  }, []);

  /**
   * Programme la plaque. `lock` passe le tag en lecture seule — c'est
   * DÉFINITIF, l'appelant doit l'avoir fait confirmer.
   */
  const program = useCallback(async (
    url: string,
    options: { lock?: boolean } = {},
  ): Promise<{ ok: boolean; serialNumber: string | null; verified: boolean; locked: boolean }> => {
    if (typeof window === 'undefined' || !window.NDEFReader) {
      set({ phase: 'error', error: "Ce navigateur ne sait pas écrire les tags NFC." });
      return { ok: false, serialNumber: null, verified: false, locked: false };
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let serial: string | null = null;
    let verified = false;
    let locked = false;

    try {
      const message = buildUrlMessage(url);
      const ndef = new window.NDEFReader();

      setState({ ...IDLE, phase: 'waiting' });
      await ndef.scan({ signal: controller.signal });

      // --- 1. Premier contact : on retient le tag ------------------
      await new Promise<void>((resolve, reject) => {
        if (controller.signal.aborted) { reject(abortError()); return; }
        const onAbort = () => reject(abortError());
        controller.signal.addEventListener('abort', onAbort, { once: true });
        ndef.addEventListener('reading', (event) => {
          serial = event.serialNumber || null;
          controller.signal.removeEventListener('abort', onAbort);
          resolve();
        }, { once: true });
      });

      // --- 2. Écriture --------------------------------------------
      set({ phase: 'writing', serialNumber: serial });
      await ndef.write(message, { overwrite: true, signal: controller.signal });

      // --- 3. Relecture de contrôle -------------------------------
      set({ phase: 'verify' });
      verified = await new Promise<boolean>((resolve) => {
        const onAbort = () => resolve(false);
        controller.signal.addEventListener('abort', onAbort, { once: true });
        ndef.addEventListener('reading', (event) => {
          controller.signal.removeEventListener('abort', onAbort);
          const readBack = readUrlFromRecords(event.message.records);
          if (event.serialNumber) serial = event.serialNumber;
          resolve(readBack !== null && samePlateUrl(url, readBack));
        }, { once: true });
      });

      // --- 4. Verrouillage, si demandé ----------------------------
      // Si l'utilisateur a coupé court à la relecture, le signal est
      // abandonné : on ne tente pas un verrouillage qui échouerait, et
      // qui ferait passer pour un échec une écriture pourtant réussie.
      if (options.lock && !controller.signal.aborted) {
        set({ phase: 'locking', verified, serialNumber: serial });
        await ndef.makeReadOnly({ signal: controller.signal });
        locked = true;
      }

      set({ phase: 'done', verified, locked, serialNumber: serial, error: null });
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate?.(verified ? [14, 60, 14] : 20);
      }
      return { ok: true, serialNumber: serial, verified, locked };
    } catch (error) {
      // Une interruption volontaire après une écriture réussie n'est pas
      // un échec : la plaque porte la bonne adresse, elle n'a simplement
      // pas été relue.
      set({ phase: 'error', error: describeNfcError(error) });
      return { ok: false, serialNumber: serial, verified, locked };
    } finally {
      clearTimeout(timer);
      if (abortRef.current === controller) abortRef.current = null;
    }
  }, [set]);

  /** Termine sans relecture : honnête, et enregistré comme tel. */
  const skipVerification = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    set({ phase: 'done', verified: false });
  }, [set]);

  return { support, state, program, cancel, reset, skipVerification };
}

function abortError(): DOMException {
  return new DOMException('Programmation interrompue', 'AbortError');
}
