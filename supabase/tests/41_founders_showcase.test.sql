-- =====================================================================
-- Rangvia — les dix premiers commerces du site public (0041)
-- ---------------------------------------------------------------------
-- Le pied du site montre les dix premiers commerces inscrits, du 1er au
-- 10e. Ce test tient les règles que la base garantit seule :
--
--   - personne sans accord : l'accord est faux par défaut, sans heure ;
--     l'heure est posée par la base, un retrait l'efface, une heure
--     fournie à la main est ignorée ;
--   - l'ordre est celui de la création de l'organisation (puis
--     l'identifiant), pas celui de l'accord ni de l'insertion ;
--   - seuls les commerces ACTIFS apparaissent ; dix au plus, places 1 à 10
--     sans trou ; un volontaire au-delà attend (founders_showcase_place) ;
--   - rien que la place, le nom et la ville (celle du premier
--     établissement actif qui en a une) ;
--   - fonctions SECURITY DEFINER, search_path figé, refusées à anon et à
--     authenticated ; un membre ne peut pas écrire l'accord lui-même.
--
-- Tout se joue dans une transaction annulée à la fin.
-- =====================================================================

\set ON_ERROR_STOP on
\timing off

begin;

create or replace function internal.assert(p_condition boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_condition is not true then
    raise exception 'ÉCHEC: %', p_label;
  end if;
  raise notice '  ok  %', p_label;
end;
$$;

create or replace function internal.assert_eq(p_actual anyelement, p_expected anyelement, p_label text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'ÉCHEC: % (attendu %, obtenu %)', p_label, p_expected, p_actual;
  end if;
  raise notice '  ok  % = %', p_label, p_actual;
end;
$$;

-- La vitrine, en une ligne lisible : « 1:Commerce 02 (Paris) | 2:… ».
create or replace function internal.test_showcase()
returns text language sql as $$
  select coalesce(string_agg(place || ':' || name || coalesce(' (' || city || ')', ''), ' | ' order by place), '')
  from public.founders_showcase();
$$;

do $$
declare
  v_owner  uuid;
  v_prov   jsonb;
  v_orgs   uuid[] := '{}';
  v_locs   uuid[] := '{}';
  v_at     timestamptz;
  v_role   text;
  v_def    record;
  i        int;
begin
  raise notice '';
  raise notice '── Les dix premiers commerces : founders_showcase ──';

  -- Ardoise propre : aucun volontaire hérité d'un autre test.
  update public.organization_settings set founders_opt_in = false where founders_opt_in;
  perform internal.assert_eq(internal.test_showcase(), '', 'aucun volontaire : vitrine vide');

  -- Treize commerces, créés dans le DÉSORDRE (13 d'abord) : l'ordre de la
  -- vitrine doit venir de created_at, pas de l'ordre d'insertion.
  for i in reverse 13..1 loop
    v_owner := extensions.gen_random_uuid();
    insert into auth.users (id, email) values (v_owner, format('founder-%s@test.local', i));
    v_prov := public.provision_organization(
      v_owner, format('Commerce %s', lpad(i::text, 2, '0')), 'barber',
      format('Commerce %s — boutique', lpad(i::text, 2, '0')), 'shared', 'starter');
    v_orgs[i] := (v_prov -> 'organization' ->> 'id')::uuid;
    v_locs[i] := (v_prov -> 'location' ->> 'id')::uuid;
    update public.organizations
       set created_at = timestamptz '2026-01-01 09:00+00' + make_interval(days => i)
     where id = v_orgs[i];
    update public.locations set city = format('Ville %s', lpad(i::text, 2, '0')) where id = v_locs[i];
  end loop;

  -- 1. Accord : faux par défaut, sans heure.
  perform internal.assert(
    (select bool_and(not founders_opt_in and founders_opt_in_at is null)
       from public.organization_settings where organization_id = any (v_orgs)),
    'accord faux par défaut, sans heure, pour un nouveau commerce');
  perform internal.assert_eq(internal.test_showcase(), '', 'treize commerces sans accord : vitrine vide');

  -- 2. L'heure de l'accord vient de la base.
  update public.organization_settings
     set founders_opt_in = true, founders_opt_in_at = timestamptz '2000-01-01 00:00+00'
   where organization_id = v_orgs[7];
  select founders_opt_in_at into v_at from public.organization_settings where organization_id = v_orgs[7];
  perform internal.assert_eq(v_at, now(), 'accord : heure posée par la base (heure fournie ignorée)');

  update public.organization_settings set founders_opt_in_at = timestamptz '2001-01-01 00:00+00'
   where organization_id = v_orgs[7];
  select founders_opt_in_at into v_at from public.organization_settings where organization_id = v_orgs[7];
  perform internal.assert_eq(v_at, now(), 'heure d’accord non réécrivable sans changer l’accord');

  update public.organization_settings set founders_opt_in_at = now() where organization_id = v_orgs[8];
  select founders_opt_in_at into v_at from public.organization_settings where organization_id = v_orgs[8];
  perform internal.assert(v_at is null, 'pas d’heure d’accord sans accord');

  begin
    alter table public.organization_settings disable trigger organization_settings_founders_stamp;
    update public.organization_settings set founders_opt_in = true, founders_opt_in_at = null
     where organization_id = v_orgs[8];
    raise exception 'ÉCHEC: un accord sans heure a été accepté';
  exception when check_violation then
    raise notice '  ok  un accord sans heure est refusé (contrainte)';
  end;
  alter table public.organization_settings enable trigger organization_settings_founders_stamp;

  -- 3. Trois volontaires, déclarés dans le désordre : 7, 2, 4.
  update public.organization_settings set founders_opt_in = true
   where organization_id in (v_orgs[2], v_orgs[4]);
  perform internal.assert_eq(internal.test_showcase(),
    '1:Commerce 02 (Ville 02) | 2:Commerce 04 (Ville 04) | 3:Commerce 07 (Ville 07)',
    'trois volontaires, dans l’ordre de création');
  perform internal.assert_eq(public.founders_showcase_place(v_orgs[4]), 2, 'place du 2ᵉ volontaire');
  perform internal.assert(public.founders_showcase_place(v_orgs[3]) is null, 'pas de place sans accord');

  -- 4. Retrait : l'heure s'efface, la place se libère, les suivants avancent.
  update public.organization_settings set founders_opt_in = false where organization_id = v_orgs[2];
  select founders_opt_in_at into v_at from public.organization_settings where organization_id = v_orgs[2];
  perform internal.assert(v_at is null, 'retrait : l’heure d’accord est effacée');
  perform internal.assert_eq(internal.test_showcase(),
    '1:Commerce 04 (Ville 04) | 2:Commerce 07 (Ville 07)', 'retrait : les suivants avancent');
  -- Revenir ne fait ni gagner ni perdre de place : l'ordre est la création.
  update public.organization_settings set founders_opt_in = true where organization_id = v_orgs[2];
  perform internal.assert_eq(public.founders_showcase_place(v_orgs[2]), 1, 'retour : même rang qu’avant');

  -- 5. Ville : premier établissement ACTIF qui en a une ; espaces retirés ;
  --    sans ville, rien (jamais une ville devinée).
  update public.locations set city = '   ' where id = v_locs[4];
  update public.locations set city = '  Saint-Étienne  ' where id = v_locs[7];
  perform internal.assert_eq(internal.test_showcase(),
    '1:Commerce 02 (Ville 02) | 2:Commerce 04 | 3:Commerce 07 (Saint-Étienne)',
    'ville vide : absente ; ville entourée d’espaces : nettoyée');
  update public.locations set is_active = false where id = v_locs[2];
  perform internal.assert_eq(
    (select city from public.founders_showcase() where place = 1), null::text,
    'la ville d’un établissement désactivé n’est pas montrée');

  -- 6. Seuls les commerces actifs.
  update public.organizations set status = 'suspended' where id = v_orgs[4];
  perform internal.assert_eq(internal.test_showcase(),
    '1:Commerce 02 | 2:Commerce 07 (Saint-Étienne)', 'commerce suspendu : retiré de la vitrine');
  perform internal.assert(public.founders_showcase_place(v_orgs[4]) is null, 'commerce suspendu : aucune place');
  update public.organizations set status = 'pending_deletion' where id = v_orgs[4];
  perform internal.assert_eq((select count(*)::int from public.founders_showcase()), 2,
    'commerce en cours de suppression : retiré de la vitrine');
  update public.organizations set status = 'active' where id = v_orgs[4];

  -- 7. Dix au plus : treize volontaires, places 1 à 10 sans trou.
  update public.organization_settings set founders_opt_in = true where organization_id = any (v_orgs);
  perform internal.assert_eq((select count(*)::int from public.founders_showcase()), 10, 'dix places au plus');
  perform internal.assert_eq(
    (select string_agg(place::text, ',' order by place) from public.founders_showcase()),
    '1,2,3,4,5,6,7,8,9,10', 'places 1 à 10, sans trou');
  perform internal.assert_eq((select name from public.founders_showcase() where place = 10), 'Commerce 10',
    'le 10ᵉ est le 10ᵉ créé');
  perform internal.assert_eq(public.founders_showcase_place(v_orgs[12]), 12, 'le 12ᵉ volontaire attend');
  -- Une place se libère : le 11ᵉ entre.
  update public.organization_settings set founders_opt_in = false where organization_id = v_orgs[3];
  perform internal.assert_eq((select name from public.founders_showcase() where place = 10), 'Commerce 11',
    'une place libérée : le suivant entre');

  -- 8. Égalité de date de création : l'identifiant départage, toujours pareil.
  update public.organizations set created_at = timestamptz '2025-06-01 09:00+00'
   where id in (v_orgs[5], v_orgs[6]);
  perform internal.assert_eq(
    (select string_agg(name, ',' order by place) from public.founders_showcase() where place <= 2),
    (select string_agg(format('Commerce %s', lpad(x.i::text, 2, '0')), ',' order by x.id)
       from (values (5, v_orgs[5]), (6, v_orgs[6])) as x(i, id)),
    'même date de création : ordre stable par identifiant');

  -- 9. Rien que la place, le nom et la ville.
  perform internal.assert_eq(pg_get_function_result('public.founders_showcase()'::regprocedure),
    'TABLE(place integer, name text, city text)', 'colonnes renvoyées');

  -- 10. Droits.
  for v_def in
    select p.oid::regprocedure::text as fn, p.prosecdef, p.proconfig
    from pg_proc p
    where p.oid in ('public.founders_showcase()'::regprocedure,
                    'public.founders_showcase_place(uuid)'::regprocedure,
                    'internal.founders_queue()'::regprocedure)
  loop
    perform internal.assert(v_def.prosecdef, v_def.fn || ' : SECURITY DEFINER');
    perform internal.assert(
      v_def.proconfig @> array['search_path=public, internal, extensions'], v_def.fn || ' : search_path figé');
  end loop;
  perform internal.assert(
    has_function_privilege('service_role', 'public.founders_showcase()', 'execute')
      and has_function_privilege('service_role', 'public.founders_showcase_place(uuid)', 'execute'),
    'service_role peut lire la vitrine');
  perform internal.assert(
    not has_column_privilege('authenticated', 'public.organization_settings', 'founders_opt_in', 'update')
      and not has_column_privilege('anon', 'public.organization_settings', 'founders_opt_in', 'update'),
    'ni anon ni un membre ne peuvent écrire l’accord eux-mêmes');

  foreach v_role in array array['anon', 'authenticated'] loop
    begin
      execute format('set local role %I', v_role);
      perform public.founders_showcase();
      raise exception 'ÉCHEC: % a lu la vitrine', v_role;
    exception when insufficient_privilege then
      raise notice '  ok  vitrine refusée pour %', v_role;
    end;
    reset role;
    begin
      execute format('set local role %I', v_role);
      perform public.founders_showcase_place(v_orgs[1]);
      raise exception 'ÉCHEC: % a lu une place', v_role;
    exception when insufficient_privilege then
      raise notice '  ok  place refusée pour %', v_role;
    end;
    reset role;
  end loop;

  raise notice '✅ Les dix premiers commerces : accord, ordre, dix places, rien que le nom et la ville';
end
$$;

rollback;
