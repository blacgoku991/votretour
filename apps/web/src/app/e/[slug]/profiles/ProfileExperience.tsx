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

export type { ProfileEntryPoint, ProfileTicketState };

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
 *  - le ticket repris sur cet appareil (`find_active_ticket`, valable pour
 *    toute l'organisation) : une fiche d'atelier ouverte depuis la page
 *    d'une file de barbiers s'affiche ICI, jamais dans le Rang des
 *    barbiers, qui ne sait pas dire une étape ni un devis. L'inverse (un
 *    passage au fauteuil repris sur la page d'un garage) repart chez eux ;
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
  const pageProfile = getProfile(queue?.profile).id;
  const features = await loadOrganizationFeatures(entryPoint.organization.id).catch(() => null);
  const resumed = initialTicket as ProfileTicketState | null;
  // La file de la page ne s'inscrit pas en profil métier : walkin ou
  // event (la page d'une file de barbiers qui reprend une fiche d'atelier
  // de cet appareil), ou profil ni ouvert à tous ni activé pour
  // l'organisation — même garde que `api/client/join` (`resolveJoinPath`),
  // qui servirait l'inscription comme un passage au fauteuil.
  const joinLegacy = !queue || isLegacyProfile(pageProfile) || !profileAvailable(pageProfile, features);

  // Rien de métier à montrer : ni ticket métier repris, ni inscription
  // métier. L'écran des barbiers, qui sait tout afficher de ce cas.
  if (!resumed || isLegacyProfile(resumed.queue.profile)) {
    if (joinLegacy) {
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
  }

  // Le ticket repris sur cet appareil peut appartenir à une AUTRE file de
  // l'établissement : c'est la sienne qui compte pour l'état public, et
  // les deux délais (page, ticket) sont lus pour le compte à rebours.
  const ticketQueueId = resumed && !isLegacyProfile(resumed.queue.profile) ? resumed.queue.id : null;
  const queueIds = [...new Set([queue?.id, ticketQueueId].filter((id): id is string => Boolean(id)))];
  const [graces, publicState] = await Promise.all([
    Promise.all(queueIds.map(async (id) => [id, await readGraceMinutes(id)] as const)),
    getPublicQueueState(ticketQueueId ?? queue?.id ?? '').catch((): PublicQueueState | null => null),
  ]);

  return (
    <ProfileShell
      entryPoint={entryPoint}
      initialTicket={resumed}
      initialPublic={publicState ? publicState.entries.map(({ id, ahead, status }) => ({ id, ahead, status })) : null}
      graceByQueue={Object.fromEntries(graces)}
      joinLegacy={joinLegacy}
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
