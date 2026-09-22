-- =====================================================================
-- VotreTour — 0002 : multi-tenant (comptes, organisations, établissements)
-- ---------------------------------------------------------------------
-- Modèle : une ORGANISATION possède N ÉTABLISSEMENTS (locations), chacun
-- ayant ses employés, ses files, ses plaques et son lien d'avis Google.
-- organization_id est présent sur TOUTES les tables métier : c'est la
-- clé d'isolation unique utilisée par les policies RLS.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Registre global des slugs publics
-- ---------------------------------------------------------------------
-- /e/{slug} doit résoudre en une seule requête indexée, que le slug
-- désigne un établissement ou une plaque physique. Ce registre garantit
-- l'unicité entre les deux espaces de noms.
create table public.slug_registry (
  slug            text primary key,
  kind            text not null check (kind in ('location', 'plate')),
  organization_id uuid not null,
  ref_id          uuid not null,
  created_at      timestamptz not null default now(),
  constraint slug_registry_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$')
);
create index slug_registry_ref_idx on public.slug_registry (kind, ref_id);
create index slug_registry_org_idx on public.slug_registry (organization_id);

comment on table public.slug_registry is
  'Espace de noms partagé des URL publiques /e/{slug} (établissements + plaques).';

-- Réserve un slug libre à partir d''une base, en ajoutant un suffixe
-- court si nécessaire. Retourne le slug effectivement réservé.
create or replace function internal.reserve_slug(
  p_base            text,
  p_kind            text,
  p_organization_id uuid,
  p_ref_id          uuid
) returns text
language plpgsql
as $$
declare
  v_base      text := coalesce(internal.slugify(p_base), 'file');
  v_candidate text;
  v_attempt   int := 0;
begin
  -- Le registre impose >= 3 caractères : on rembourre les noms très courts.
  if length(v_base) < 3 then
    v_base := v_base || '-' || lower(internal.generate_public_id(4));
  end if;
  v_base := left(v_base, 48);

  loop
    v_candidate := case
      when v_attempt = 0 then v_base
      else v_base || '-' || lower(internal.generate_public_id(least(3 + v_attempt, 8)))
    end;

    begin
      insert into public.slug_registry (slug, kind, organization_id, ref_id)
      values (v_candidate, p_kind, p_organization_id, p_ref_id);
      return v_candidate;
    exception when unique_violation then
      v_attempt := v_attempt + 1;
      if v_attempt > 12 then
        raise exception 'Impossible de réserver un slug pour %', p_base;
      end if;
    end;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- profiles : miroir applicatif de auth.users
