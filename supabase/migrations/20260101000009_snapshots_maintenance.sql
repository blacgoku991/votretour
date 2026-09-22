-- =====================================================================
-- VotreTour — 0009 : instantanés, maintenance, statistiques
-- =====================================================================

-- ---------------------------------------------------------------------
-- Instantané professionnel : tout l'écran "file en cours" en un appel
-- ---------------------------------------------------------------------
create or replace function public.queue_snapshot(p_queue_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_queue    public.queues;
  v_location public.locations;
begin
  select * into v_queue from public.queues where id = p_queue_id;
  if not found then return null; end if;
  select * into v_location from public.locations where id = v_queue.location_id;

  return jsonb_build_object(
    'queue', jsonb_build_object(
      'id', v_queue.id,
      'name', v_queue.name,
      'mode', v_queue.mode,
      'status', v_queue.status,
      'advanceMode', v_queue.advance_mode,
      'absentPolicy', v_queue.absent_policy,
      'absentMoveBackBy', v_queue.absent_move_back_by,
      'notifyAheadThreshold', v_queue.notify_ahead_threshold,
      'askClientName', v_queue.ask_client_name,
      'clientNameRequired', v_queue.client_name_required,
      'allowStaffChoice', v_queue.allow_staff_choice,
      'allowServiceChoice', v_queue.allow_service_choice,
      'pauseReason', v_queue.pause_reason,
      'maxActiveEntries', v_queue.max_active_entries,
      'locationId', v_queue.location_id,
      'organizationId', v_queue.organization_id
    ),
    'location', jsonb_build_object(
      'id', v_location.id,
      'name', v_location.name,
      'slug', v_location.slug,
      'timezone', v_location.timezone,
      'googleReviewUrl', v_location.google_review_url
    ),
    'serving', coalesce((
      select jsonb_agg(internal.entry_json_staff(e)
             order by e.service_started_at nulls last, e.sort_order)
      from public.queue_entries e
      where e.queue_id = p_queue_id and e.status = 'serving'
    ), '[]'::jsonb),
    'called', coalesce((
      select jsonb_agg(internal.entry_json_staff(e) order by e.sort_order, e.joined_at)
      from public.queue_entries e
      where e.queue_id = p_queue_id and e.status = 'next'
    ), '[]'::jsonb),
    'waiting', coalesce((
      select jsonb_agg(internal.entry_json_staff(e)
             order by internal.status_rank(e.status), e.sort_order, e.joined_at)
      from public.queue_entries e
      where e.queue_id = p_queue_id
        and e.status in ('waiting', 'notified', 'returning', 'present')
    ), '[]'::jsonb),
    -- Absents et retirés récents : permettent le "remettre plus tard".
    'parked', coalesce((
      select jsonb_agg(internal.entry_json_staff(e) order by coalesce(e.absent_at, e.updated_at) desc)
      from public.queue_entries e
      where e.queue_id = p_queue_id
        and e.status in ('absent', 'skipped')
        and e.updated_at > now() - interval '6 hours'
    ), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.display_name, 'roleTitle', s.role_title,
               'avatarUrl', s.avatar_url, 'accent', s.accent,
               'isOnBreak', s.is_on_break, 'acceptsQueue', s.accepts_queue,
               'userId', s.user_id,
               'servingEntryId', (
                 select e.public_id from public.queue_entries e
                 where e.queue_id = p_queue_id and e.status = 'serving' and e.staff_id = s.id
                 limit 1
               ),
               'waitingCount', (
                 select count(*) from public.queue_entries e
                 where e.queue_id = p_queue_id and e.staff_id = s.id
                   and public.entry_is_active(e.status) and e.status <> 'serving'
               )
             ) order by s.sort_order, s.display_name)
      from public.staff s
      where s.location_id = v_queue.location_id and s.is_active
    ), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object('id', sv.id, 'name', sv.name,
                                          'durationMinutes', sv.duration_minutes)
             order by sv.sort_order, sv.name)
      from public.services sv
      where sv.location_id = v_queue.location_id and sv.is_active
    ), '[]'::jsonb),
    'counts', jsonb_build_object(
      'active', (select count(*) from public.queue_entries e
                 where e.queue_id = p_queue_id and public.entry_is_active(e.status)),
      'waiting', (select count(*) from public.queue_entries e
                  where e.queue_id = p_queue_id
                    and e.status in ('waiting','notified','returning','present')),
      'serving', (select count(*) from public.queue_entries e
                  where e.queue_id = p_queue_id and e.status = 'serving'),
      'completedToday', (select count(*) from public.queue_entries e
                         where e.queue_id = p_queue_id and e.status = 'completed'
                           and e.completed_at >= date_trunc('day', now() at time zone coalesce(v_location.timezone,'UTC')) at time zone coalesce(v_location.timezone,'UTC'))
    ),
    'generatedAt', now()
  );
