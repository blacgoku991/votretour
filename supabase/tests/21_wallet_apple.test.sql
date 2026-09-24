-- =====================================================================
-- Rangvia — Wallet : service web Apple (inscriptions d'appareils)
-- ---------------------------------------------------------------------
-- Ce que le service web Apple attend de la base : inscription et
-- désinscription d'appareils (au plus 5 par pass), liste des passes à
-- rafraîchir depuis une étiquette de version, jetons à pousser, jetons
-- morts, et un pass effacé qui ne répond plus.
--
--   DBNAME=votretour_w0 ./scripts/verify-db.sh
-- =====================================================================

\set ON_ERROR_STOP on
\timing off

create or replace function internal.wallet_test_ok(p_condition boolean, p_label text)
returns void language plpgsql as $$
begin
  if p_condition is not true then
    raise exception 'ÉCHEC: %', p_label;
  end if;
  raise notice '  ok  %', p_label;
end;
$$;

create or replace function internal.wallet_test_eq(p_actual anyelement, p_expected anyelement, p_label text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'ÉCHEC: % (attendu %, obtenu %)', p_label, p_expected, p_actual;
  end if;
  raise notice '  ok  % = %', p_label, p_actual;
end;
$$;

do $$
declare
  v_owner  uuid := extensions.gen_random_uuid();
  v_prov   jsonb;
  v_org    uuid;
  v_queue  uuid;
  v_s1     uuid;
  v_s2     uuid;
  v_pub1   text;
  v_pub2   text;
  v_apple  jsonb := '{"passTypeId":"pass.test.rangvia"}';
  v_res    jsonb;
  v_p1     uuid;
  v_p2     uuid;
  v_serial1 text;
  v_serial2 text;
  v_token  text := repeat('a1', 32);
  v_i      int;
  v_seq    bigint;
  v_lookup record;
  v_tokens text[];
begin
  raise notice '';
  raise notice '══ Wallet : Apple ══';

  insert into auth.users (id, email) values (v_owner, 'wallet-apple-owner@test.local');
  v_prov  := public.provision_organization(v_owner, 'Wallet Pomme', 'barber', 'Wallet Pomme Centre');
  v_org   := (v_prov -> 'organization' ->> 'id')::uuid;
  v_queue := (v_prov -> 'queue' ->> 'id')::uuid;
  perform public.set_queue_status(v_queue, 'open', v_owner);

  v_s1 := (public.upsert_client_session(v_org, 'wallet-apple-1', 'web') ->> 'id')::uuid;
  v_s2 := (public.upsert_client_session(v_org, 'wallet-apple-2', 'web') ->> 'id')::uuid;
  v_pub1 := public.join_queue(v_queue, v_s1, null, null, null, 'qr') -> 'entry' ->> 'id';
  v_pub2 := public.join_queue(v_queue, v_s2, null, null, null, 'qr') -> 'entry' ->> 'id';

  v_res := public.wallet_issue_pass('apple', v_pub1, v_s1, null, v_apple);
  v_p1 := (v_res ->> 'id')::uuid;
  v_serial1 := v_res ->> 'externalId';
  v_res := public.wallet_issue_pass('apple', v_pub2, v_s2, null, v_apple);
  v_p2 := (v_res ->> 'id')::uuid;
  v_serial2 := v_res ->> 'externalId';

  -- ─────────────────────────────────────────────────────────────────
  raise notice '── 1. Inscription ──';
  perform internal.wallet_test_eq(public.wallet_apple_register(v_serial1, 'iphone-de-test-01', v_token),
    'created', 'premier appareil : inscrit');
  perform internal.wallet_test_ok(
    (select live and holder_state = 'saved' from public.wallet_passes where id = v_p1),
    'le pass est désormais tenu à jour');
  perform internal.wallet_test_ok(
    exists (select 1 from public.wallet_outbox where wallet_pass_id = v_p1 and status = 'pending'
              and reasons = array['register']),
    'une synchronisation suit l''inscription (état changé depuis le téléchargement ?)');
  perform internal.wallet_test_eq(public.wallet_apple_register(v_serial1, 'iphone-de-test-01', v_token),
    'exists', 'même appareil : déjà inscrit');

  perform internal.wallet_test_eq(public.wallet_apple_register(v_serial1, 'iphone-de-test-01', repeat('b2', 32)),
    'exists', 'nouveau jeton push pour un appareil connu');
  perform internal.wallet_test_eq(
    (select push_token from public.wallet_apple_devices where device_library_identifier = 'iphone-de-test-01'),
    repeat('b2', 32), 'le jeton est mis à jour');

  for v_i in 2 .. 5 loop
    perform internal.wallet_test_eq(
      public.wallet_apple_register(v_serial1, 'appareil-de-test-0' || v_i, repeat(lpad(v_i::text, 2, 'c'), 32)),
      'created', 'appareil ' || v_i || ' inscrit');
  end loop;
  perform internal.wallet_test_eq(
    public.wallet_apple_register(v_serial1, 'appareil-de-test-06', repeat('d6', 32)),
    'limit', 'sixième appareil : refusé');
  perform internal.wallet_test_ok(
    not exists (select 1 from public.wallet_apple_devices where device_library_identifier = 'appareil-de-test-06'),
    'l''appareil refusé n''est pas conservé');

  perform internal.wallet_test_eq(public.wallet_apple_register('ZZZZZZZZZZZZZZZZZZZZZZ', 'iphone-de-test-01', v_token),
    'gone', 'numéro de série inconnu : absent');
  begin
    perform public.wallet_apple_register(v_serial1, 'x', v_token);
    raise exception 'ÉCHEC: identifiant d''appareil malformé accepté';
  exception when invalid_parameter_value then
    raise notice '  ok  identifiant d''appareil malformé : refusé avant toute écriture';
  end;
  begin
    perform public.wallet_apple_register(v_serial1, 'iphone-de-test-01', 'pas-un-jeton');
    raise exception 'ÉCHEC: jeton push malformé accepté';
  exception when invalid_parameter_value then
    raise notice '  ok  jeton push malformé : refusé';
  end;

  -- ─────────────────────────────────────────────────────────────────
  raise notice '── 2. Service web : consultation ──';
  select * into v_lookup from public.wallet_apple_lookup(v_serial1);
  perform internal.wallet_test_ok(v_lookup.id = v_p1 and v_lookup.state = 'active',
    'consultation par numéro de série');
  perform internal.wallet_test_ok(not exists (select 1 from public.wallet_apple_lookup('ZZZZZZZZZZZZZZZZZZZZZZ')),
    'numéro de série inconnu : rien');

  perform public.wallet_apple_register(v_serial2, 'iphone-de-test-01', repeat('b2', 32));
  select version_seq into v_seq from public.wallet_passes where id = v_p1;
  perform public.wallet_record_render(v_p2, 'rendu-apple-2');
  perform internal.wallet_test_eq(
    (select array_agg(serial order by serial) from public.wallet_apple_serials('iphone-de-test-01', 'pass.test.rangvia', null)),
    (select array_agg(s order by s) from unnest(array[v_serial1, v_serial2]) s),
    'sans étiquette : tous les passes de l''appareil');
  perform internal.wallet_test_eq(
    (select array_agg(serial) from public.wallet_apple_serials('iphone-de-test-01', 'pass.test.rangvia', v_seq)),
    array[v_serial2], 'depuis une étiquette : seulement les passes modifiés depuis');
  perform internal.wallet_test_ok(
    not exists (select 1 from public.wallet_apple_serials('iphone-de-test-01', 'pass.autre.type', null)),
    'un autre type de pass : rien');

  select public.wallet_apple_push_targets(v_p1) into v_tokens;
  perform internal.wallet_test_eq(cardinality(v_tokens), 5, 'cinq jetons à pousser pour le pass 1');

  -- ─────────────────────────────────────────────────────────────────
  raise notice '── 3. Désinscription ──';
  perform internal.wallet_test_ok(public.wallet_apple_unregister(v_serial1, 'appareil-de-test-05'),
    'désinscription d''un appareil');
  perform internal.wallet_test_ok(
    not exists (select 1 from public.wallet_apple_devices where device_library_identifier = 'appareil-de-test-05'),
    'appareil sans autre pass : supprimé');
  perform internal.wallet_test_ok(not public.wallet_apple_unregister(v_serial1, 'appareil-de-test-05'),
    'seconde désinscription : sans effet');
  perform internal.wallet_test_ok((select live from public.wallet_passes where id = v_p1),
    'il reste des appareils : le pass est toujours tenu à jour');

  perform public.wallet_apple_unregister(v_serial2, 'iphone-de-test-01');
  perform internal.wallet_test_ok(
    exists (select 1 from public.wallet_apple_devices where device_library_identifier = 'iphone-de-test-01'),
    'appareil encore inscrit ailleurs : conservé');
  perform internal.wallet_test_ok(
    (select not live and holder_state = 'removed' from public.wallet_passes where id = v_p2),
    'plus aucun appareil : le pass n''est plus tenu à jour');
  update public.queue_entries set people_ahead = people_ahead + 3
   where id = (select queue_entry_id from public.wallet_passes where id = v_p2);
  perform internal.wallet_test_ok(
    not exists (select 1 from public.wallet_outbox where wallet_pass_id = v_p2 and status = 'pending'
                  and created_at = now() and 'position' = any (reasons)),
    'et plus rien n''est mis en file pour lui');

  -- ─────────────────────────────────────────────────────────────────
  raise notice '── 4. Jetons morts (APNs) ──';
  perform internal.wallet_test_eq(
    public.wallet_apple_drop_tokens(array[repeat('c2', 32), repeat('c3', 32)]), 2,
    'deux appareils au jeton mort : supprimés');
  perform internal.wallet_test_ok((select live from public.wallet_passes where id = v_p1),
    'il reste des appareils valides : le pass reste tenu à jour');
  perform public.wallet_apple_drop_tokens(array[repeat('b2', 32), repeat('c4', 32)]);
  perform internal.wallet_test_ok(
    (select not live and holder_state = 'removed' from public.wallet_passes where id = v_p1),
    'dernier jeton mort : le pass n''est plus tenu à jour');
  perform internal.wallet_test_eq(public.wallet_apple_drop_tokens('{}'), 0, 'liste vide : rien');

  -- ─────────────────────────────────────────────────────────────────
  raise notice '── 5. Pass révoqué ou effacé ──';
  update public.wallet_passes set state = 'revoked', revoked_at = now() where id = v_p2;
  perform internal.wallet_test_eq(public.wallet_apple_register(v_serial2, 'iphone-de-test-07', v_token),
    'gone', 'pass révoqué : l''inscription répond « absent »');
  update public.wallet_passes set state = 'scrubbed', scrubbed_at = now() where id = v_p1;
  perform internal.wallet_test_eq(public.wallet_apple_register(v_serial1, 'iphone-de-test-07', v_token),
    'gone', 'pass effacé : l''inscription répond « absent »');
  perform internal.wallet_test_eq(cardinality(public.wallet_apple_push_targets(v_p1)), 0,
    'pass effacé : aucun jeton à pousser');
  perform internal.wallet_test_ok(
    not exists (select 1 from public.wallet_apple_serials('iphone-de-test-07', 'pass.test.rangvia', null)),
    'un pass effacé ne figure plus dans aucune liste');
  select * into v_lookup from public.wallet_apple_lookup(v_serial1);
  perform internal.wallet_test_eq(v_lookup.state, 'scrubbed', 'la consultation dit l''état (le service web répond 401)');

  -- ─────────────────────────────────────────────────────────────────
  raise notice '── 6. Droits ──';
  begin
    execute 'set local role anon';
    perform public.wallet_apple_register(v_serial1, 'iphone-de-test-08', v_token);
    execute 'reset role';
    raise exception 'ÉCHEC: anon a inscrit un appareil';
  exception when insufficient_privilege then
    execute 'reset role';
    raise notice '  ok  anon ne peut pas inscrire d''appareil';
  end;
  begin
    execute 'set local role authenticated';
    perform count(*) from public.wallet_apple_devices;
    execute 'reset role';
    raise exception 'ÉCHEC: authenticated a lu les jetons push';
  exception when insufficient_privilege then
    execute 'reset role';
    raise notice '  ok  aucun compte ne lit les jetons push';
  end;

  raise notice '';
  raise notice '✅ Wallet (Apple) : tous les tests passent.';
end
$$;
