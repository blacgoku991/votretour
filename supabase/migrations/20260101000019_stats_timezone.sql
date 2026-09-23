-- =====================================================================
-- Statistiques : jours et heures dans le fuseau de l'établissement
-- =====================================================================
--
-- location_stats découpait byDay et byHour dans le fuseau de la session
-- PostgreSQL (UTC en production). Pour un commerce à Paris, les heures
-- d'affluence apparaissaient décalées d'une à deux heures, et les
-- clients arrivés entre minuit et 2 h étaient comptés la veille. Les
-- deux découpages suivent désormais locations.timezone.
-- =====================================================================

create or replace function public.location_stats(
  p_location_id uuid,
  p_from        timestamptz default (now() - interval '30 days'),
  p_to          timestamptz default now()
) returns jsonb
language sql
security definer
set search_path = public, internal, extensions
as $$
  with tz as (
    select coalesce(
      (select timezone from public.locations where id = p_location_id), 'Europe/Paris'
    ) as name
  ),
  base as (
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
        select (joined_at at time zone (select name from tz))::date as d,
               count(*) as j,
               count(*) filter (where status = 'completed') as c
        from base group by 1
      ) t), '[]'::jsonb),
    'byHour', coalesce((
      select jsonb_agg(jsonb_build_object('hour', h, 'joined', j) order by h)
      from (
        select extract(hour from joined_at at time zone (select name from tz))::int as h, count(*) as j
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
