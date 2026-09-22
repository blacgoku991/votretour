-- =====================================================================
-- VotreTour — 0005 : abonnements, audit, supervision plateforme
-- =====================================================================

-- ---------------------------------------------------------------------
-- plans : les offres SaaS (tarifs configurables côté super-admin)
-- ---------------------------------------------------------------------
create table public.plans (
  id                uuid primary key default extensions.gen_random_uuid(),
  code              text not null unique check (code ~ '^[a-z][a-z0-9_]{1,30}$'),
  name              text not null,
  tagline           text,
  description       text,
  currency          text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  price_month_cents int not null default 0 check (price_month_cents >= 0),
  price_year_cents  int not null default 0 check (price_year_cents >= 0),
  stripe_product_id     text,
  stripe_price_id_month text,
  stripe_price_id_year  text,
  trial_days        int not null default 14 check (trial_days between 0 and 90),
  -- Quotas. -1 = illimité.
  max_locations     int not null default 1,
  max_staff         int not null default 2,
  max_plates        int not null default 2,
  max_queues        int not null default 1,
  history_days      int not null default 7,
  features          jsonb not null default '{}'::jsonb,
  is_active         boolean not null default true,
  is_public         boolean not null default true,
  sort_order        int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger plans_touch
  before update on public.plans
  for each row execute function internal.touch_updated_at();

-- ---------------------------------------------------------------------
-- subscriptions : l'abonnement d'une organisation
-- ---------------------------------------------------------------------
create table public.subscriptions (
  id                uuid primary key default extensions.gen_random_uuid(),
  organization_id   uuid not null unique references public.organizations (id) on delete cascade,
  plan_id           uuid not null references public.plans (id) on delete restrict,
  status            public.subscription_status not null default 'trialing',
  billing_interval  text not null default 'month' check (billing_interval in ('month', 'year')),
  stripe_customer_id     text,
  stripe_subscription_id text unique,
  current_period_start   timestamptz,
  current_period_end     timestamptz,
  trial_ends_at     timestamptz,
  cancel_at_period_end boolean not null default false,
  canceled_at       timestamptz,
  -- Surcharges manuelles accordées par le super-admin (quota offert…).
  quota_overrides   jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index subscriptions_status_idx on public.subscriptions (status);
create index subscriptions_stripe_customer_idx on public.subscriptions (stripe_customer_id);

create trigger subscriptions_touch
  before update on public.subscriptions
  for each row execute function internal.touch_updated_at();

-- Journal brut des webhooks Stripe : idempotence des traitements.
create table public.billing_events (
  id              bigint generated always as identity primary key,
  provider        text not null default 'stripe',
  event_id        text not null,
  event_type      text not null,
  organization_id uuid references public.organizations (id) on delete set null,
  payload         jsonb not null,
  processed_at    timestamptz,
  error           text,
  created_at      timestamptz not null default now()
);
create unique index billing_events_unique on public.billing_events (provider, event_id);

-- ---------------------------------------------------------------------
-- audit_logs : qui a fait quoi, quand
-- ---------------------------------------------------------------------
create table public.audit_logs (
  id              bigint generated always as identity primary key,
  organization_id uuid references public.organizations (id) on delete set null,
  actor           public.actor_type not null default 'system',
  actor_user_id   uuid references public.profiles (id) on delete set null,
  actor_label     text,
  action          text not null,
  target_type     text,
  target_id       text,
  ip_hash         text,
  user_agent      text,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index audit_logs_org_idx on public.audit_logs (organization_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs (actor_user_id, created_at desc);
create index audit_logs_action_idx on public.audit_logs (action, created_at desc);

-- ---------------------------------------------------------------------
-- system_errors : remontée d'incidents visible par le super-admin
-- ---------------------------------------------------------------------
create table public.system_errors (
  id              bigint generated always as identity primary key,
  level           text not null default 'error' check (level in ('warn', 'error', 'fatal')),
  source          text not null,
  message         text not null,
  stack           text,
  organization_id uuid references public.organizations (id) on delete set null,
  fingerprint     text,
  occurrences     int not null default 1,
  context         jsonb not null default '{}'::jsonb,
  resolved_at     timestamptz,
  resolved_by     uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  last_seen_at    timestamptz not null default now()
);
create index system_errors_open_idx on public.system_errors (last_seen_at desc) where resolved_at is null;
create unique index system_errors_fingerprint_idx on public.system_errors (fingerprint) where fingerprint is not null and resolved_at is null;

-- ---------------------------------------------------------------------
-- rate_limits : compteur à fenêtre glissante, côté serveur
-- ---------------------------------------------------------------------
create table public.rate_limits (
  bucket_key   text primary key,
  window_start timestamptz not null default now(),
  hits         int not null default 0,
  expires_at   timestamptz not null
);
create index rate_limits_expiry_idx on public.rate_limits (expires_at);

-- Incrémente et vérifie un compteur. Retourne true si l'appel est
-- autorisé. Atomique : deux requêtes concurrentes ne peuvent pas
-- dépasser la limite.
create or replace function public.consume_rate_limit(
  p_key       text,
  p_max       int,
  p_window_seconds int
) returns table (allowed boolean, remaining int, retry_after_seconds int)
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_now   timestamptz := now();
  v_row   public.rate_limits%rowtype;
begin
  insert into public.rate_limits as rl (bucket_key, window_start, hits, expires_at)
  values (p_key, v_now, 1, v_now + make_interval(secs => p_window_seconds))
  on conflict (bucket_key) do update
    set hits = case
          when rl.expires_at <= v_now then 1
          else rl.hits + 1
        end,
        window_start = case
          when rl.expires_at <= v_now then v_now
          else rl.window_start
        end,
        expires_at = case
          when rl.expires_at <= v_now then v_now + make_interval(secs => p_window_seconds)
          else rl.expires_at
        end
  returning * into v_row;

  return query
  select v_row.hits <= p_max,
         greatest(p_max - v_row.hits, 0),
         greatest(ceil(extract(epoch from (v_row.expires_at - v_now)))::int, 0);
end;
$$;

revoke all on function public.consume_rate_limit(text, int, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- support : tickets ouverts par les professionnels
-- ---------------------------------------------------------------------
create table public.support_tickets (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  created_by      uuid references public.profiles (id) on delete set null,
  subject         text not null check (length(trim(subject)) between 3 and 140),
  category        text not null default 'question'
    check (category in ('question', 'bug', 'billing', 'plates', 'feature', 'other')),
  status          text not null default 'open'
    check (status in ('open', 'pending', 'resolved', 'closed')),
  priority        text not null default 'normal'
    check (priority in ('low', 'normal', 'high', 'urgent')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  resolved_at     timestamptz
);
create index support_tickets_org_idx on public.support_tickets (organization_id, created_at desc);
create index support_tickets_status_idx on public.support_tickets (status, created_at desc);

create trigger support_tickets_touch
  before update on public.support_tickets
  for each row execute function internal.touch_updated_at();

create table public.support_messages (
  id          bigint generated always as identity primary key,
  ticket_id   uuid not null references public.support_tickets (id) on delete cascade,
  organization_id uuid not null references public.organizations (id) on delete cascade,
  author_id   uuid references public.profiles (id) on delete set null,
  is_staff_reply boolean not null default false,
  body        text not null check (length(trim(body)) between 1 and 8000),
  created_at  timestamptz not null default now()
);
create index support_messages_ticket_idx on public.support_messages (ticket_id, created_at);
