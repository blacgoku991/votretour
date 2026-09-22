-- =====================================================================
-- VotreTour — 0007 : API transactionnelle de la file
-- ---------------------------------------------------------------------
-- Ces fonctions sont SECURITY DEFINER et réservées à service_role : le
-- serveur Next.js les appelle après avoir authentifié l'appelant,
-- vérifié l'appartenance au tenant et appliqué la limitation de débit.
-- Aucune n'est exposée à anon ni à authenticated.
--
-- Codes d'erreur applicatifs (SQLSTATE) :
--   VT001 file fermée        VT006 transition interdite
--   VT002 file en pause      VT007 organisation suspendue
--   VT003 file pleine        VT008 aucun professionnel disponible
--   VT004 déjà dans la file  VT009 session invalide
--   VT005 introuvable        VT010 professionnel déjà occupé
-- =====================================================================

-- ---------------------------------------------------------------------
-- Sérialisation
-- ---------------------------------------------------------------------
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
    'notified',      e.notification_status
  );
$$;

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
    'staffName',   (select s.display_name from public.staff s where s.id = e.staff_id)
  );
$$;

create or replace function internal.log_queue_event(
  p_entry         public.queue_entries,
  p_event_type    text,
  p_from          public.entry_status,
  p_to            public.entry_status,
  p_actor         public.actor_type,
  p_actor_user_id uuid,
  p_actor_staff_id uuid,
  p_payload       jsonb default '{}'::jsonb
) returns void
language sql
as $$
  insert into public.queue_events (
    organization_id, location_id, queue_id, entry_id, entry_public_id,
    actor, actor_user_id, actor_staff_id, event_type, from_status, to_status, payload
  ) values (
    p_entry.organization_id, p_entry.location_id, p_entry.queue_id, p_entry.id, p_entry.public_id,
    p_actor, p_actor_user_id, p_actor_staff_id, p_event_type, p_from, p_to, coalesce(p_payload, '{}'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------
-- Transition unitaire
-- ---------------------------------------------------------------------
create or replace function internal.apply_transition(
  p_entry_id       uuid,
  p_to             public.entry_status,
  p_actor          public.actor_type,
  p_actor_user_id  uuid,
  p_actor_staff_id uuid,
  p_event_type     text,
  p_payload        jsonb default '{}'::jsonb
) returns public.queue_entries
language plpgsql
as $$
declare
  v_before public.queue_entries;
  v_after  public.queue_entries;
begin
  select * into v_before from public.queue_entries where id = p_entry_id for update;
  if not found then
    raise exception 'Ticket introuvable' using errcode = 'VT005';
  end if;

  if v_before.status = p_to then
    return v_before;
  end if;

  if not internal.allowed_transition(v_before.status, p_to) then
    raise exception 'Transition interdite: % -> %', v_before.status, p_to
      using errcode = 'VT006';
  end if;

  update public.queue_entries e
     set status = p_to,
         called_at = case
           when p_to = 'next' then now()
           when p_to in ('notified', 'serving') then coalesce(e.called_at, now())
           when p_to = 'waiting' then null
           else e.called_at end,
         returning_at = case when p_to = 'returning' then now() else e.returning_at end,
         present_at   = case when p_to = 'present'   then now() else e.present_at end,
         service_started_at = case
           when p_to = 'serving' then coalesce(e.service_started_at, now())
           when p_to = 'waiting' then null
           else e.service_started_at end,
         completed_at = case when p_to = 'completed' then now()
                             when p_to = 'waiting' then null else e.completed_at end,
         cancelled_at = case when p_to = 'cancelled' then now()
                             when p_to = 'waiting' then null else e.cancelled_at end,
         absent_at    = case when p_to = 'absent' then now()
                             when p_to = 'waiting' then null else e.absent_at end,
         expired_at   = case when p_to = 'expired' then now()
                             when p_to = 'waiting' then null else e.expired_at end,
         served_by_staff_id = case
           when p_to in ('serving', 'completed')
             then coalesce(e.served_by_staff_id, p_actor_staff_id, e.staff_id)
           else e.served_by_staff_id end
   where e.id = p_entry_id
  returning * into v_after;

  perform internal.log_queue_event(
    v_after, p_event_type, v_before.status, p_to,
    p_actor, p_actor_user_id, p_actor_staff_id, p_payload
  );

  return v_after;
end;
$$;

-- ---------------------------------------------------------------------
-- Promotion du suivant
-- ---------------------------------------------------------------------
-- Appelée sous verrou de file. Choisit la tête de file dans le bon
-- périmètre (global en file commune, par professionnel sinon) et la
-- passe en prestation ou en "prochain" selon advance_mode.
create or replace function internal.promote_next(
  p_queue_id       uuid,
  p_staff_id       uuid,
  p_actor          public.actor_type,
  p_actor_user_id  uuid,
  p_actor_staff_id uuid
) returns public.queue_entries
language plpgsql
as $$
declare
  v_queue   public.queues;
  v_target  public.entry_status;
  v_head    public.queue_entries;
  v_busy    boolean;
begin
  select * into v_queue from public.queues where id = p_queue_id;
  if not found or v_queue.status <> 'open' then
    return null;
  end if;

  v_target := case v_queue.advance_mode when 'auto_serve' then 'serving' else 'next' end;

  -- Un professionnel ne sert qu'une personne à la fois.
  if v_target = 'serving' then
    select exists (
      select 1 from public.queue_entries e
      where e.queue_id = p_queue_id
        and e.status = 'serving'
        and (
          (p_staff_id is not null and e.staff_id is not distinct from p_staff_id)
          or (p_staff_id is null and v_queue.mode = 'shared')
        )
    ) into v_busy;
    if v_busy then
      return null;
    end if;
  else
    select exists (
      select 1 from public.queue_entries e
      where e.queue_id = p_queue_id
        and e.status = 'next'
        and (v_queue.mode = 'shared' or e.staff_id is not distinct from p_staff_id)
    ) into v_busy;
    if v_busy then
      return null;
    end if;
  end if;

  select * into v_head
  from public.queue_entries e
  where e.queue_id = p_queue_id
    and e.status in ('waiting', 'notified', 'returning', 'present')
    and (
      v_queue.mode = 'shared'
      or e.staff_id is not distinct from p_staff_id
    )
    -- En file commune, un client ayant choisi un professionnel précis
    -- n'est pris que par celui-ci.
    and (
      v_queue.mode <> 'shared'
      or e.staff_id is null
      or p_staff_id is null
      or e.staff_id = p_staff_id
    )
  order by internal.status_rank(e.status), e.sort_order, e.joined_at, e.id
  limit 1
  for update skip locked;

  if not found then
    return null;
  end if;

  if v_queue.mode = 'shared' and p_staff_id is not null and v_head.staff_id is null then
    update public.queue_entries set staff_id = p_staff_id where id = v_head.id;
  end if;

  return internal.apply_transition(
    v_head.id, v_target, p_actor, p_actor_user_id, p_actor_staff_id,
    case v_target when 'serving' then 'auto_start_serving' else 'auto_call_next' end,
    jsonb_build_object('promoted', true)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Réordonnancement
-- ---------------------------------------------------------------------
-- Calcule le sort_order permettant de placer un ticket p_by places plus
-- loin dans son périmètre, sans réécrire toute la file.
create or replace function internal.sort_order_for_offset(
  p_entry public.queue_entries,
  p_by    int
) returns double precision
language plpgsql
as $$
declare
  v_queue   public.queues;
  v_peers   uuid[];
  v_index   int;
  v_target  int;
  v_before  double precision;
  v_after   double precision;
begin
  select * into v_queue from public.queues where id = p_entry.queue_id;

  select array_agg(e.id order by internal.status_rank(e.status), e.sort_order, e.joined_at, e.id)
    into v_peers
  from public.queue_entries e
  where e.queue_id = p_entry.queue_id
    and public.entry_is_active(e.status)
    and (v_queue.mode = 'shared' or e.staff_id is not distinct from p_entry.staff_id);

  v_index := array_position(v_peers, p_entry.id);
  if v_index is null then
    return internal.next_sort_order(p_entry.queue_id);
  end if;

  v_target := least(v_index + p_by, coalesce(array_length(v_peers, 1), v_index));

  if v_target >= coalesce(array_length(v_peers, 1), 0) then
    return internal.next_sort_order(p_entry.queue_id);
  end if;

  select sort_order into v_before from public.queue_entries where id = v_peers[v_target];
  select sort_order into v_after  from public.queue_entries where id = v_peers[v_target + 1];

  if v_after is null then
    return v_before + 1000;
  end if;
  return (v_before + v_after) / 2.0;
end;
$$;

-- ---------------------------------------------------------------------
-- Résolution d'une URL publique /e/{slug}
-- ---------------------------------------------------------------------
create or replace function public.resolve_entry_point(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_reg      public.slug_registry;
  v_location public.locations;
  v_plate    public.plates;
  v_queue    public.queues;
  v_org      public.organizations;
  v_settings public.organization_settings;
begin
  select * into v_reg from public.slug_registry where slug = lower(trim(p_slug));
  if not found then
    return null;
  end if;

  if v_reg.kind = 'plate' then
    select * into v_plate from public.plates where id = v_reg.ref_id;
    if not found or not v_plate.is_active then return null; end if;
    select * into v_location from public.locations where id = v_plate.location_id;
    if v_plate.queue_id is not null then
      select * into v_queue from public.queues where id = v_plate.queue_id;
    end if;
  else
    select * into v_location from public.locations where id = v_reg.ref_id;
  end if;

  if not found or v_location.id is null or not v_location.is_active then
    return null;
  end if;

  select * into v_org from public.organizations where id = v_location.organization_id;
  if v_org.status <> 'active' then
    return jsonb_build_object('status', 'suspended');
  end if;

  if v_queue.id is null then
    select * into v_queue from public.queues
    where location_id = v_location.id
    order by is_default desc, created_at
    limit 1;
  end if;

  select * into v_settings from public.organization_settings where organization_id = v_org.id;

  return jsonb_build_object(
    'status', 'ok',
    'slug', v_reg.slug,
    'organization', jsonb_build_object(
      'id', v_org.id,
      'name', v_org.name,
      'activity', v_org.activity,
      'logoUrl', v_org.logo_url
    ),
    'location', jsonb_build_object(
      'id', v_location.id,
      'name', v_location.name,
      'slug', v_location.slug,
      'city', v_location.city,
      'addressLine1', v_location.address_line1,
      'postalCode', v_location.postal_code,
      'latitude', v_location.latitude,
      'longitude', v_location.longitude,
      'mapsUrl', v_location.maps_url,
      'phone', v_location.phone,
      'logoUrl', coalesce(v_location.logo_url, v_org.logo_url),
      'coverUrl', v_location.cover_url,
      'timezone', v_location.timezone,
      'hasReviewLink', v_location.google_review_url is not null
    ),
    'plate', case when v_plate.id is null then null else jsonb_build_object(
      'id', v_plate.id,
      'code', v_plate.code,
      'label', v_plate.label,
      'kind', v_plate.kind,
      'staffId', v_plate.staff_id
    ) end,
    'queue', case when v_queue.id is null then null else jsonb_build_object(
      'id', v_queue.id,
      'name', v_queue.name,
      'mode', v_queue.mode,
      'status', v_queue.status,
      'askClientName', v_queue.ask_client_name,
      'clientNameRequired', v_queue.client_name_required,
      'allowStaffChoice', v_queue.allow_staff_choice,
      'allowServiceChoice', v_queue.allow_service_choice,
      'pauseReason', v_queue.pause_reason,
      'waitingCount', (
        select count(*) from public.queue_entries e
        where e.queue_id = v_queue.id and public.entry_is_active(e.status)
      )
    ) end,
    'settings', jsonb_build_object(
      'showPeopleAhead', coalesce(v_settings.show_people_ahead, true),
      'allowClientLeave', coalesce(v_settings.allow_client_leave, true),
      'brandAccent', coalesce(v_settings.brand_accent, 'signal'),
      'locale', coalesce(v_settings.default_locale, 'fr')
    ),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.display_name, 'roleTitle', s.role_title,
               'avatarUrl', s.avatar_url, 'accent', s.accent,
               'onBreak', s.is_on_break,
               'waiting', (select count(*) from public.queue_entries e
                           where e.staff_id = s.id and e.queue_id = v_queue.id
                             and public.entry_is_active(e.status))
             ) order by s.sort_order, s.display_name)
      from public.staff s
      where s.location_id = v_location.id and s.is_active and s.accepts_queue
    ), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', sv.id, 'name', sv.name, 'durationMinutes', sv.duration_minutes,
               'priceCents', sv.price_cents
             ) order by sv.sort_order, sv.name)
      from public.services sv
      where sv.location_id = v_location.id and sv.is_active
    ), '[]'::jsonb)
  );
end;
$$;
