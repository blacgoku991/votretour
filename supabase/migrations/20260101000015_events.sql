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
  last_ticket_number  int not null default 0 check (last_ticket_number >= 0),
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

create unique index if not exists event_access_passes_one_active_per_entry_event
  on public.event_access_passes(event_id, queue_entry_id)
  where status in ('issued','redeemed');
create index if not exists event_access_passes_event_idx
  on public.event_access_passes(event_id, status, issued_at desc);
create index if not exists event_access_passes_hash_idx
  on public.event_access_passes(token_hash);

-- Garde-fou multi-tenant : même le service_role ne peut pas créer un
-- événement ou un pass reliant des ressources de deux organisations.
create or replace function internal.assert_event_campaign_consistency()
returns trigger
language plpgsql
as $$
declare
  v_queue public.queues;
begin
  select * into v_queue from public.queues where id = new.queue_id;
  if not found then
    raise exception 'File introuvable pour événement';
  end if;
  if v_queue.organization_id <> new.organization_id
     or v_queue.location_id <> new.location_id then
    raise exception 'Incohérence multi-tenant événement';
  end if;
  return new;
end;
$$;

create trigger event_campaigns_tenant_guard
  before insert or update of organization_id, location_id, queue_id
  on public.event_campaigns
  for each row execute function internal.assert_event_campaign_consistency();

create or replace function internal.assert_event_pass_consistency()
returns trigger
language plpgsql
as $$
declare
  v_event public.event_campaigns;
  v_entry public.queue_entries;
begin
  select * into v_event from public.event_campaigns where id = new.event_id;
  if not found then
    raise exception 'Événement introuvable pour laisser-passer';
  end if;

  select * into v_entry from public.queue_entries where id = new.queue_entry_id;
  if not found then
    raise exception 'Ticket introuvable pour laisser-passer';
  end if;

  if v_event.organization_id <> new.organization_id
     or v_event.location_id <> new.location_id
     or v_entry.organization_id <> new.organization_id
     or v_entry.location_id <> new.location_id
     or v_entry.queue_id <> v_event.queue_id then
    raise exception 'Incohérence multi-tenant laisser-passer';
  end if;

  return new;
end;
$$;

create trigger event_access_passes_tenant_guard
  before insert or update of event_id, organization_id, location_id, queue_entry_id
  on public.event_access_passes
  for each row execute function internal.assert_event_pass_consistency();

-- Numéro humain stable de file pour l'Event : A-001, A-002…
-- Attribution transactionnelle : deux arrivées simultanées ne peuvent
-- jamais recevoir le même numéro.
create or replace function internal.assign_event_ticket_number()
returns trigger
language plpgsql
as $$
declare
  v_event public.event_campaigns;
  v_number int;
begin
  select * into v_event
  from public.event_campaigns
  where queue_id = new.queue_id
    and status in ('live','paused')
  order by started_at desc nulls last, created_at desc
  limit 1
  for update;

  if not found then
    return new;
  end if;

  update public.event_campaigns
     set last_ticket_number = last_ticket_number + 1
   where id = v_event.id
  returning last_ticket_number into v_number;

  update public.queue_entries
     set metadata = coalesce(metadata, '{}'::jsonb)
       || jsonb_build_object(
            'eventId', v_event.id,
            'eventTicketNumber', v_number
          )
   where id = new.id;

  return new;
end;
$$;

create trigger queue_entries_event_ticket_number
  after insert on public.queue_entries
  for each row execute function internal.assign_event_ticket_number();

-- Sérialisation client/pro : expose uniquement le numéro humain Event,
-- jamais le bearer secret du laisser-passer.
create or replace function internal.entry_json_client(e public.queue_entries)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id',          e.public_id,
    'name',        e.client_name,
    'status',      e.status,
    'peopleAhead', e.people_ahead,
    'joinedAt',    e.joined_at,
    'calledAt',    e.called_at,
    'returningAt', e.returning_at,
    'serviceStartedAt', e.service_started_at,
    'completedAt', e.completed_at,
    'staffName',   (select s.display_name from public.staff s where s.id = e.staff_id),
    'eventId',     e.metadata ->> 'eventId',
    'eventTicketNumber', nullif(e.metadata ->> 'eventTicketNumber', '')::int
  );
