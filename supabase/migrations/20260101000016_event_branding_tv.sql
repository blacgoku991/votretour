-- =====================================================================
-- Rangvia — 0016 : Event branding, médias et écrans TV appairés
-- =====================================================================

-- ---------------------------------------------------------------------
-- Personnalisation avancée des événements / drops
-- ---------------------------------------------------------------------
alter table public.event_campaigns
  add column if not exists hero_title text
    check (hero_title is null or length(hero_title) <= 140),
  add column if not exists logo_url text
    check (logo_url is null or logo_url ~* '^https?://'),
  add column if not exists cover_url text
    check (cover_url is null or cover_url ~* '^https?://'),
  add column if not exists accent_hex text not null default '#FF4B1F'
    check (accent_hex ~ '^#[0-9A-Fa-f]{6}$'),
  add column if not exists rules_text text
    check (rules_text is null or length(rules_text) <= 2400),
  add column if not exists qr_label text
    check (qr_label is null or length(qr_label) <= 120);

comment on column public.event_campaigns.hero_title is
  'Titre d accueil optionnel affiché sur l écran Event.';
comment on column public.event_campaigns.logo_url is
  'Logo propre à l événement. Prend le dessus sur le logo établissement.';
comment on column public.event_campaigns.cover_url is
  'Visuel de couverture propre à l événement.';
comment on column public.event_campaigns.accent_hex is
  'Couleur d accent de l événement au format #RRGGBB.';
comment on column public.event_campaigns.rules_text is
  'Règles et consignes publiques de l événement.';
comment on column public.event_campaigns.qr_label is
  'Libellé associé au QR public de l événement.';

-- ---------------------------------------------------------------------
-- Codes d appairage temporaires des écrans
-- ---------------------------------------------------------------------
create table if not exists public.display_pair_codes (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id     uuid not null references public.locations(id) on delete cascade,
  queue_id        uuid not null references public.queues(id) on delete cascade,
  event_id        uuid references public.event_campaigns(id) on delete set null,
  display_name    text not null default 'Écran TV'
                  check (length(trim(display_name)) between 1 and 80),
  code_hash       text not null,
  expires_at      timestamptz not null,
  consumed_at     timestamptz,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);

create index if not exists display_pair_codes_lookup_idx
  on public.display_pair_codes(code_hash, expires_at)
  where consumed_at is null;
create unique index if not exists display_pair_codes_unconsumed_code_idx
  on public.display_pair_codes(code_hash)
  where consumed_at is null;

-- ---------------------------------------------------------------------
-- Écrans appairés : un jeton opaque persiste côté TV, son hash en base
-- ---------------------------------------------------------------------
create table if not exists public.display_devices (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id     uuid not null references public.locations(id) on delete cascade,
  queue_id        uuid not null references public.queues(id) on delete cascade,
  event_id        uuid references public.event_campaigns(id) on delete set null,
  name            text not null default 'Écran TV'
                  check (length(trim(name)) between 1 and 80),
  token_hash      text not null unique,
  status          text not null default 'active'
                  check (status in ('active','revoked')),
  paired_at       timestamptz not null default now(),
  last_seen_at    timestamptz,
  revoked_at      timestamptz,
  created_by      uuid references public.profiles(id) on delete set null,
  updated_at      timestamptz not null default now()
);

create index if not exists display_devices_org_idx
  on public.display_devices(organization_id, status, paired_at desc);
create index if not exists display_devices_token_idx
  on public.display_devices(token_hash)
  where status = 'active';

drop trigger if exists display_devices_touch on public.display_devices;
create trigger display_devices_touch
  before update on public.display_devices
  for each row execute function internal.touch_updated_at();

-- ---------------------------------------------------------------------
-- Garde-fou multi-tenant : l écran, la file, le site et l Event doivent
-- toujours appartenir au même tenant.
-- ---------------------------------------------------------------------
create or replace function internal.assert_display_binding_consistency()
returns trigger
language plpgsql
as $$
declare
  v_queue public.queues;
  v_event public.event_campaigns;
begin
  select * into v_queue from public.queues where id = new.queue_id;
  if not found then
    raise exception 'File introuvable pour écran';
  end if;

  if v_queue.organization_id <> new.organization_id
     or v_queue.location_id <> new.location_id then
    raise exception 'Incohérence multi-tenant écran';
  end if;

  if new.event_id is not null then
    select * into v_event from public.event_campaigns where id = new.event_id;
    if not found then
      raise exception 'Événement introuvable pour écran';
    end if;

    if v_event.organization_id <> new.organization_id
       or v_event.location_id <> new.location_id
       or v_event.queue_id <> new.queue_id then
      raise exception 'Événement incompatible avec cet écran';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists display_pair_codes_tenant_guard on public.display_pair_codes;
create trigger display_pair_codes_tenant_guard
  before insert or update of organization_id, location_id, queue_id, event_id
  on public.display_pair_codes
  for each row execute function internal.assert_display_binding_consistency();

drop trigger if exists display_devices_tenant_guard on public.display_devices;
create trigger display_devices_tenant_guard
  before insert or update of organization_id, location_id, queue_id, event_id
  on public.display_devices
  for each row execute function internal.assert_display_binding_consistency();

-- Consommation atomique d un code d appairage. Une même combinaison
-- à six chiffres ne peut donc créer qu un seul écran.
create or replace function public.consume_display_pair_code(
  p_code_hash text,
  p_token_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_pair public.display_pair_codes;
  v_device public.display_devices;
begin
  select * into v_pair
  from public.display_pair_codes
  where code_hash = p_code_hash
    and consumed_at is null
    and expires_at > now()
  for update;

  if not found then
    return null;
  end if;

  insert into public.display_devices (
    organization_id,
    location_id,
    queue_id,
    event_id,
    name,
    token_hash,
    created_by
  ) values (
    v_pair.organization_id,
    v_pair.location_id,
    v_pair.queue_id,
    v_pair.event_id,
    v_pair.display_name,
    p_token_hash,
    v_pair.created_by
  )
  returning * into v_device;

  update public.display_pair_codes
     set consumed_at = now()
   where id = v_pair.id;

  return jsonb_build_object(
    'id', v_device.id,
    'organizationId', v_device.organization_id,
    'locationId', v_device.location_id,
    'queueId', v_device.queue_id,
    'eventId', v_device.event_id,
    'name', v_device.name
  );
end;
$$;

alter table public.display_pair_codes enable row level security;
alter table public.display_devices enable row level security;

revoke all on table public.display_pair_codes from anon, authenticated;
revoke all on table public.display_devices from anon, authenticated;
grant all on table public.display_pair_codes to service_role;
grant all on table public.display_devices to service_role;

revoke all on function public.consume_display_pair_code(text, text)
  from public, anon, authenticated;
grant execute on function public.consume_display_pair_code(text, text)
  to service_role;
