-- =====================================================================
-- VotreTour — 0004 : plaques NFC/QR et canaux de notification
-- =====================================================================

-- ---------------------------------------------------------------------
-- plates : les supports physiques posés dans l'établissement
-- ---------------------------------------------------------------------
-- Une plaque = un NFC + un QR + une URL unique /e/{code}. Le tag NFC et
-- le QR code encodent exactement la même URL : l'expérience est identique.
create table public.plates (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  location_id     uuid not null references public.locations (id) on delete cascade,
  queue_id        uuid references public.queues (id) on delete set null,
  staff_id        uuid references public.staff (id) on delete set null,
  code            text not null unique references public.slug_registry (slug) on delete restrict deferrable initially deferred,
  label           text not null default 'Plaque' check (length(trim(label)) between 1 and 60),
  kind            public.plate_kind not null default 'both',
  is_active       boolean not null default true,
  scan_count      bigint not null default 0,
  last_scanned_at timestamptz,
  -- Préparation de la commande physique de plaques.
  order_status    public.plate_order_status not null default 'none',
  order_quantity  int check (order_quantity between 1 and 500),
  order_reference text,
  order_requested_at timestamptz,
  order_shipped_at   timestamptz,
  shipping_address jsonb,
  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index plates_location_idx on public.plates (location_id) where is_active;
create index plates_queue_idx on public.plates (queue_id);

create trigger plates_touch
  before update on public.plates
  for each row execute function internal.touch_updated_at();

alter table public.queue_entries
  add constraint queue_entries_plate_fk
  foreign key (plate_id) references public.plates (id) on delete set null;

comment on column public.plates.staff_id is
  'Plaque dédiée à un professionnel précis (mode file par professionnel) : le client rejoint directement sa file.';

-- Journal de scan, utile pour les statistiques et le super-admin.
create table public.plate_scans (
  id              bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  plate_id        uuid not null references public.plates (id) on delete cascade,
  location_id     uuid not null references public.locations (id) on delete cascade,
  source          public.entry_source not null default 'qr',
  platform        public.client_platform not null default 'unknown',
  converted       boolean not null default false,
  created_at      timestamptz not null default now()
);
create index plate_scans_plate_idx on public.plate_scans (plate_id, created_at desc);
create index plate_scans_org_idx on public.plate_scans (organization_id, created_at desc);

-- ---------------------------------------------------------------------
-- notification_subscriptions : un canal de push par appareil
-- ---------------------------------------------------------------------
-- Trois canaux réels :
--   web_push     → navigateur (Android Chrome, PWA iOS) via VAPID
--   apns_appclip → App Clip iOS, jeton éphémère valable 8 h après lancement
--   apns_app     → application iOS complète
create table public.notification_subscriptions (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  client_session_id uuid not null references public.client_sessions (id) on delete cascade,
  channel           public.notification_channel not null,

  -- Web Push : endpoint + clés de chiffrement du navigateur.
  endpoint          text,
  p256dh            text,
  auth_secret       text,
  -- APNs : device token hexadécimal + topic (bundle id de la cible).
  device_token      text,
  bundle_id         text,
  apns_environment  text check (apns_environment in ('sandbox', 'production')),
  -- App Clip multi-commerces : Apple exige que le payload porte un
  -- target-content-id correspondant à une expérience avancée déclarée.
  -- On mémorise l'URL d'invocation pour la rejouer dans chaque push.
  invocation_url    text,

  -- Empreinte stable du destinataire, pour la clé d'unicité.
  endpoint_hash     text not null,
  expires_at        timestamptz,
  is_active         boolean not null default true,
  failure_count     int not null default 0,
  last_success_at   timestamptz,
  last_failure_at   timestamptz,
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint notification_subscriptions_web_push_shape check (
    channel <> 'web_push'
    or (endpoint is not null and p256dh is not null and auth_secret is not null)
  ),
  constraint notification_subscriptions_apns_shape check (
    channel not in ('apns_appclip', 'apns_app')
    or (device_token is not null and bundle_id is not null)
  )
);
create unique index notification_subscriptions_unique
  on public.notification_subscriptions (channel, endpoint_hash);
create index notification_subscriptions_session_idx
  on public.notification_subscriptions (client_session_id) where is_active;
create index notification_subscriptions_expiry_idx
  on public.notification_subscriptions (expires_at) where is_active;

create trigger notification_subscriptions_touch
  before update on public.notification_subscriptions
  for each row execute function internal.touch_updated_at();

comment on column public.notification_subscriptions.expires_at is
  'App Clip : Apple n''autorise les notifications éphémères que 8 h après chaque lancement. Au-delà, l''abonnement est considéré mort.';

-- ---------------------------------------------------------------------
-- app_clip_sessions : trace des lancements d'App Clip
-- ---------------------------------------------------------------------
create table public.app_clip_sessions (
  id                 uuid primary key default extensions.gen_random_uuid(),
  organization_id    uuid not null references public.organizations (id) on delete cascade,
  location_id        uuid references public.locations (id) on delete set null,
  client_session_id  uuid not null references public.client_sessions (id) on delete cascade,
  invocation_url     text not null,
  bundle_id          text,
  app_clip_version   text,
  device_token       text,
  notification_authorization text
    check (notification_authorization in ('ephemeral', 'authorized', 'provisional', 'denied', 'not_determined')),
  ephemeral_expires_at timestamptz,
  launched_at        timestamptz not null default now(),
  last_seen_at       timestamptz not null default now()
);
create index app_clip_sessions_session_idx on public.app_clip_sessions (client_session_id, launched_at desc);
create index app_clip_sessions_org_idx on public.app_clip_sessions (organization_id, launched_at desc);

-- ---------------------------------------------------------------------
-- notification_deliveries : preuve d'envoi
-- ---------------------------------------------------------------------
-- Aucune interface ne prétend "notification envoyée" sans une ligne ici
-- passée à l'état 'sent' par le fournisseur (APNs / Web Push).
create table public.notification_deliveries (
  id              bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  queue_entry_id  uuid references public.queue_entries (id) on delete set null,
  entry_public_id text,
  subscription_id uuid references public.notification_subscriptions (id) on delete set null,
  channel         public.notification_channel,
  kind            public.notification_kind not null,
  status          public.delivery_status not null default 'queued',
  provider_message_id text,
  http_status     int,
  error           text,
  title           text,
  body            text,
  payload         jsonb not null default '{}'::jsonb,
  attempts        int not null default 0,
  created_at      timestamptz not null default now(),
  sent_at         timestamptz
);
create index notification_deliveries_entry_idx on public.notification_deliveries (queue_entry_id, created_at desc);
create index notification_deliveries_org_idx on public.notification_deliveries (organization_id, created_at desc);
create index notification_deliveries_status_idx on public.notification_deliveries (status, created_at desc);