end;
$$;

-- ---------------------------------------------------------------------
-- État public diffusé en temps réel aux clients
-- ---------------------------------------------------------------------
-- Ne contient AUCUNE donnée personnelle : uniquement des identifiants
-- opaques de ticket et le nombre de personnes devant. Chaque appareil y
-- reconnaît son propre ticket grâce à son public_id.
create or replace function public.public_queue_state(p_queue_id uuid)
returns jsonb
language sql
security definer
set search_path = public, internal, extensions
as $$
  select jsonb_build_object(
    'queueId', q.id,
    'status', q.status,
    'mode', q.mode,
    'waiting', (select count(*) from public.queue_entries e
                where e.queue_id = q.id
                  and e.status in ('waiting','notified','returning','present')),
    'serving', (select count(*) from public.queue_entries e
                where e.queue_id = q.id and e.status = 'serving'),
    'entries', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.public_id,
               'ahead', e.people_ahead,
               'status', e.status,
               'staffId', e.staff_id
             ) order by e.people_ahead)
      from public.queue_entries e
      where e.queue_id = q.id and public.entry_is_active(e.status)
    ), '[]'::jsonb),
    'closedEntries', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.public_id, 'status', e.status))
      from public.queue_entries e
      where e.queue_id = q.id
        and not public.entry_is_active(e.status)
        and e.updated_at > now() - interval '15 minutes'
    ), '[]'::jsonb),
    'at', now()
  )
  from public.queues q
  where q.id = p_queue_id;
$$;