$$;

create or replace function internal.entry_json_staff(e public.queue_entries)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id',            e.public_id,
    'name',          e.client_name,
    'status',        e.status,
    'peopleAhead',   e.people_ahead,
    'staffId',       e.staff_id,
    'serviceId',     e.service_id,
    'source',        e.source,
    'note',          e.staff_note,
    'rejoinCount',   e.rejoin_count,
    'joinedAt',      e.joined_at,
    'calledAt',      e.called_at,
    'returningAt',   e.returning_at,
    'presentAt',     e.present_at,
    'serviceStartedAt', e.service_started_at,
    'completedAt',   e.completed_at,
    'absentAt',      e.absent_at,
    'notified',      e.notification_status,
    'eventId',       e.metadata ->> 'eventId',
    'eventTicketNumber', nullif(e.metadata ->> 'eventTicketNumber', '')::int
  );
$$;

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

  -- Avant une nouvelle vague, libère immédiatement les accès expirés
  -- et leurs tickets. La fonction est idempotente et verrouillée.
  perform public.expire_event_passes();

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

      select * into v_entry
      from public.queue_entries
      where id = v_pass.queue_entry_id
      for update;

      if found and public.entry_is_active(v_entry.status) then
        v_entry := internal.apply_transition(
          v_entry.id,
          'absent',
          'system',
          null,
          null,
          'event_access_expired',
          jsonb_build_object(
            'eventId', v_pass.event_id,
            'passPublicId', v_pass.public_id
          )
        );
        perform public.recompute_queue_positions(v_event.queue_id);
      end if;
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

-- Expire automatiquement les accès qui n'ont pas été utilisés après la
-- fenêtre de grâce. Le ticket sort alors de la file en tant qu'absent :
-- il ne bloque pas les vagues suivantes.
create or replace function public.expire_event_passes()
returns table(queue_id uuid, expired int)
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_pass public.event_access_passes;
  v_entry public.queue_entries;
  v_event public.event_campaigns;
begin
  for v_pass in
    select p.*
    from public.event_access_passes p
    where p.status = 'issued'
      and p.grace_until < now()
    order by p.grace_until
    for update skip locked
  loop
    update public.event_access_passes
       set status = 'expired'
     where id = v_pass.id
       and status = 'issued';

    if not found then
      continue;
    end if;

    select * into v_event
    from public.event_campaigns
    where id = v_pass.event_id;

    select * into v_entry
    from public.queue_entries
    where id = v_pass.queue_entry_id
    for update;

    if found and public.entry_is_active(v_entry.status) then
      v_entry := internal.apply_transition(
        v_entry.id,
        'absent',
        'system',
        null,
        null,
        'event_access_expired',
        jsonb_build_object(
          'eventId', v_pass.event_id,
          'passPublicId', v_pass.public_id
        )
      );
      perform public.recompute_queue_positions(v_event.queue_id);
    end if;

    queue_id := v_event.queue_id;
    expired := 1;
    return next;
  end loop;
end;
$$;

revoke all on function public.issue_event_wave(uuid, uuid, int) from public, anon, authenticated;
revoke all on function public.redeem_event_pass(text, uuid) from public, anon, authenticated;
revoke all on function public.close_event_campaign(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.expire_event_passes() from public, anon, authenticated;
grant execute on function public.issue_event_wave(uuid, uuid, int) to service_role;
grant execute on function public.redeem_event_pass(text, uuid) to service_role;
grant execute on function public.close_event_campaign(uuid, uuid, text) to service_role;
grant execute on function public.expire_event_passes() to service_role;
