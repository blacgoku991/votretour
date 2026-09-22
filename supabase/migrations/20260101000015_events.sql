-- =====================================================================
-- Rangvia — 0015 : Event / Drop — vagues, laisser-passer et contrôle
-- =====================================================================

alter type public.notification_kind add value if not exists 'event_access';
alter type public.notification_kind add value if not exists 'event_sold_out';
alter type public.notification_kind add value if not exists 'event_ended';
alter type public.activity_type add value if not exists 'event';

create table if not exists public.event_campaigns (
  id                  uuid primary key default extensions.gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  location_id         uuid not null references public.locations(id) on delete cascade,
  queue_id            uuid not null references public.queues(id) on delete cascade,
  name                text not null check (length(trim(name)) between 2 and 120),
  status              text not null default 'draft'
                      check (status in ('draft','live','paused','sold_out','ended')),
  wave_size           int not null default 10 check (wave_size between 1 and 200),
  pass_valid_minutes  int not null default 10 check (pass_valid_minutes between 1 and 120),
  grace_minutes       int not null default 5 check (grace_minutes between 0 and 60),
  public_note         text check (public_note is null or length(public_note) <= 500),
  created_by          uuid references public.profiles(id) on delete set null,
  started_at          timestamptz,
  ended_at            timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists event_campaigns_org_idx
  on public.event_campaigns(organization_id, created_at desc);
create index if not exists event_campaigns_queue_idx
  on public.event_campaigns(queue_id, created_at desc);
create unique index if not exists event_campaigns_one_running_per_queue
  on public.event_campaigns(queue_id)
  where status in ('live','paused');

create trigger event_campaigns_touch
  before update on public.event_campaigns
  for each row execute function internal.touch_updated_at();

create table if not exists public.event_access_passes (
  id                uuid primary key default extensions.gen_random_uuid(),
  event_id          uuid not null references public.event_campaigns(id) on delete cascade,
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  location_id       uuid not null references public.locations(id) on delete cascade,
  queue_entry_id    uuid not null references public.queue_entries(id) on delete cascade,
  public_id         text not null unique default internal.generate_public_id(18),
  token_hash        text not null unique,
  status            text not null default 'issued'
                    check (status in ('issued','redeemed','expired','revoked')),
  issued_at         timestamptz not null default now(),
  valid_until       timestamptz not null,
  grace_until       timestamptz not null,
  redeemed_at       timestamptz,
  redeemed_by       uuid references public.profiles(id) on delete set null,
  revoked_at        timestamptz,
  created_at        timestamptz not null default now()
);

create unique index if not exists event_access_passes_one_per_entry_event
  on public.event_access_passes(event_id, queue_entry_id);
create index if not exists event_access_passes_event_idx
  on public.event_access_passes(event_id, status, issued_at desc);
create index if not exists event_access_passes_hash_idx
  on public.event_access_passes(token_hash);

alter table public.event_campaigns enable row level security;
alter table public.event_access_passes enable row level security;
revoke all on table public.event_campaigns from anon, authenticated;
revoke all on table public.event_access_passes from anon, authenticated;
grant all on table public.event_campaigns to service_role;
grant all on table public.event_access_passes to service_role;

create or replace function public.issue_event_wave(
  p_event_id uuid,
  p_actor_user_id uuid,
  p_count int default null
) returns table (
  entry_id uuid,
  entry_public_id text,
  pass_public_id text,
  raw_token text,
  valid_until timestamptz,
  grace_until timestamptz
)
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_event public.event_campaigns;
  v_entry public.queue_entries;
  v_token text;
  v_limit int;
  v_valid timestamptz;
  v_grace timestamptz;
  v_pass public.event_access_passes;
begin
  select * into v_event
  from public.event_campaigns
  where id = p_event_id
  for update;

  if not found then
    raise exception 'Événement introuvable' using errcode = 'VT005';
  end if;
  if v_event.status <> 'live' then
    raise exception 'Événement non actif' using errcode = 'VT006';
  end if;

  perform 1 from public.queues where id = v_event.queue_id for update;
  v_limit := least(greatest(coalesce(p_count, v_event.wave_size), 1), 200);

  -- Expire d'abord les anciens laisser-passer non utilisés.
  update public.event_access_passes
     set status = 'expired'
   where event_id = v_event.id
     and status = 'issued'
     and grace_until < now();

  for v_entry in
    select e.*
    from public.queue_entries e
    where e.queue_id = v_event.queue_id
      and e.status in ('waiting','returning','present')
      and not exists (
        select 1 from public.event_access_passes p
        where p.event_id = v_event.id
          and p.queue_entry_id = e.id
          and p.status in ('issued','redeemed')
      )
    order by internal.status_rank(e.status), e.sort_order, e.joined_at, e.id
    limit v_limit
    for update skip locked
  loop
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    v_valid := now() + make_interval(mins => v_event.pass_valid_minutes);
    v_grace := v_valid + make_interval(mins => v_event.grace_minutes);

    insert into public.event_access_passes (
      event_id, organization_id, location_id, queue_entry_id,
      token_hash, valid_until, grace_until
    ) values (
      v_event.id, v_event.organization_id, v_event.location_id, v_entry.id,
      encode(extensions.digest(v_token, 'sha256'), 'hex'), v_valid, v_grace
    )
    returning * into v_pass;

    update public.queue_entries
       set status = 'notified',
           called_at = coalesce(called_at, now()),
           metadata = coalesce(metadata, '{}'::jsonb)
             || jsonb_build_object(
                  'eventId', v_event.id,
                  'eventPassPublicId', v_pass.public_id,
                  'eventAccessIssuedAt', now()
                )
     where id = v_entry.id;

    perform internal.log_queue_event(
      v_entry, 'event_access_issued', v_entry.status, 'notified',
      'staff', p_actor_user_id, null,
      jsonb_build_object('eventId', v_event.id, 'passPublicId', v_pass.public_id)
    );

    entry_id := v_entry.id;
    entry_public_id := v_entry.public_id;
    pass_public_id := v_pass.public_id;
    raw_token := v_token;
    valid_until := v_valid;
    grace_until := v_grace;
    return next;
  end loop;

  perform public.recompute_queue_positions(v_event.queue_id);
end;
$$;

create or replace function public.redeem_event_pass(
  p_token_hash text,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_pass public.event_access_passes;
  v_event public.event_campaigns;
  v_entry public.queue_entries;
begin
  select * into v_pass
  from public.event_access_passes
  where token_hash = p_token_hash
  for update;

  if not found then
    raise exception 'Laisser-passer introuvable' using errcode = 'VT005';
  end if;

  select * into v_event from public.event_campaigns where id = v_pass.event_id;

  if v_pass.status = 'redeemed' then
    return jsonb_build_object(
      'status','already_redeemed',
      'redeemedAt',v_pass.redeemed_at,
      'eventId',v_pass.event_id,
      'queueId',v_event.queue_id
    );
  end if;

  if v_pass.status <> 'issued' or now() > v_pass.grace_until then
    if v_pass.status = 'issued' then
      update public.event_access_passes
         set status = 'expired'
       where id = v_pass.id;
    end if;
    return jsonb_build_object(
      'status','invalid',
      'eventId',v_pass.event_id,
      'queueId',v_event.queue_id
    );
  end if;

  update public.event_access_passes
     set status = 'redeemed',
         redeemed_at = now(),
         redeemed_by = p_actor_user_id
   where id = v_pass.id
   returning * into v_pass;

  select * into v_entry from public.queue_entries where id = v_pass.queue_entry_id for update;

  if public.entry_is_active(v_entry.status) then
    v_entry := internal.apply_transition(
      v_entry.id, 'completed', 'staff', p_actor_user_id, null,
      'event_access_redeemed',
      jsonb_build_object('eventId', v_pass.event_id, 'passPublicId', v_pass.public_id)
    );
    perform public.recompute_queue_positions(v_event.queue_id);
  end if;

  return jsonb_build_object(
    'status','redeemed',
    'eventId',v_pass.event_id,
    'queueId',v_event.queue_id,
    'passPublicId',v_pass.public_id,
    'entryPublicId',v_entry.public_id,
    'clientName',v_entry.client_name,
    'redeemedAt',v_pass.redeemed_at
  );
end;
$$;

create or replace function public.close_event_campaign(
  p_event_id uuid,
  p_actor_user_id uuid,
  p_reason text
) returns table(entry_id uuid, entry_public_id text)
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_event public.event_campaigns;
  v_entry public.queue_entries;
  v_status text;
begin
  select * into v_event
  from public.event_campaigns
  where id = p_event_id
  for update;

  if not found then
    raise exception 'Événement introuvable' using errcode = 'VT005';
  end if;

  v_status := case when p_reason = 'sold_out' then 'sold_out' else 'ended' end;

  update public.event_campaigns
     set status = v_status,
         ended_at = now()
   where id = v_event.id;

  -- Tous les laissez-passer non consommés sont révoqués.
  update public.event_access_passes
     set status = 'revoked',
         revoked_at = now()
   where event_id = v_event.id
     and status = 'issued';

  for v_entry in
    select e.*
    from public.queue_entries e
    where e.queue_id = v_event.queue_id
      and public.entry_is_active(e.status)
    for update
  loop
    v_entry := internal.apply_transition(
      v_entry.id, 'cancelled', 'staff', p_actor_user_id, null,
      case when p_reason = 'sold_out' then 'event_sold_out' else 'event_ended' end,
      jsonb_build_object('eventId', v_event.id)
    );
    entry_id := v_entry.id;
    entry_public_id := v_entry.public_id;
    return next;
  end loop;

  update public.queues
     set status = 'closed',
         closed_at = now(),
         pause_reason = case when p_reason = 'sold_out' then 'Stock épuisé' else 'Événement terminé' end
   where id = v_event.queue_id;

  perform public.recompute_queue_positions(v_event.queue_id);
end;
$$;

revoke all on function public.issue_event_wave(uuid, uuid, int) from public, anon, authenticated;
revoke all on function public.redeem_event_pass(text, uuid) from public, anon, authenticated;
revoke all on function public.close_event_campaign(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.issue_event_wave(uuid, uuid, int) to service_role;
grant execute on function public.redeem_event_pass(text, uuid) to service_role;
grant execute on function public.close_event_campaign(uuid, uuid, text) to service_role;
