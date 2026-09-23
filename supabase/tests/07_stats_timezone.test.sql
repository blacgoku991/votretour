-- =====================================================================
-- Rangvia — statistiques dans le fuseau de l'établissement
-- ---------------------------------------------------------------------
-- Les heures d'affluence et les jours de location_stats se lisent à
-- l'heure du commerce, pas à celle du serveur (UTC).
-- =====================================================================

\set ON_ERROR_STOP on

do $$
declare
  v_owner uuid := '99999999-9999-4999-8999-999999999991';
  v_prov  jsonb;
  v_org   uuid; v_loc uuid; v_queue uuid;
  v_s1    uuid; v_s2 uuid;
  v_e1    uuid; v_e2 uuid;
  v_stats jsonb;
begin
  raise notice '';
  raise notice '══ Statistiques dans le fuseau de l''établissement ══';

  delete from public.organizations where slug = 'stats-fuseau';
  delete from auth.users where id = v_owner;
  insert into auth.users (id, email) values (v_owner, 'owner@stats.test');

  v_prov  := public.provision_organization(v_owner, 'Stats Fuseau', 'barber', 'Stats Fuseau Centre');
  v_org   := (v_prov -> 'organization' ->> 'id')::uuid;
  v_loc   := (v_prov -> 'location' ->> 'id')::uuid;
  v_queue := (v_prov -> 'queue' ->> 'id')::uuid;
  update public.locations set timezone = 'Europe/Paris' where id = v_loc;
  perform public.set_queue_status(v_queue, 'open', v_owner);

  v_s1 := (public.upsert_client_session(v_org, 'hash-stats-1', 'web', 'Un') ->> 'id')::uuid;
  v_s2 := (public.upsert_client_session(v_org, 'hash-stats-2', 'web', 'Deux') ->> 'id')::uuid;
  perform public.join_queue(v_queue, v_s1, 'Un');
  perform public.join_queue(v_queue, v_s2, 'Deux');
  select id into v_e1 from public.queue_entries where client_session_id = v_s1;
  select id into v_e2 from public.queue_entries where client_session_id = v_s2;

  -- 15 juillet 2026 à 08:30 UTC = 10:30 à Paris (heure d'été).
  -- 15 juillet 2026 à 23:30 UTC = 16 juillet, 01:30 à Paris.
  update public.queue_entries set joined_at = '2026-07-15 08:30:00+00' where id = v_e1;
  update public.queue_entries set joined_at = '2026-07-15 23:30:00+00' where id = v_e2;

  v_stats := public.location_stats(v_loc, '2026-07-01 00:00:00+00', '2026-08-01 00:00:00+00');

  perform internal.assert(
    v_stats -> 'byHour' @> '[{"hour": 10, "joined": 1}]'::jsonb,
    'une arrivée à 08:30 UTC compte dans l''heure de 10 h à Paris');
  perform internal.assert(
    not (v_stats -> 'byHour' @> '[{"hour": 8}]'::jsonb),
    'et pas dans l''heure de 8 h du serveur');
  perform internal.assert(
    v_stats -> 'byDay' @> '[{"day": "2026-07-16", "joined": 1}]'::jsonb,
    'une arrivée à 01:30 heure de Paris compte le 16, pas la veille');
  perform internal.assert(
    v_stats -> 'byDay' @> '[{"day": "2026-07-15", "joined": 1}]'::jsonb,
    'l''arrivée du matin reste le 15');

  delete from public.organizations where id = v_org;
  delete from auth.users where id = v_owner;

  raise notice '';
  raise notice '✅ Statistiques : fuseau de l''établissement respecté.';
end
$$;
