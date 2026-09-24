-- =====================================================================
-- Rangvia — 0032 : profils métier, énumérations
-- ---------------------------------------------------------------------
-- Un profil décrit comment une FILE travaille : passage au fauteuil,
-- atelier véhicule, atelier appareil, table, guichet, boutique ou
-- événement. Il se règle par file (queues.profile, migration 0033) et
-- vaut 'walkin' pour toutes les files existantes : les barbiers ne
-- voient rien changer.
--
-- Ce fichier n'est PAS encadré par begin/commit, contrairement aux
-- migrations 0033 à 0037 : une valeur ajoutée à un enum par
-- « alter type … add value » n'est pas utilisable dans la transaction
-- qui l'ajoute. Isolées ici, les nouvelles valeurs sont validées dès la
-- fin de chaque instruction (psql en mode autocommit), et 0034 peut s'en
-- servir. Chaque instruction est rejouable : si le fichier échoue au
-- milieu, le passage suivant de migrate.sh le reprend sans erreur.
--
-- Aucune valeur n'est ajoutée à entry_status ni à advance_mode : l'App
-- Clip déjà installé décode le statut avec un enum Swift strict et
-- échouerait sur une valeur inconnue. Les étapes métier passent par une
-- colonne texte à part (queue_entries.stage, 0033).
-- =====================================================================

do $$
begin
  create type public.queue_profile as enum (
    'walkin',   -- passage au fauteuil : barbier, coiffure, ongles, beauté (comportement historique)
    'vehicle',  -- atelier automobile : garage, centre auto
    'device',   -- atelier appareils et SAV : réparation de téléphones, service après-vente
    'table',    -- restaurant : groupes et couverts
    'desk',     -- guichet : comptoir, service administratif, santé
    'retail',   -- boutique : conseil et retrait de commande
    'event'     -- événements et drops : module Événements, inchangé
  );
exception when duplicate_object then
  null;
end
$$;

comment on type public.queue_profile is
  'Profil métier d''une file (queues.profile). walkin = comportement historique, inchangé.';

-- Genres de notification propres aux profils. 'custom' existe déjà
-- depuis 0001 : il sert aux messages envoyés par le professionnel.
alter type public.notification_kind add value if not exists 'stage_update'; -- une étape de l'atelier a changé
alter type public.notification_kind add value if not exists 'quote_ready';  -- un devis attend l'accord du client
alter type public.notification_kind add value if not exists 'recall';       -- rappel manuel (table, guichet, véhicule prêt)

notify pgrst, 'reload schema';