-- ---------------------------------------------------------------------
create table public.profiles (
  id                uuid primary key references auth.users (id) on delete cascade,
  email             text,
  full_name         text,
  avatar_url        text,
  phone             text,
  locale            text not null default 'fr',
  is_platform_admin boolean not null default false,
  last_seen_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index profiles_platform_admin_idx on public.profiles (id) where is_platform_admin;

comment on column public.profiles.is_platform_admin is
  'Accès super-admin plateforme. Ne peut être positionné que par le rôle service_role (voir policies RLS).';

create trigger profiles_touch
  before update on public.profiles
  for each row execute function internal.touch_updated_at();

-- Création automatique du profil à l'inscription.
create or replace function internal.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    nullif(trim(coalesce(new.raw_user_meta_data ->> 'full_name',
                         new.raw_user_meta_data ->> 'name', '')), ''),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(public.profiles.full_name, excluded.full_name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function internal.handle_new_auth_user();

-- ---------------------------------------------------------------------
-- organizations : la racine du tenant
-- ---------------------------------------------------------------------
create table public.organizations (
  id                uuid primary key default extensions.gen_random_uuid(),
  name              text not null check (length(trim(name)) between 2 and 120),
  slug              text not null unique check (slug = lower(slug)),
  activity          public.activity_type not null default 'other',
  logo_url          text,
  status            public.org_status not null default 'active',
  suspended_at      timestamptz,
  suspended_reason  text,
  onboarding_step   text not null default 'organization',
  onboarding_done_at timestamptz,
  created_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index organizations_status_idx on public.organizations (status);

create trigger organizations_touch
  before update on public.organizations
  for each row execute function internal.touch_updated_at();

-- ---------------------------------------------------------------------
-- organization_members : qui peut accéder à quel tenant
-- ---------------------------------------------------------------------
create table public.organization_members (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  user_id         uuid references public.profiles (id) on delete cascade,
  role            public.member_role not null default 'member',
  status          public.member_status not null default 'active',
  invited_email   text,
  invite_token_hash text,
  invite_expires_at timestamptz,
  invited_by      uuid references public.profiles (id) on delete set null,
  accepted_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint organization_members_identity check (
    user_id is not null or invited_email is not null
  )
);
create unique index organization_members_unique_user
  on public.organization_members (organization_id, user_id)
  where user_id is not null;
create unique index organization_members_unique_invite
  on public.organization_members (organization_id, lower(invited_email))
  where user_id is null and invited_email is not null;
create index organization_members_user_idx on public.organization_members (user_id, status);
create unique index organization_members_invite_token_idx
  on public.organization_members (invite_token_hash)
  where invite_token_hash is not null;

create trigger organization_members_touch
  before update on public.organization_members
  for each row execute function internal.touch_updated_at();

-- ---------------------------------------------------------------------
-- locations : les établissements physiques
-- ---------------------------------------------------------------------
create table public.locations (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  name              text not null check (length(trim(name)) between 1 and 120),
  slug              text not null unique references public.slug_registry (slug) on delete restrict deferrable initially deferred,
  address_line1     text,
  address_line2     text,
  postal_code       text,
  city              text,
  country_code      text not null default 'FR' check (country_code ~ '^[A-Z]{2}$'),
  latitude          double precision check (latitude between -90 and 90),
  longitude         double precision check (longitude between -180 and 180),
  phone             text,
  timezone          text not null default 'Europe/Paris',
  google_review_url text,
  google_place_id   text,
  maps_url          text,
  logo_url          text,
  cover_url         text,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint locations_review_url_is_https check (
    google_review_url is null or google_review_url ~* '^https://'
  )
);
create index locations_org_idx on public.locations (organization_id) where is_active;

create trigger locations_touch
  before update on public.locations
  for each row execute function internal.touch_updated_at();

comment on column public.locations.google_review_url is
  'Lien "Rédiger un avis" Google de CET établissement. Proposé à tous les clients en fin de passage, sans filtrage sur la satisfaction.';

-- ---------------------------------------------------------------------
-- staff : les professionnels
-- ---------------------------------------------------------------------
-- Un employé n'a pas nécessairement de compte : un barbier peut exister
-- dans la file sans jamais se connecter.
create table public.staff (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  location_id     uuid not null references public.locations (id) on delete cascade,
  user_id         uuid references public.profiles (id) on delete set null,
  display_name    text not null check (length(trim(display_name)) between 1 and 60),
  role_title      text,
  avatar_url      text,
  accent          text not null default 'signal'
    check (accent in ('signal', 'copper', 'jade', 'cobalt', 'brique', 'ardoise')),
  is_active       boolean not null default true,
  accepts_queue   boolean not null default true,
  is_on_break     boolean not null default false,
  sort_order      int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index staff_location_idx on public.staff (location_id, sort_order) where is_active;
create index staff_user_idx on public.staff (user_id) where user_id is not null;

create trigger staff_touch
  before update on public.staff
  for each row execute function internal.touch_updated_at();

-- ---------------------------------------------------------------------
-- services : prestations optionnelles proposées au client
-- ---------------------------------------------------------------------
create table public.services (
  id               uuid primary key default extensions.gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  location_id      uuid not null references public.locations (id) on delete cascade,
  name             text not null check (length(trim(name)) between 1 and 80),
  duration_minutes int check (duration_minutes between 1 and 600),
  price_cents      int check (price_cents >= 0),
  is_active        boolean not null default true,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index services_location_idx on public.services (location_id, sort_order) where is_active;

create trigger services_touch
  before update on public.services
  for each row execute function internal.touch_updated_at();

-- ---------------------------------------------------------------------
-- opening_hours : horaires hebdomadaires + exceptions datées
-- ---------------------------------------------------------------------
create table public.opening_hours (
  id          uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  weekday     smallint not null check (weekday between 0 and 6), -- 0 = lundi
  opens_at    time,
  closes_at   time,
  is_closed   boolean not null default false,
  sort_order  smallint not null default 0,
  created_at  timestamptz not null default now(),
  constraint opening_hours_range check (
    is_closed or (opens_at is not null and closes_at is not null and closes_at > opens_at)
  )
);
create index opening_hours_location_idx on public.opening_hours (location_id, weekday, sort_order);
create unique index opening_hours_slot_unique
  on public.opening_hours (location_id, weekday, sort_order);

create table public.opening_hours_overrides (
  id          uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  location_id uuid not null references public.locations (id) on delete cascade,
  on_date     date not null,
  opens_at    time,
  closes_at   time,
  is_closed   boolean not null default true,
  label       text,
  created_at  timestamptz not null default now()
);
create unique index opening_hours_overrides_unique
  on public.opening_hours_overrides (location_id, on_date);

-- ---------------------------------------------------------------------
-- organization_settings : réglages transverses au tenant
-- ---------------------------------------------------------------------
create table public.organization_settings (
  organization_id       uuid primary key references public.organizations (id) on delete cascade,
  default_locale        text not null default 'fr',
  -- RGPD : purge automatique des sessions clients et de l'historique.
  data_retention_days   int not null default 30 check (data_retention_days between 1 and 730),
  -- Expérience client
  ask_client_name       boolean not null default true,
  client_name_required  boolean not null default false,
  allow_client_leave    boolean not null default true,
  show_people_ahead     boolean not null default true,
  show_estimated_wait   boolean not null default false,
  -- Notifications
  notify_ahead_threshold int not null default 2 check (notify_ahead_threshold between 1 and 10),
  send_completion_review boolean not null default true,
  -- Marque
  brand_accent          text not null default 'signal'
    check (brand_accent in ('signal', 'copper', 'jade', 'cobalt', 'brique')),
  support_email         text,
  privacy_url           text,
  terms_url             text,
  features              jsonb not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create trigger organization_settings_touch
  before update on public.organization_settings
  for each row execute function internal.touch_updated_at();

-- Chaque organisation reçoit ses réglages par défaut dès sa création.
create or replace function internal.handle_new_organization()
returns trigger
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
begin
  insert into public.organization_settings (organization_id)
  values (new.id)
  on conflict (organization_id) do nothing;
  return new;
end;
$$;

create trigger organizations_bootstrap
  after insert on public.organizations
  for each row execute function internal.handle_new_organization();
