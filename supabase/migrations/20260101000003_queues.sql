-- =====================================================================
-- VotreTour — 0003 : files, tickets clients, sessions anonymes
-- =====================================================================

-- ---------------------------------------------------------------------
-- queues
-- ---------------------------------------------------------------------
create table public.queues (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  location_id       uuid not null references public.locations (id) on delete cascade,
  name              text not null default 'File principale'
                      check (length(trim(name)) between 1 and 80),
  mode              public.queue_mode not null default 'shared',
  status            public.queue_status not null default 'closed',
  is_default        boolean not null default false,

  -- Ce que l'on demande au client au moment de rejoindre.
  ask_client_name   boolean not null default true,
  client_name_required boolean not null default false,
  allow_staff_choice boolean not null default false,
  allow_service_choice boolean not null default false,

  -- Avancement de la file
  advance_mode      public.advance_mode not null default 'auto_serve',
  notify_ahead_threshold int not null default 2
                      check (notify_ahead_threshold between 1 and 10),

  -- Gestion des absents (configurable par établissement)
  absent_policy     public.absent_policy not null default 'move_back',
  absent_move_back_by int not null default 2 check (absent_move_back_by between 1 and 20),
  absent_grace_minutes int not null default 5 check (absent_grace_minutes between 0 and 120),

  -- Garde-fous
  max_active_entries int check (max_active_entries between 1 and 500),
  entry_ttl_minutes  int not null default 240 check (entry_ttl_minutes between 15 and 1440),
  join_cooldown_seconds int not null default 45 check (join_cooldown_seconds between 0 and 3600),

  opened_at         timestamptz,
  paused_at         timestamptz,
  closed_at         timestamptz,
  pause_reason      text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index queues_location_idx on public.queues (location_id);
create unique index queues_one_default_per_location
  on public.queues (location_id) where is_default;

create trigger queues_touch
  before update on public.queues
  for each row execute function internal.touch_updated_at();

comment on column public.queues.advance_mode is
  'auto_serve : TERMINER met directement le suivant en prestation. call_next : le suivant passe en "prochain" et le pro le démarre manuellement.';

-- ---------------------------------------------------------------------
-- client_sessions : identité anonyme d'un appareil, par organisation
-- ---------------------------------------------------------------------
-- Pas de compte, pas de mot de passe, pas d'email obligatoire.
-- Le device conserve un jeton secret ; la base ne stocke que son SHA-256.
-- La session est cloisonnée par organisation : un même téléphone chez
-- deux commerces = deux sessions indépendantes (isolation + RGPD).
create table public.client_sessions (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  public_id       text not null unique default internal.generate_public_id(18),
  token_hash      text not null unique,
  platform        public.client_platform not null default 'web',
  display_name    text check (display_name is null or length(trim(display_name)) between 1 and 40),
  locale          text not null default 'fr',
  -- RGPD : jamais d'IP en clair, seulement un condensat salé côté serveur
  -- utilisé pour l'anti-spam et la limitation de débit.
  ip_hash         text,
  user_agent_hash text,
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  expires_at      timestamptz not null default (now() + interval '30 days'),
  revoked_at      timestamptz
);
create index client_sessions_org_idx on public.client_sessions (organization_id);
create index client_sessions_expiry_idx on public.client_sessions (expires_at);
create index client_sessions_ip_idx on public.client_sessions (organization_id, ip_hash, created_at);

comment on table public.client_sessions is
  'Identité anonyme d''un appareil client. Aucun email ni téléphone n''est requis. Purgée automatiquement selon organization_settings.data_retention_days.';

-- ---------------------------------------------------------------------
-- queue_entries : un ticket dans la file
-- ---------------------------------------------------------------------
create table public.queue_entries (
  id                  uuid primary key default extensions.gen_random_uuid(),
  -- Seul identifiant exposé au client et diffusé en temps réel.
  public_id           text not null unique default internal.generate_public_id(22),

  organization_id     uuid not null references public.organizations (id) on delete cascade,
  location_id         uuid not null references public.locations (id) on delete cascade,
  queue_id            uuid not null references public.queues (id) on delete cascade,
  staff_id            uuid references public.staff (id) on delete set null,
  served_by_staff_id  uuid references public.staff (id) on delete set null,
  service_id          uuid references public.services (id) on delete set null,
  client_session_id   uuid references public.client_sessions (id) on delete set null,
  plate_id            uuid,

  client_name         text check (client_name is null or length(trim(client_name)) between 1 and 40),
  status              public.entry_status not null default 'waiting',
  source              public.entry_source not null default 'qr',

  -- Ordre dans la file. Flottant pour permettre une insertion entre deux
  -- tickets (décalage) sans réécrire toute la file.
  sort_order          double precision not null,
  -- Nombre de personnes devant : dénormalisé, recalculé
  -- transactionnellement à chaque mutation (voir 0006).
  people_ahead        int not null default 0,
  priority            int not null default 0,

  joined_at           timestamptz not null default now(),
  called_at           timestamptz,
  returning_at        timestamptz,
  present_at          timestamptz,
  service_started_at  timestamptz,
  completed_at        timestamptz,
  cancelled_at        timestamptz,
  absent_at           timestamptz,
  expired_at          timestamptz,
  last_position_change_at timestamptz not null default now(),

  -- Journal des notifications déjà émises pour ce ticket, pour ne jamais
  -- envoyer deux fois le même message.
  notification_status jsonb not null default '{}'::jsonb,
  staff_note          text,
  rejoin_count        int not null default 0,
  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

-- Statuts considérés comme « présents dans la file ».
create or replace function public.entry_is_active(p_status public.entry_status)
returns boolean
language sql
immutable
as $$
  select p_status in ('waiting', 'notified', 'returning', 'present', 'next', 'serving');
$$;

create index queue_entries_active_idx
  on public.queue_entries (queue_id, sort_order)
  where status in ('waiting', 'notified', 'returning', 'present', 'next', 'serving');
create index queue_entries_staff_active_idx
  on public.queue_entries (queue_id, staff_id, sort_order)
  where status in ('waiting', 'notified', 'returning', 'present', 'next', 'serving');
create index queue_entries_session_idx on public.queue_entries (client_session_id, status);
create index queue_entries_org_history_idx on public.queue_entries (organization_id, joined_at desc);
create index queue_entries_location_history_idx on public.queue_entries (location_id, joined_at desc);
create index queue_entries_serving_idx on public.queue_entries (queue_id) where status = 'serving';

-- Un même appareil ne peut pas occuper deux places actives dans la même
-- file : garde-fou anti double inscription au niveau du schéma.
create unique index queue_entries_one_active_per_session
  on public.queue_entries (queue_id, client_session_id)
  where client_session_id is not null
    and status in ('waiting', 'notified', 'returning', 'present', 'next', 'serving');

create trigger queue_entries_touch
  before update on public.queue_entries
  for each row execute function internal.touch_updated_at();

comment on column public.queue_entries.people_ahead is
  'Nombre de personnes devant ce client. C''est LA seule information montrée au client : aucun numéro de ticket type A013 n''est affiché.';

-- ---------------------------------------------------------------------
-- queue_events : historique complet et auditable de la file
-- ---------------------------------------------------------------------
create table public.queue_events (
  id              bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  location_id     uuid not null references public.locations (id) on delete cascade,
  queue_id        uuid not null references public.queues (id) on delete cascade,
  entry_id        uuid references public.queue_entries (id) on delete set null,
  entry_public_id text,
  actor           public.actor_type not null default 'system',
  actor_user_id   uuid references public.profiles (id) on delete set null,
  actor_staff_id  uuid references public.staff (id) on delete set null,
  event_type      text not null,
  from_status     public.entry_status,
  to_status       public.entry_status,
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index queue_events_queue_idx on public.queue_events (queue_id, created_at desc);
create index queue_events_entry_idx on public.queue_events (entry_id, created_at);
create index queue_events_org_idx on public.queue_events (organization_id, created_at desc);

-- ---------------------------------------------------------------------
-- Contrainte d'intégrité tenant : les FK croisées doivent rester dans la
-- même organisation. Vérifié par trigger (impossible en FK composite ici
-- sans dupliquer les colonnes).
-- ---------------------------------------------------------------------
create or replace function internal.assert_entry_tenant_consistency()
returns trigger
language plpgsql
as $$
declare
  v_org uuid;
begin
  select q.organization_id into v_org
  from public.queues q
  where q.id = new.queue_id;

  if v_org is null then
    raise exception 'File introuvable: %', new.queue_id;
  end if;
  if v_org <> new.organization_id then
    raise exception 'Incohérence multi-tenant: la file % n''appartient pas à l''organisation %',
      new.queue_id, new.organization_id;
  end if;

  if new.staff_id is not null and not exists (
    select 1 from public.staff s
    where s.id = new.staff_id and s.organization_id = new.organization_id
  ) then
    raise exception 'Incohérence multi-tenant: employé % hors organisation', new.staff_id;
  end if;

  if new.client_session_id is not null and not exists (
    select 1 from public.client_sessions cs
    where cs.id = new.client_session_id and cs.organization_id = new.organization_id
  ) then
    raise exception 'Incohérence multi-tenant: session client % hors organisation', new.client_session_id;
  end if;

  return new;
end;
$$;

create trigger queue_entries_tenant_guard
  before insert or update of queue_id, staff_id, client_session_id, organization_id
  on public.queue_entries
  for each row execute function internal.assert_entry_tenant_consistency();
