-- =====================================================================
-- Rangvia — 0033 : profils métier, schéma
-- ---------------------------------------------------------------------
-- Colonnes, index et tables dont le moteur des profils (0034) a besoin.
--
-- Effet sur les données existantes :
--   * toutes les files existantes prennent profile = 'walkin' par la
--     valeur par défaut de la colonne, sans aucun rattrapage selon
--     l'activité : un garage déjà inscrit garde exactement son poste
--     d'aujourd'hui tant qu'il n'active pas le profil lui-même ;
--   * « add column … default <constante> » est un changement de
--     métadonnées (PostgreSQL 11 et plus), sans réécriture. Les check des
--     nouvelles colonnes imposent un parcours de validation, court parce
--     que queue_entries est anonymisée et que queues est petite ;
--   * la recréation de queue_entries_one_active_per_session pose un
--     verrou d'écriture le temps de construire l'index (une à deux
--     secondes sur ces volumes) : à passer en heure creuse. Pas de
--     « concurrently », interdit dans une transaction.
--
-- Transaction explicite : migrate.sh exécute chaque fichier avec
-- ON_ERROR_STOP mais hors transaction. Sans ce begin/commit, un échec au
-- milieu laisserait un état partiel, non enregistré, que le passage
-- suivant ne pourrait pas rejouer.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Files : profil, options du profil, préfixe des numéros de ticket
-- ---------------------------------------------------------------------
alter table public.queues
  add column profile public.queue_profile not null default 'walkin',
  add column profile_options jsonb not null default '{}'::jsonb
    constraint queues_profile_options_shape
    check (jsonb_typeof(profile_options) = 'object' and pg_column_size(profile_options) <= 1024),
  add column ticket_prefix text not null default 'A'
    constraint queues_ticket_prefix_format
    check (ticket_prefix ~ '^[A-Z]{1,2}$');

comment on column public.queues.profile is
  'Profil métier de la file. walkin = passage au fauteuil, le comportement historique : chaque branche nouvelle du moteur est derrière profile <> ''walkin''.';
comment on column public.queues.profile_options is
  'Options propres au profil (stayChoice, registrationRequired, tvRegistration, quotes, partyMax, tableSizes, reviewDelayMinutes, numbering, sensitive, review). {} en walkin. Posées par internal.apply_profile_defaults (0034).';
comment on column public.queues.ticket_prefix is
  'Préfixe des numéros de guichet et de boutique (A-042). Le numéro protège la vie privée : on appelle un numéro, pas un nom, sur un écran public.';

-- Durée de vie : jusqu'à 30 jours pour les ateliers, qui gardent une
-- voiture ou un téléphone plusieurs jours. Le défaut reste 240 min.
alter table public.queues drop constraint queues_entry_ttl_minutes_check;
alter table public.queues add constraint queues_entry_ttl_minutes_check
  check (entry_ttl_minutes between 15 and 43200);

-- ---------------------------------------------------------------------
-- Tickets : informations métier, étape, numéro, rattachement différé
-- ---------------------------------------------------------------------
alter table public.queue_entries
  add column details jsonb not null default '{}'::jsonb
    constraint queue_entries_details_shape
    check (jsonb_typeof(details) = 'object' and pg_column_size(details) <= 2048),
  add column stage text
    constraint queue_entries_stage_format
    check (stage is null or stage ~ '^[a-z_]{2,32}$'),
  add column stage_changed_at timestamptz,
  add column ticket_no int
    constraint queue_entries_ticket_no_range
    check (ticket_no is null or ticket_no between 1 and 9999),
  add column registration_key text
    constraint queue_entries_registration_key_format
    check (registration_key is null or registration_key ~ '^[A-Z0-9]{2,12}$'),
  add column claim_token_hash text
    constraint queue_entries_claim_token_hash_format
    check (claim_token_hash is null or claim_token_hash ~ '^[0-9a-f]{64}$'),
  add column claim_expires_at timestamptz;

comment on column public.queue_entries.details is
  'Informations métier du ticket, sur liste blanche par profil (internal.clean_details) : immatriculation, modèle, couverts, devis… {} en walkin. Vidé par la purge RGPD avec le prénom.';
comment on column public.queue_entries.stage is
  'Étape métier (received, diagnosis, quote_pending, waiting_parts, in_repair, ready, preparing). Chaque étape correspond à un statut existant (internal.stage_status) : la machine à états ne change pas. Toujours null en walkin, table, desk et event.';
comment on column public.queue_entries.stage_changed_at is
  'Dernier changement d''étape. L''expiration compte depuis cette date quand elle existe : une voiture qui avance ne périme pas.';
comment on column public.queue_entries.ticket_no is
  'Numéro court : quotidien au guichet et en boutique (A-042), continu en atelier appareil (dossier 0042). Null en walkin.';
comment on column public.queue_entries.registration_key is
  'Immatriculation normalisée (AB123CD), pour la recherche du poste. Jamais envoyée au téléviseur ni dans une notification. Purgée avec le prénom.';
comment on column public.queue_entries.claim_token_hash is
  'SHA-256 (hexadécimal) du jeton de suivi à usage unique (étiquette de clé, QR). Le jeton lui-même n''est jamais stocké.';

-- Rattachement par QR de suivi : un jeton désigne au plus un ticket.
create unique index queue_entries_claim_token_idx
  on public.queue_entries (claim_token_hash)
  where claim_token_hash is not null;

