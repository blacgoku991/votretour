-- =====================================================================
-- VotreTour — 0008 : actions client et professionnel
-- =====================================================================

-- ---------------------------------------------------------------------
-- Session client anonyme
-- ---------------------------------------------------------------------
create or replace function public.upsert_client_session(
  p_organization_id uuid,
  p_token_hash      text,
  p_platform        public.client_platform default 'web',
  p_display_name    text default null,
  p_locale          text default 'fr',
  p_ip_hash         text default null,
  p_user_agent_hash text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_session public.client_sessions;
  v_days    int;
begin
  select coalesce(data_retention_days, 30) into v_days
  from public.organization_settings where organization_id = p_organization_id;

  insert into public.client_sessions as cs (
    organization_id, token_hash, platform, display_name, locale,
    ip_hash, user_agent_hash, expires_at
  ) values (
    p_organization_id, p_token_hash, p_platform,
    nullif(trim(coalesce(p_display_name, '')), ''), coalesce(p_locale, 'fr'),
    p_ip_hash, p_user_agent_hash,
    now() + make_interval(days => coalesce(v_days, 30))
  )
  on conflict (token_hash) do update
    set last_seen_at = now(),
        platform     = excluded.platform,
        display_name = coalesce(excluded.display_name, cs.display_name),
        locale       = coalesce(excluded.locale, cs.locale),
        ip_hash      = coalesce(excluded.ip_hash, cs.ip_hash),
        revoked_at   = null,
        expires_at   = greatest(cs.expires_at, excluded.expires_at)
  returning * into v_session;

  return jsonb_build_object(
    'id',            v_session.id,
    'publicId',      v_session.public_id,
    'organizationId', v_session.organization_id,
    'displayName',   v_session.display_name,
    'platform',      v_session.platform,
    'expiresAt',     v_session.expires_at
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Rejoindre la file
-- ---------------------------------------------------------------------
create or replace function public.join_queue(
  p_queue_id          uuid,
  p_client_session_id uuid,
  p_client_name       text default null,
  p_staff_id          uuid default null,
  p_service_id        uuid default null,
  p_source            public.entry_source default 'qr',
  p_plate_id          uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_queue   public.queues;
  v_org     public.organizations;
  v_active  int;
  v_entry   public.queue_entries;
  v_existing public.queue_entries;
  v_staff   uuid := p_staff_id;
  v_name    text := nullif(trim(coalesce(p_client_name, '')), '');
begin
  -- Verrou de file : sérialise inscriptions et avancements concurrents.
  select * into v_queue from public.queues where id = p_queue_id for update;
  if not found then
    raise exception 'File introuvable' using errcode = 'VT005';
  end if;

  select * into v_org from public.organizations where id = v_queue.organization_id;
  if v_org.status <> 'active' then
    raise exception 'Organisation suspendue' using errcode = 'VT007';
  end if;

  if v_queue.status = 'closed' then
    raise exception 'La file est fermée' using errcode = 'VT001';
  elsif v_queue.status = 'paused' then
    raise exception 'La file est en pause' using errcode = 'VT002';
  end if;

  -- Reprise idempotente : si l'appareil a déjà un ticket actif, on le
  -- renvoie au lieu d'en créer un second (retour sur la page, rescan…).
  select * into v_existing
  from public.queue_entries e
  where e.queue_id = p_queue_id
    and e.client_session_id = p_client_session_id
    and public.entry_is_active(e.status)
  limit 1;

  if found then
    return jsonb_build_object(
      'entry', internal.entry_json_client(v_existing),
      'rejoined', true,
      'queueId', p_queue_id
    );
  end if;

  if v_queue.client_name_required and v_name is null then
    raise exception 'Prénom requis' using errcode = 'VT009';
  end if;

  if v_queue.max_active_entries is not null then
    select count(*) into v_active
    from public.queue_entries e
    where e.queue_id = p_queue_id and public.entry_is_active(e.status);
    if v_active >= v_queue.max_active_entries then
      raise exception 'La file est pleine' using errcode = 'VT003';
    end if;
  end if;

  -- Le choix du professionnel n'est retenu que s'il est autorisé.
  if v_staff is not null and not (v_queue.allow_staff_choice or v_queue.mode = 'per_staff') then
    v_staff := null;
  end if;
  if v_staff is not null and not exists (
    select 1 from public.staff s
    where s.id = v_staff and s.location_id = v_queue.location_id
      and s.is_active and s.accepts_queue
  ) then
    v_staff := null;
  end if;

  -- File par professionnel sans choix explicite : on affecte le moins chargé.
  if v_queue.mode = 'per_staff' and v_staff is null then
    select s.id into v_staff
    from public.staff s
    left join public.queue_entries e
      on e.staff_id = s.id and e.queue_id = p_queue_id and public.entry_is_active(e.status)
    where s.location_id = v_queue.location_id
      and s.is_active and s.accepts_queue and not s.is_on_break
    group by s.id, s.sort_order, s.display_name
    order by count(e.id), s.sort_order, s.display_name
    limit 1;

    if v_staff is null then
      raise exception 'Aucun professionnel disponible' using errcode = 'VT008';
    end if;
  end if;

  insert into public.queue_entries (
    organization_id, location_id, queue_id, staff_id, service_id,
    client_session_id, client_name, source, plate_id, sort_order, status
  ) values (
    v_queue.organization_id, v_queue.location_id, p_queue_id, v_staff,
    case when v_queue.allow_service_choice then p_service_id else null end,
    p_client_session_id, v_name, p_source, p_plate_id,
    internal.next_sort_order(p_queue_id), 'waiting'
  )
  returning * into v_entry;

  if v_name is not null then
    update public.client_sessions
       set display_name = v_name, last_seen_at = now()
     where id = p_client_session_id;
  end if;

  if p_plate_id is not null then
    update public.plates
       set scan_count = scan_count + 1, last_scanned_at = now()
     where id = p_plate_id;
  end if;

  perform internal.log_queue_event(
    v_entry, 'join', null, 'waiting', 'client', null, null,
    jsonb_build_object('source', p_source, 'plateId', p_plate_id)
  );

  perform public.recompute_queue_positions(p_queue_id);
  perform internal.seed_notification_baseline(v_entry.id);

  select * into v_entry from public.queue_entries where id = v_entry.id;

  return jsonb_build_object(
    'entry', internal.entry_json_client(v_entry),
    'rejoined', false,
    'queueId', p_queue_id
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Actions côté client
-- ---------------------------------------------------------------------
-- p_action : 'leave' | 'returning' | 'present'
create or replace function public.client_queue_action(
  p_entry_public_id   text,
  p_client_session_id uuid,
  p_action            text
) returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_entry public.queue_entries;
  v_to    public.entry_status;
begin
  select * into v_entry from public.queue_entries where public_id = p_entry_public_id;
  if not found then
    raise exception 'Ticket introuvable' using errcode = 'VT005';
  end if;
  if v_entry.client_session_id is distinct from p_client_session_id then
    raise exception 'Ce ticket n''appartient pas à cette session' using errcode = 'VT009';
  end if;

  perform 1 from public.queues where id = v_entry.queue_id for update;

  v_to := case p_action
    when 'leave'     then 'cancelled'
    when 'returning' then 'returning'
    when 'present'   then 'present'
    else null
  end::public.entry_status;

  if v_to is null then
    raise exception 'Action client inconnue: %', p_action using errcode = 'VT006';
  end if;

  v_entry := internal.apply_transition(
    v_entry.id, v_to, 'client', null, null, 'client_' || p_action,
    jsonb_build_object('action', p_action)
  );

  perform public.recompute_queue_positions(v_entry.queue_id);
  select * into v_entry from public.queue_entries where id = v_entry.id;

  return jsonb_build_object(
    'entry', internal.entry_json_client(v_entry),
    'queueId', v_entry.queue_id
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Actions côté professionnel
-- ---------------------------------------------------------------------
-- p_action ∈ complete | start_serving | call | mark_present | mark_absent
--            | defer | remove | restore | cancel | assign_staff | note
create or replace function public.staff_queue_action(
  p_entry_public_id text,
  p_action          text,
  p_actor_user_id   uuid default null,
  p_actor_staff_id  uuid default null,
  p_options         jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_entry     public.queue_entries;
  v_queue     public.queues;
  v_promoted  public.queue_entries;
  v_policy    public.absent_policy;
  v_by        int;
  v_new_order double precision;
  v_free_staff uuid;
  v_busy      boolean;
begin
  select * into v_entry from public.queue_entries where public_id = p_entry_public_id;
  if not found then
    raise exception 'Ticket introuvable' using errcode = 'VT005';
  end if;

  select * into v_queue from public.queues where id = v_entry.queue_id for update;

  if p_actor_staff_id is not null and not exists (
    select 1 from public.staff s
    where s.id = p_actor_staff_id and s.organization_id = v_entry.organization_id
  ) then
    raise exception 'Professionnel hors organisation' using errcode = 'VT009';
  end if;

  case p_action

    when 'complete' then
      v_free_staff := coalesce(p_actor_staff_id, v_entry.staff_id, v_entry.served_by_staff_id);
      v_entry := internal.apply_transition(
        v_entry.id, 'completed', 'staff', p_actor_user_id, p_actor_staff_id,
        'complete', '{}'::jsonb
      );
      v_promoted := internal.promote_next(
        v_entry.queue_id, v_free_staff, 'staff', p_actor_user_id, p_actor_staff_id
      );

    when 'start_serving' then
      v_free_staff := coalesce(p_actor_staff_id, v_entry.staff_id);
      select exists (
        select 1 from public.queue_entries e
        where e.queue_id = v_entry.queue_id and e.status = 'serving' and e.id <> v_entry.id
          and (
            (v_free_staff is not null and e.staff_id is not distinct from v_free_staff)
            or (v_free_staff is null and v_queue.mode = 'shared')
          )
      ) into v_busy;
      if v_busy then
        raise exception 'Ce professionnel a déjà une prestation en cours'
          using errcode = 'VT010';
      end if;
      if v_queue.mode = 'shared' and v_free_staff is not null and v_entry.staff_id is null then
        update public.queue_entries set staff_id = v_free_staff where id = v_entry.id;
      end if;
      v_entry := internal.apply_transition(
        v_entry.id, 'serving', 'staff', p_actor_user_id, p_actor_staff_id, 'start_serving'
      );

    when 'call' then
      v_entry := internal.apply_transition(
        v_entry.id, 'next', 'staff', p_actor_user_id, p_actor_staff_id, 'call'
      );

    when 'mark_present' then
      v_entry := internal.apply_transition(
        v_entry.id, 'present', 'staff', p_actor_user_id, p_actor_staff_id, 'mark_present'
      );

    when 'mark_absent' then
      v_policy := coalesce(
        nullif(p_options ->> 'policy', '')::public.absent_policy,
        v_queue.absent_policy
      );
      if v_policy = 'move_back' then
        v_by := coalesce((p_options ->> 'by')::int, v_queue.absent_move_back_by);
        v_new_order := internal.sort_order_for_offset(v_entry, v_by);
        update public.queue_entries
           set sort_order = v_new_order,
               absent_at = now(),
               rejoin_count = rejoin_count + 1,
               -- Le client sera re-notifié quand son tour reviendra.
               notification_status = notification_status
                 - 'your_turn' - 'ahead_one' - 'ahead_two'
         where id = v_entry.id;
        select * into v_entry from public.queue_entries where id = v_entry.id;
        if v_entry.status <> 'waiting' then
          v_entry := internal.apply_transition(
            v_entry.id, 'waiting', 'staff', p_actor_user_id, p_actor_staff_id,
            'absent_move_back', jsonb_build_object('by', v_by)
          );
        else
          perform internal.log_queue_event(
            v_entry, 'absent_move_back', 'waiting', 'waiting',
            'staff', p_actor_user_id, p_actor_staff_id, jsonb_build_object('by', v_by)
          );
        end if;
        -- Le professionnel est libéré : on enchaîne sur le suivant.
        v_promoted := internal.promote_next(
          v_entry.queue_id, coalesce(p_actor_staff_id, v_entry.staff_id),
          'staff', p_actor_user_id, p_actor_staff_id
        );
      else
        v_free_staff := coalesce(p_actor_staff_id, v_entry.staff_id);
        v_entry := internal.apply_transition(
          v_entry.id, 'absent', 'staff', p_actor_user_id, p_actor_staff_id,
          'mark_absent', jsonb_build_object('policy', v_policy)
        );
        v_promoted := internal.promote_next(
          v_entry.queue_id, v_free_staff, 'staff', p_actor_user_id, p_actor_staff_id
        );
      end if;

    when 'defer' then
      v_by := greatest(coalesce((p_options ->> 'by')::int, v_queue.absent_move_back_by), 1);
      v_new_order := internal.sort_order_for_offset(v_entry, v_by);
      update public.queue_entries
         set sort_order = v_new_order,
             notification_status = notification_status
               - 'your_turn' - 'ahead_one' - 'ahead_two'
       where id = v_entry.id;
      select * into v_entry from public.queue_entries where id = v_entry.id;
      if v_entry.status in ('serving', 'next', 'present') then
        v_free_staff := coalesce(p_actor_staff_id, v_entry.staff_id);
        v_entry := internal.apply_transition(
          v_entry.id, 'waiting', 'staff', p_actor_user_id, p_actor_staff_id,
          'defer', jsonb_build_object('by', v_by)
        );
        v_promoted := internal.promote_next(
          v_entry.queue_id, v_free_staff, 'staff', p_actor_user_id, p_actor_staff_id
        );
      else
        perform internal.log_queue_event(
          v_entry, 'defer', v_entry.status, v_entry.status,
          'staff', p_actor_user_id, p_actor_staff_id, jsonb_build_object('by', v_by)
        );
      end if;

    when 'remove' then
      v_free_staff := coalesce(p_actor_staff_id, v_entry.staff_id);
      v_entry := internal.apply_transition(
        v_entry.id, 'skipped', 'staff', p_actor_user_id, p_actor_staff_id,
        'remove', jsonb_build_object('reason', p_options ->> 'reason')
      );
      v_promoted := internal.promote_next(
        v_entry.queue_id, v_free_staff, 'staff', p_actor_user_id, p_actor_staff_id
      );

    when 'restore' then
      update public.queue_entries
         set sort_order = case
               when (p_options ->> 'position') = 'front'
                 then coalesce((select min(sort_order) from public.queue_entries e2
                                where e2.queue_id = v_entry.queue_id
                                  and public.entry_is_active(e2.status)), 1000) - 1
               else internal.next_sort_order(v_entry.queue_id)
             end,
             rejoin_count = rejoin_count + 1,
             absent_at = null,
             notification_status = notification_status
               - 'your_turn' - 'ahead_one' - 'ahead_two'
       where id = v_entry.id;
      v_entry := internal.apply_transition(
        v_entry.id, 'waiting', 'staff', p_actor_user_id, p_actor_staff_id,
        'restore', p_options
      );

    when 'cancel' then
      v_free_staff := coalesce(p_actor_staff_id, v_entry.staff_id);
      v_entry := internal.apply_transition(
        v_entry.id, 'cancelled', 'staff', p_actor_user_id, p_actor_staff_id, 'cancel'
      );
      v_promoted := internal.promote_next(
        v_entry.queue_id, v_free_staff, 'staff', p_actor_user_id, p_actor_staff_id
      );

    when 'assign_staff' then
      update public.queue_entries
         set staff_id = nullif(p_options ->> 'staffId', '')::uuid
       where id = v_entry.id;
      select * into v_entry from public.queue_entries where id = v_entry.id;
      perform internal.log_queue_event(
        v_entry, 'assign_staff', v_entry.status, v_entry.status,
        'staff', p_actor_user_id, p_actor_staff_id, p_options
      );

    when 'note' then
      update public.queue_entries
         set staff_note = nullif(trim(coalesce(p_options ->> 'note', '')), '')
       where id = v_entry.id;
      select * into v_entry from public.queue_entries where id = v_entry.id;

    else
      raise exception 'Action inconnue: %', p_action using errcode = 'VT006';
  end case;

  perform public.recompute_queue_positions(v_entry.queue_id);
  select * into v_entry from public.queue_entries where id = v_entry.id;
  if v_promoted.id is not null then
    select * into v_promoted from public.queue_entries where id = v_promoted.id;
  end if;

  return jsonb_build_object(
    'entry', internal.entry_json_staff(v_entry),
    'promoted', case when v_promoted.id is null then null
                     else internal.entry_json_staff(v_promoted) end,
    'queueId', v_entry.queue_id,
    'organizationId', v_entry.organization_id,
    'locationId', v_entry.location_id
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Ajout manuel d'une personne par le professionnel
-- ---------------------------------------------------------------------
create or replace function public.add_walkin(
  p_queue_id       uuid,
  p_client_name    text,
  p_staff_id       uuid default null,
  p_service_id     uuid default null,
  p_actor_user_id  uuid default null,
  p_actor_staff_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_queue public.queues;
  v_entry public.queue_entries;
begin
  select * into v_queue from public.queues where id = p_queue_id for update;
  if not found then
    raise exception 'File introuvable' using errcode = 'VT005';
  end if;
  if v_queue.status = 'closed' then
    raise exception 'La file est fermée' using errcode = 'VT001';
  end if;

  insert into public.queue_entries (
    organization_id, location_id, queue_id, staff_id, service_id,
    client_name, source, sort_order, status
  ) values (
    v_queue.organization_id, v_queue.location_id, p_queue_id, p_staff_id, p_service_id,
    nullif(trim(coalesce(p_client_name, '')), ''), 'staff',
    internal.next_sort_order(p_queue_id), 'waiting'
  )
  returning * into v_entry;

  perform internal.log_queue_event(
    v_entry, 'staff_add', null, 'waiting', 'staff', p_actor_user_id, p_actor_staff_id
  );
  perform public.recompute_queue_positions(p_queue_id);
  perform internal.seed_notification_baseline(v_entry.id);
  select * into v_entry from public.queue_entries where id = v_entry.id;

  return jsonb_build_object('entry', internal.entry_json_staff(v_entry), 'queueId', p_queue_id);
end;
$$;

-- ---------------------------------------------------------------------
-- Ouverture / pause / fermeture
-- ---------------------------------------------------------------------
create or replace function public.set_queue_status(
  p_queue_id      uuid,
  p_status        public.queue_status,
  p_actor_user_id uuid default null,
  p_reason        text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_queue public.queues;
  v_closed int := 0;
begin
  update public.queues q
     set status = p_status,
         opened_at = case when p_status = 'open'   then now() else q.opened_at end,
         paused_at = case when p_status = 'paused' then now() else null end,
         closed_at = case when p_status = 'closed' then now() else null end,
         pause_reason = case when p_status = 'paused' then p_reason else null end
   where q.id = p_queue_id
  returning * into v_queue;

  if not found then
    raise exception 'File introuvable' using errcode = 'VT005';
  end if;

  insert into public.queue_events (
    organization_id, location_id, queue_id, actor, actor_user_id, event_type, payload
  ) values (
    v_queue.organization_id, v_queue.location_id, v_queue.id, 'staff', p_actor_user_id,
    'queue_' || p_status::text, jsonb_build_object('reason', p_reason)
  );

  return jsonb_build_object(
    'queueId', v_queue.id,
    'status', v_queue.status,
    'pauseReason', v_queue.pause_reason,
    'activeCount', (
      select count(*) from public.queue_entries e
      where e.queue_id = v_queue.id and public.entry_is_active(e.status)
    )
  );
end;
$$;
