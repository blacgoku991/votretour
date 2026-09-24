import type { ReactNode } from 'react';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { profileAvailable } from '@/lib/profiles/capabilities';
import { getProfile, isLegacyProfile } from '@/lib/profiles';
import type { ProfileEntryPoint, ProfileTicketState } from '@/lib/profiles/types';
import type { PublicQueueState, TicketState } from '@/lib/types';
import { getPublicQueueState } from '@/server/queue';
import { loadOrganizationFeatures } from '@/server/profiles/queue';
import { ClientExperience, type StaffGate } from '../ClientExperience';
import { ProfileShell } from './ProfileShell';

export type { ProfileEntryPoint };

/**
 * L'EXPÉRIENCE CLIENT DES PROFILS MÉTIER — atelier (véhicule, appareil),
 * table, guichet, boutique.
 *
 * Composant SERVEUR : il lit ce que la page n'a pas à connaître, puis
 * confie l'écran à `ProfileShell` (client), qui tient la synchronisation,
 * le temps réel et les phases. Ce qu'il lit, et pourquoi ici :
 *
 *  - la disponibilité du profil pour l'organisation. Même garde que
 *    `api/client/join` (`resolveJoinPath`) : un profil ni ouvert à tous ni
 *    activé pour elle y est servi comme un passage au fauteuil ; l'écran
 *    fait donc de même, avec `ClientExperience` — jamais un formulaire
 *    d'atelier dont l'inscription perdrait les informations ;
 *  - le délai pour se présenter après l'appel (`absent_grace_minutes`),
 *    absent de `ticket_state` : le compte à rebours de la table est celui
 *    que le moteur appliquera, pas un chiffre inventé ;
 *  - l'état public de la file (`public_queue_state`, sans donnée
 *    personnelle), pour dire dès l'arrivée « 3 véhicules avant le vôtre »
 *    sans attendre la première diffusion.
 *
 * `walletSlot` : le bouton Wallet, branché par la jonction Wallet ×
 * profils (lot J), exactement comme dans `QueuedPanel`. null d'ici là.
 */

interface Props {
  entryPoint: ProfileEntryPoint;
  initialTicket: TicketState | null;
  source: 'qr' | 'nfc' | 'appclip' | 'link';
  staffGate: StaffGate | null;
  vapidPublicKey: string | null;
  activityLabel: string | null;
  walletSlot?: ReactNode;
}

export async function ProfileExperience({
  entryPoint,
  initialTicket,
  source,
  staffGate,
  vapidPublicKey,
  activityLabel,
  walletSlot = null,
}: Props) {
  const queue = entryPoint.queue;
  const profile = getProfile(queue?.profile).id;
  const features = await loadOrganizationFeatures(entryPoint.organization.id).catch(() => null);

  // Garde de l'inscription, ou ticket repris sur cet appareil qui est un
  // passage au fauteuil (une autre file du même établissement) : l'écran
  // des barbiers, qui sait l'afficher.
  const resumed = initialTicket as ProfileTicketState | null;
  if (!queue || !profileAvailable(profile, features) || (resumed && isLegacyProfile(resumed.queue.profile))) {
    return (
      <ClientExperience
        entryPoint={entryPoint}
        initialTicket={initialTicket}
        source={source}
        staffGate={staffGate}
        vapidPublicKey={vapidPublicKey}
        activityLabel={activityLabel}
      />
    );
  }

  // Le ticket repris sur cet appareil peut appartenir à une AUTRE file du
  // lieu : c'est la sienne qui compte pour l'état public.
  const ticket = resumed;
  const queueId = ticket?.queue.id ?? queue.id;
  const [graceMinutes, publicState] = await Promise.all([
    readGraceMinutes(queueId),
    getPublicQueueState(queueId).catch((): PublicQueueState | null => null),
  ]);

  return (
    <ProfileShell
      entryPoint={entryPoint}
      initialTicket={ticket}
      initialPublic={publicState ? publicState.entries.map(({ id, ahead, status }) => ({ id, ahead, status })) : null}
      graceMinutes={graceMinutes}
      source={source}
      staffGate={staffGate}
      vapidPublicKey={vapidPublicKey}
      activityLabel={activityLabel}
      walletSlot={walletSlot}
    />
  );
}

async function readGraceMinutes(queueId: string): Promise<number | null> {
  try {
    const { data } = await supabaseAdmin()
      .from('queues')
      .select('absent_grace_minutes')
      .eq('id', queueId)
      .maybeSingle();
    const n = data?.absent_grace_minutes;
    return typeof n === 'number' && n > 0 ? n : null;
  } catch {
    return null;
  }
}