-- Recherche par immatriculation dans le poste d'atelier.
create index queue_entries_registration_idx
  on public.queue_entries (queue_id, registration_key)
  where registration_key is not null;

-- Colonnes du poste d'atelier : tickets actifs par étape.
create index queue_entries_stage_idx
  on public.queue_entries (queue_id, stage)
  where stage is not null
    and status in ('waiting', 'notified', 'returning', 'present', 'next', 'serving');

-- Avis Google différé (restaurant) : le cron cherche, file par file, les
-- tickets terminés depuis moins de 24 h. Sans cet index, chaque minute
-- parcourrait tout l'historique, qui n'est qu'anonymisé et jamais supprimé.
create index queue_entries_completed_idx
  on public.queue_entries (queue_id, completed_at)
  where status = 'completed';

-- Un appareil peut suivre plusieurs véhicules ou appareils (tickets à
-- étape) ; la règle « une place active par appareil et par file » reste
-- entière pour les tickets sans étape, donc pour tous les barbiers.
drop index public.queue_entries_one_active_per_session;
create unique index queue_entries_one_active_per_session
  on public.queue_entries (queue_id, client_session_id)
  where client_session_id is not null
    and stage is null
    and status in ('waiting', 'notified', 'returning', 'present', 'next', 'serving');

-- ---------------------------------------------------------------------
-- Guichets : une fiche staff = un guichet, avec son libellé public
-- ---------------------------------------------------------------------
alter table public.staff
  add column desk_label text
    constraint staff_desk_label_length
    check (desk_label is null or length(trim(desk_label)) between 1 and 24);

comment on column public.staff.desk_label is
  'Libellé public du guichet (« Guichet 3 », « Box 2 »). Sans libellé, on affiche le nom de la fiche.';

-- ---------------------------------------------------------------------
-- Numérotation des tickets
-- ---------------------------------------------------------------------
-- Une ligne par file et par jour local (guichet, boutique), ou une ligne
-- unique datée du 1er janvier 1970 pour un compteur continu (atelier
-- appareil). L'incrément se fait par « insert … on conflict do update » :
-- deux inscriptions simultanées ne reçoivent jamais le même numéro.
create table public.queue_ticket_counters (
  queue_id  uuid not null references public.queues (id) on delete cascade,
  scope_day date not null,              -- '1970-01-01' = compteur continu
  last_no   int  not null default 0 check (last_no between 0 and 9999),
  primary key (queue_id, scope_day)
);

comment on table public.queue_ticket_counters is
  'Dernier numéro de ticket attribué, par file et par jour local (1970-01-01 : compteur continu). Aucune donnée personnelle ; les jours passés sont purgés.';

-- ---------------------------------------------------------------------
-- Modèles de messages envoyés par le professionnel
-- ---------------------------------------------------------------------
-- Les textes par défaut vivent dans le code (lib/profiles) ; cette table
-- ne porte que les surcharges d'un établissement.
create table public.message_templates (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  location_id     uuid references public.locations (id) on delete cascade,
  profile         public.queue_profile not null,
  key             text not null check (key ~ '^[a-z0-9_]{2,40}$'),
  label           text not null check (length(trim(label)) between 1 and 40),
  body            text not null check (length(body) between 1 and 180),
  is_active       boolean not null default true,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create unique index message_templates_unique
  on public.message_templates (
    organization_id,
    coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid),
    profile,
    key
  );

create trigger message_templates_touch
  before update on public.message_templates
  for each row execute function internal.touch_updated_at();

comment on table public.message_templates is
  'Surcharges des modèles de messages du professionnel (180 caractères, sans URL : contrôlé côté serveur). Lecture par les membres, écriture par le serveur seulement.';

-- Garde-fou multi-tenant, même modèle que les autres tables : même le
-- service_role ne peut pas rattacher un modèle à l'établissement d'une
-- autre organisation.
create or replace function internal.assert_message_template_tenant()
returns trigger
language plpgsql
as $$
begin
  if new.location_id is not null and not exists (
    select 1 from public.locations l
    where l.id = new.location_id and l.organization_id = new.organization_id
  ) then
    raise exception 'Incohérence multi-tenant: établissement % hors organisation', new.location_id;
  end if;
  return new;
end;
$$;

create trigger message_templates_tenant_guard
  before insert or update of organization_id, location_id
  on public.message_templates
  for each row execute function internal.assert_message_template_tenant();

-- ---------------------------------------------------------------------
-- Row Level Security (motif de 0010)
-- ---------------------------------------------------------------------
-- Lecture par les membres de l'organisation (le poste et les Réglages
-- lisent sous leur propre session) ; toute écriture passe par le serveur
-- (service_role). anon n'a aucun droit.
alter table public.queue_ticket_counters enable row level security;
alter table public.message_templates enable row level security;

revoke all on public.queue_ticket_counters, public.message_templates from public, anon, authenticated;
grant all on public.queue_ticket_counters, public.message_templates to service_role;
grant select on public.queue_ticket_counters, public.message_templates to authenticated;

create policy message_templates_org_select on public.message_templates
  for select to authenticated
  using (public.is_org_member(organization_id) or public.is_platform_admin());

create policy queue_ticket_counters_org_select on public.queue_ticket_counters
  for select to authenticated
  using (exists (
    select 1 from public.queues q
    where q.id = queue_ticket_counters.queue_id
      and (public.is_org_member(q.organization_id) or public.is_platform_admin())
  ));

notify pgrst, 'reload schema';

commit;