-- ---------------------------------------------------------------------
-- État d'un ticket, pour le client (repli au temps réel + restauration)
-- ---------------------------------------------------------------------
create or replace function public.ticket_state(
  p_entry_public_id   text,
  p_client_session_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_entry    public.queue_entries;
  v_queue    public.queues;
  v_location public.locations;
  v_org      public.organizations;
begin
  select * into v_entry from public.queue_entries where public_id = p_entry_public_id;
  if not found then return null; end if;
  if v_entry.client_session_id is distinct from p_client_session_id then
    raise exception 'Ce ticket n''appartient pas à cette session' using errcode = 'VT009';
  end if;

  select * into v_queue from public.queues where id = v_entry.queue_id;
  select * into v_location from public.locations where id = v_entry.location_id;
  select * into v_org from public.organizations where id = v_entry.organization_id;

  return jsonb_build_object(
    'entry', internal.entry_json_client(v_entry),
    'queue', jsonb_build_object(
      'id', v_queue.id, 'status', v_queue.status, 'mode', v_queue.mode,
      'name', v_queue.name, 'pauseReason', v_queue.pause_reason,
      'waiting', (select count(*) from public.queue_entries e
                  where e.queue_id = v_queue.id and public.entry_is_active(e.status))
    ),
    'location', jsonb_build_object(
      'id', v_location.id, 'name', v_location.name, 'slug', v_location.slug,
      'city', v_location.city, 'addressLine1', v_location.address_line1,
      'postalCode', v_location.postal_code, 'phone', v_location.phone,
      'latitude', v_location.latitude, 'longitude', v_location.longitude,
      'mapsUrl', v_location.maps_url, 'logoUrl', coalesce(v_location.logo_url, v_org.logo_url),
      -- Le lien d'avis n'est révélé qu'une fois la prestation terminée.
      'googleReviewUrl', case when v_entry.status = 'completed'
                              then v_location.google_review_url else null end
    ),
    'organization', jsonb_build_object('name', v_org.name, 'logoUrl', v_org.logo_url),
    'at', now()
  );
end;
$$;

-- Retrouve automatiquement le ticket actif d'un appareil (reprise de
-- session après fermeture de l'onglet, perte réseau, retour App Clip).
create or replace function public.find_active_ticket(p_client_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_entry public.queue_entries;
begin
  select * into v_entry
  from public.queue_entries e
  where e.client_session_id = p_client_session_id
    and (
      public.entry_is_active(e.status)
      -- On garde un ticket terminé visible 30 min : c'est la fenêtre
      -- pendant laquelle on propose l'avis Google.
      or (e.status = 'completed' and e.completed_at > now() - interval '30 minutes')
    )
  order by e.joined_at desc
  limit 1;

  if not found then return null; end if;
  return public.ticket_state(v_entry.public_id, p_client_session_id);
end;
$$;

-- ---------------------------------------------------------------------
-- Maintenance : expiration des tickets oubliés
-- ---------------------------------------------------------------------
create or replace function public.expire_stale_entries()
returns table (queue_id uuid, expired int)
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
begin
  return query
  with stale as (
    select e.id, e.queue_id
    from public.queue_entries e
    join public.queues q on q.id = e.queue_id
    where public.entry_is_active(e.status)
      and e.joined_at < now() - make_interval(mins => q.entry_ttl_minutes)
  ),
  done as (
    update public.queue_entries t
       set status = 'expired', expired_at = now()
      from stale s
     where t.id = s.id
    returning t.queue_id
  )
  select d.queue_id, count(*)::int from done d group by d.queue_id;
end;
$$;

-- ---------------------------------------------------------------------
-- RGPD : purge automatique
-- ---------------------------------------------------------------------
-- Chaque organisation choisit sa durée de conservation
-- (organization_settings.data_retention_days). Au-delà, les sessions
-- clients et les prénoms sont supprimés ; seules des statistiques
-- anonymes subsistent.
create or replace function public.purge_expired_data()
returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_anonymized int := 0;
  v_sessions   int := 0;
  v_events     int := 0;
  v_deliveries int := 0;
  v_subs       int := 0;
  v_limits     int := 0;
begin
  -- 1. Anonymisation des tickets au-delà de la rétention.
  with expired as (
    select e.id
    from public.queue_entries e
    join public.organization_settings s on s.organization_id = e.organization_id
    where e.joined_at < now() - make_interval(days => s.data_retention_days)
      and (e.client_name is not null or e.client_session_id is not null)
  )
  update public.queue_entries t
     set client_name = null,
         client_session_id = null,
         staff_note = null,
         metadata = '{}'::jsonb
    from expired x
   where t.id = x.id;
  get diagnostics v_anonymized = row_count;

  -- 2. Suppression des sessions clients expirées.
  delete from public.client_sessions cs
  using public.organization_settings s
  where s.organization_id = cs.organization_id
    and (cs.expires_at < now()
         or cs.last_seen_at < now() - make_interval(days => s.data_retention_days));
  get diagnostics v_sessions = row_count;

  -- 3. Abonnements push morts.
  delete from public.notification_subscriptions
  where (expires_at is not null and expires_at < now() - interval '2 days')
     or (not is_active and updated_at < now() - interval '7 days')
     or failure_count >= 8;
  get diagnostics v_subs = row_count;

  -- 4. Historique d'événements au-delà de la rétention du plan.
  delete from public.queue_events qe
  using public.organization_settings s
  where s.organization_id = qe.organization_id
    and qe.created_at < now() - make_interval(days => greatest(s.data_retention_days, 30));
  get diagnostics v_events = row_count;

  delete from public.notification_deliveries
  where created_at < now() - interval '30 days';
  get diagnostics v_deliveries = row_count;

  delete from public.rate_limits where expires_at < now() - interval '1 hour';
  get diagnostics v_limits = row_count;

  delete from public.plate_scans where created_at < now() - interval '180 days';

  return jsonb_build_object(
    'anonymizedEntries', v_anonymized,
    'deletedSessions', v_sessions,
    'deletedSubscriptions', v_subs,
    'deletedEvents', v_events,
    'deletedDeliveries', v_deliveries,
    'deletedRateLimits', v_limits,
    'at', now()
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Statistiques d'établissement
-- ---------------------------------------------------------------------
create or replace function public.location_stats(
  p_location_id uuid,
  p_from        timestamptz default (now() - interval '30 days'),
  p_to          timestamptz default now()
) returns jsonb
language sql
security definer
set search_path = public, internal, extensions
as $$
  with base as (
    select * from public.queue_entries
    where location_id = p_location_id and joined_at >= p_from and joined_at < p_to
  ),
  served as (
    select *,
      extract(epoch from (coalesce(service_started_at, completed_at) - joined_at)) as wait_seconds,
      extract(epoch from (completed_at - coalesce(service_started_at, joined_at))) as service_seconds
    from base where status = 'completed' and completed_at is not null
  )
  select jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'totals', jsonb_build_object(
      'joined',    (select count(*) from base),
      'completed', (select count(*) from served),
      'cancelled', (select count(*) from base where status = 'cancelled'),
      'absent',    (select count(*) from base where status = 'absent'),
      'skipped',   (select count(*) from base where status = 'skipped'),
      'expired',   (select count(*) from base where status = 'expired')
    ),
    'completionRate', case when (select count(*) from base) = 0 then null
      else round(100.0 * (select count(*) from served) / (select count(*) from base), 1) end,
    'avgWaitSeconds',    (select round(avg(wait_seconds))    from served where wait_seconds >= 0),
    'medianWaitSeconds', (select round(percentile_cont(0.5) within group (order by wait_seconds))
                          from served where wait_seconds >= 0),
    'avgServiceSeconds', (select round(avg(service_seconds)) from served where service_seconds >= 0),
    'noShowRate', case when (select count(*) from base) = 0 then null
      else round(100.0 * (select count(*) from base where status in ('absent','expired'))
                 / (select count(*) from base), 1) end,
    'bySource', coalesce((
      select jsonb_object_agg(source, n) from (
        select source::text as source, count(*) as n from base group by source
      ) t), '{}'::jsonb),
    'byDay', coalesce((
      select jsonb_agg(jsonb_build_object('day', d, 'joined', j, 'completed', c) order by d)
      from (
        select date_trunc('day', joined_at)::date as d,
               count(*) as j,
               count(*) filter (where status = 'completed') as c
        from base group by 1
      ) t), '[]'::jsonb),
    'byHour', coalesce((
      select jsonb_agg(jsonb_build_object('hour', h, 'joined', j) order by h)
      from (
        select extract(hour from joined_at)::int as h, count(*) as j
        from base group by 1
      ) t), '[]'::jsonb),
    'byStaff', coalesce((
      select jsonb_agg(jsonb_build_object('staffId', st.id, 'name', st.display_name,
                                          'completed', t.n, 'avgServiceSeconds', t.avg_s)
             order by t.n desc)
      from (
        select served_by_staff_id as sid, count(*) as n, round(avg(service_seconds)) as avg_s
        from served where served_by_staff_id is not null group by 1
      ) t
      join public.staff st on st.id = t.sid), '[]'::jsonb),
    'peakConcurrent', (
      select max(cnt) from (
        select count(*) as cnt from base b1
        join base b2 on b2.joined_at <= b1.joined_at
          and coalesce(b2.completed_at, b2.cancelled_at, b2.expired_at, now()) >= b1.joined_at
        group by b1.id
      ) p)
  );
$$;

-- ---------------------------------------------------------------------
-- Statistiques globales plateforme (super-admin)
-- ---------------------------------------------------------------------
create or replace function public.platform_stats()
returns jsonb
language sql
security definer
set search_path = public, internal, extensions
as $$
  select jsonb_build_object(
    'organizations', jsonb_build_object(
      'total',     (select count(*) from public.organizations),
      'active',    (select count(*) from public.organizations where status = 'active'),
      'suspended', (select count(*) from public.organizations where status = 'suspended'),
      'newThisWeek', (select count(*) from public.organizations where created_at > now() - interval '7 days')
    ),
    'locations', (select count(*) from public.locations),
    'staff',     (select count(*) from public.staff where is_active),
    'plates',    jsonb_build_object(
      'total',  (select count(*) from public.plates),
      'active', (select count(*) from public.plates where is_active),
      'scans7d',(select count(*) from public.plate_scans where created_at > now() - interval '7 days')
    ),
    'queues', jsonb_build_object(
      'total', (select count(*) from public.queues),
      'open',  (select count(*) from public.queues where status = 'open')
    ),
    'entries', jsonb_build_object(
      'active24h',    (select count(*) from public.queue_entries where joined_at > now() - interval '24 hours'),
      'completed24h', (select count(*) from public.queue_entries where completed_at > now() - interval '24 hours'),
      'inQueueNow',   (select count(*) from public.queue_entries where public.entry_is_active(status))
    ),
    'notifications', jsonb_build_object(
      'sent24h',   (select count(*) from public.notification_deliveries
                    where status = 'sent' and created_at > now() - interval '24 hours'),
      'failed24h', (select count(*) from public.notification_deliveries
                    where status = 'failed' and created_at > now() - interval '24 hours'),
      'byChannel', coalesce((select jsonb_object_agg(channel, n) from (
                     select channel::text as channel, count(*) as n
                     from public.notification_deliveries
                     where created_at > now() - interval '7 days' and channel is not null
                     group by 1) t), '{}'::jsonb)
    ),
    'subscriptions', coalesce((select jsonb_object_agg(status, n) from (
        select status::text as status, count(*) as n from public.subscriptions group by 1) t), '{}'::jsonb),
    'errorsOpen', (select count(*) from public.system_errors where resolved_at is null),
    'at', now()
  );
$$;
