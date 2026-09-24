-- =====================================================================
-- Rangvia — Wallet : registre, file d'envoi, déclencheurs, purge
-- ---------------------------------------------------------------------
-- Couvre le socle commun aux deux fournisseurs (migration 0021) :
--   * rien n'est mis en file sans pass `live` ; une seule ligne en
--     attente par pass, raisons fusionnées, moments clés prioritaires,
--     report de 20 s des changements mineurs ;
--   * réclamation exclusive par pass, bail expiré, concurrence réelle
--     (deux connexions, `skip locked`) ;
--   * version Apple strictement croissante, fin de traitement, échec ;
--   * émission idempotente et contrôle d'accès ;
--   * déclencheurs du moteur : vague, validation, expiration, clôture,
--     pause, marque ; une panne Wallet ne casse jamais une action de file ;
--   * garde multi-tenant, purge, droits (rien pour anon ni authenticated).
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

-- Nombre de lignes en attente d'un pass.
create or replace function internal.wallet_test_pending(p_pass uuid)
returns int language sql stable as $$
  select count(*)::int from public.wallet_outbox where wallet_pass_id = p_pass and status = 'pending';
$$;

-- Vide la file d'un pass, pour isoler le cas suivant.
create or replace function internal.wallet_test_clear(p_pass uuid)
returns void language sql as $$
  update public.wallet_outbox set status = 'done', locked_until = null
  where wallet_pass_id = p_pass and status in ('pending', 'processing');
$$;

-- Rend dues les lignes en attente d'un pass (le rythme de 20 s est
-- vérifié à part), puis les réclame ; renvoie la ligne de ce pass.
create or replace function internal.wallet_test_claim(p_pass uuid)
returns bigint language plpgsql as $$
declare
  v_id bigint;
begin
  update public.wallet_outbox set run_after = least(run_after, now())
  where wallet_pass_id = p_pass and status = 'pending';
  select c.id into v_id
  from public.wallet_passes p
  cross join lateral public.claim_wallet_outbox(p.provider, p.queue_id, 1000) c
  where p.id = p_pass and c.wallet_pass_id = p_pass;
  return v_id;
end;
$$;

do $$
declare
  v_owner   uuid := extensions.gen_random_uuid();
  v_rival   uuid := extensions.gen_random_uuid();
  v_prov    jsonb;
  v_org     uuid;
  v_loc     uuid;
  v_queue   uuid;
  v_org_b   uuid;
  v_loc_b   uuid;
  v_queue_b uuid;
  v_staff   uuid;
  v_s       uuid[] := '{}';
  v_pub     text[] := '{}';
  v_e       uuid[] := '{}';
  v_join    jsonb;
  v_apple   jsonb := '{"passTypeId":"pass.test.rangvia"}';
  v_google  jsonb := '{"objectPrefix":"3388000000099999999.rvtest_",
                       "queueClass":"3388000000099999999.rvtest_file_v1",
                       "eventClassPrefix":"3388000000099999999.rvtest_evt_"}';
  v_res     jsonb;
  v_snap    jsonb;
  v_before  bigint;
  v_p6a     uuid;   -- Apple, ticket 6 (« Zébulon »)
  v_p6g     uuid;   -- Google, ticket 6
  v_p3a     uuid;
  v_p2a     uuid;
  v_p5a     uuid;
  v_p5g     uuid;
  v_p4a     uuid;
  v_row     record;
  v_r1      bigint;
  v_r2      bigint;
  v_ver1    record;
  v_ver2    record;
  v_ver3    record;
  v_ver4    record;
  v_event   uuid;
  v_access4 text;
  v_hash5   text;
  v_i       int;
  v_status  text;
  v_walk    uuid[] := '{}';
  v_walk_b  uuid;
  v_pp      uuid[] := '{}';
  v_purge   jsonb;
begin
  raise notice '';
  raise notice '══ Wallet : socle commun ══';

  -- ─────────────────────────────────────────────────────────────────
  -- Mise en place : deux organisations, six clients.
  -- ─────────────────────────────────────────────────────────────────
  insert into auth.users (id, email)
  values (v_owner, 'wallet-core-owner@test.local'),
         (v_rival, 'wallet-core-rival@test.local');

  v_prov  := public.provision_organization(v_owner, 'Wallet Noyau', 'barber', 'Wallet Noyau Centre');
  v_org   := (v_prov -> 'organization' ->> 'id')::uuid;
  v_loc   := (v_prov -> 'location' ->> 'id')::uuid;
  v_queue := (v_prov -> 'queue' ->> 'id')::uuid;
  v_prov    := public.provision_organization(v_rival, 'Wallet Rival', 'garage', 'Wallet Rival Nord');
  v_org_b   := (v_prov -> 'organization' ->> 'id')::uuid;
  v_loc_b   := (v_prov -> 'location' ->> 'id')::uuid;
  v_queue_b := (v_prov -> 'queue' ->> 'id')::uuid;

  insert into public.staff (organization_id, location_id, display_name)
  values (v_org, v_loc, 'Inès') returning id into v_staff;

  perform public.set_queue_status(v_queue, 'open', v_owner);
  for v_i in 1 .. 6 loop
    v_s := v_s || (public.upsert_client_session(v_org, 'wallet-core-' || v_i, 'web') ->> 'id')::uuid;
    v_join := public.join_queue(v_queue, v_s[v_i],
                case when v_i = 6 then 'Zébulon' else 'Client ' || v_i end, null, null, 'qr');
    v_pub := v_pub || (v_join -> 'entry' ->> 'id');
    v_e := v_e || (select id from public.queue_entries where public_id = v_join -> 'entry' ->> 'id');
  end loop;

  -- ─────────────────────────────────────────────────────────────────
  raise notice '── 1. Sans pass, le moteur ne produit rien ──';
  select count(*) into v_before from public.wallet_outbox;
  perform public.staff_queue_action(v_pub[2], 'defer', v_owner, null, '{"by":1}');
  perform internal.wallet_test_eq(
    (select count(*) from public.wallet_outbox), v_before,
    'un recalcul de positions sans pass n''écrit rien dans la file d''envoi');

  -- ─────────────────────────────────────────────────────────────────
  raise notice '── 2. Émission idempotente et contrôle d''accès ──';
  v_res := public.wallet_issue_pass('apple', v_pub[6], v_s[6], null, v_apple);
  v_p6a := (v_res ->> 'id')::uuid;
  perform internal.wallet_test_ok((v_res ->> 'created')::boolean, 'le premier clic crée le pass Apple');
  perform internal.wallet_test_eq(v_res ->> 'kind', 'queue', 'hors événement, c''est un ticket de file');
  perform internal.wallet_test_ok(not (v_res ->> 'live')::boolean, 'un pass neuf n''est pas encore tenu à jour');
  perform internal.wallet_test_ok((v_res ->> 'externalId') ~ '^[0-9A-Za-z]{22}$',
    'numéro de série Apple aléatoire de 22 caractères');
  perform internal.wallet_test_eq(v_res ->> 'classRef', 'pass.test.rangvia', 'type de pass Apple repris de la configuration');

  v_res := public.wallet_issue_pass('apple', v_pub[6], v_s[6], null, v_apple);
  perform internal.wallet_test_ok(not (v_res ->> 'created')::boolean and (v_res ->> 'id')::uuid = v_p6a,
    'un second clic renvoie le même pass');
  perform internal.wallet_test_eq(
    (select download_count from public.wallet_passes where id = v_p6a), 2, 'téléchargements comptés');

  begin
    perform public.wallet_issue_pass('apple', v_pub[6], v_s[1], null, v_apple);
    raise exception 'ÉCHEC: le ticket d''une autre session a été émis';
  exception when sqlstate 'VT009' then
    raise notice '  ok  le ticket d''une autre session est refusé';
  end;
  begin
    perform public.wallet_issue_pass('apple', v_pub[6], null, null, v_apple);
    raise exception 'ÉCHEC: un public_id seul a suffi';
  exception when sqlstate 'VT009' then
    raise notice '  ok  un public_id seul ne suffit pas';
  end;
  begin
    perform public.wallet_issue_pass('apple', 'inexistant', v_s[1], null, v_apple);
    raise exception 'ÉCHEC: ticket inconnu accepté';
  exception when sqlstate 'VT005' then
    raise notice '  ok  ticket inconnu : introuvable';
  end;
  begin
    perform public.wallet_issue_pass('apple', v_pub[5], v_s[5], null, '{}');
    raise exception 'ÉCHEC: pass Apple émis sans type de pass';
  exception when sqlstate 'VT022' then
    raise notice '  ok  configuration Apple incomplète : refus propre';
  end;
  begin
    perform public.wallet_issue_pass('samsung', v_pub[5], v_s[5], null, v_apple);
    raise exception 'ÉCHEC: fournisseur inconnu accepté';
  exception when sqlstate 'VT022' then
    raise notice '  ok  fournisseur inconnu refusé';
  end;

  v_res := public.wallet_issue_pass('google', v_pub[6], v_s[6], null, v_google);
  v_p6g := (v_res ->> 'id')::uuid;
  perform internal.wallet_test_ok(
    (v_res ->> 'externalId') ~ '^3388000000099999999\.rvtest_q_[0-9a-f]{32}$',
    'identifiant d''objet Google : émetteur, préfixe, q_, 128 bits aléatoires');
  perform internal.wallet_test_eq(v_res ->> 'classRef', '3388000000099999999.rvtest_file_v1',
    'classe Google de la file');

  -- ─────────────────────────────────────────────────────────────────
  raise notice '── 3. Pass non tenu à jour : rien n''est mis en file ──';
  update public.queue_entries set people_ahead = people_ahead + 5 where id = v_e[6];
  perform internal.wallet_test_eq(internal.wallet_test_pending(v_p6a), 0, 'Apple sans appareil : aucune ligne');
  perform internal.wallet_test_eq(internal.wallet_test_pending(v_p6g), 0, 'Google sans objet : aucune ligne');

  -- ─────────────────────────────────────────────────────────────────
  raise notice '── 4. Fusion : une seule ligne en attente par pass ──';
  update public.wallet_passes set live = true where id = v_p6a;
  for v_i in 1 .. 10 loop
    update public.queue_entries set people_ahead = 10 + v_i where id = v_e[6];
  end loop;
  select * into v_row from public.wallet_outbox where wallet_pass_id = v_p6a and status = 'pending';
  perform internal.wallet_test_eq(internal.wallet_test_pending(v_p6a), 1, 'dix recalculs → une seule ligne');
  perform internal.wallet_test_eq(v_row.reasons, array['position'], 'raison : position');
  perform internal.wallet_test_eq(v_row.priority, 0::smallint, 'changement mineur : priorité normale');
  perform internal.wallet_test_eq(v_row.provider, 'apple', 'la ligne porte le fournisseur');
  perform internal.wallet_test_eq(internal.wallet_test_pending(v_p6g), 0, 'le pass Google, lui, reste hors file');

  update public.queue_entries set staff_id = v_staff where id = v_e[6];
  select * into v_row from public.wallet_outbox where wallet_pass_id = v_p6a and status = 'pending';
  perform internal.wallet_test_eq(v_row.reasons, array['position', 'staff'], 'raisons fusionnées sans doublon');

  update public.queue_entries set people_ahead = 2 where id = v_e[6];
  select * into v_row from public.wallet_outbox where wallet_pass_id = v_p6a and status = 'pending';
  perform internal.wallet_test_eq(v_row.priority, 1::smallint, 'franchissement du seuil : moment clé');
  perform internal.wallet_test_eq(internal.wallet_test_pending(v_p6a), 1, 'toujours une seule ligne');

  -- ─────────────────────────────────────────────────────────────────
  raise notice '── 5. Rythme : 20 s entre deux envois mineurs ──';
  perform internal.wallet_test_clear(v_p6a);
  update public.wallet_passes set last_synced_at = now() where id = v_p6a;
  update public.queue_entries set people_ahead = 15 where id = v_e[6];
  select * into v_row from public.wallet_outbox where wallet_pass_id = v_p6a and status = 'pending';
  perform internal.wallet_test_eq(v_row.run_after, now() + interval '20 seconds',
    'changement mineur juste après un envoi : reporté de 20 s');
  update public.queue_entries set people_ahead = 1 where id = v_e[6];
  select * into v_row from public.wallet_outbox where wallet_pass_id = v_p6a and status = 'pending';
  perform internal.wallet_test_ok(v_row.run_after = now() and v_row.priority = 1,
    '« plus qu''une personne » : dû tout de suite, priorité haute');

  perform internal.wallet_test_clear(v_p6a);
  perform public.staff_queue_action(v_pub[6], 'call', v_owner);
  select * into v_row from public.wallet_outbox where wallet_pass_id = v_p6a and status = 'pending';
  perform internal.wallet_test_ok(v_row.priority = 1 and 'status' = any (v_row.reasons),
    'changement de statut : moment clé');

  -- ─────────────────────────────────────────────────────────────────
  raise notice '── 6. Réclamation exclusive et bail ──';
  update public.wallet_passes set last_synced_at = null where id = v_p6a;
  select * into v_row from public.claim_wallet_outbox('apple', v_queue) c where c.wallet_pass_id = v_p6a;
  v_r1 := v_row.id;
  perform internal.wallet_test_ok(v_r1 is not null and v_row.attempts = 1, 'la ligne est réclamée (1er essai)');
  perform internal.wallet_test_eq(
    (select locked_until from public.wallet_outbox where id = v_r1), now() + interval '60 seconds',
    'bail de 60 s');

  update public.queue_entries set people_ahead = 7 where id = v_e[6];
  perform internal.wallet_test_eq(internal.wallet_test_pending(v_p6a), 1,
    'un changement pendant le traitement ouvre une nouvelle ligne');
  perform internal.wallet_test_ok(
    not exists (select 1 from public.claim_wallet_outbox('apple', v_queue) c where c.wallet_pass_id = v_p6a),
    'pas de second traitement simultané du même pass');

  update public.wallet_outbox set locked_until = now() - interval '1 second' where id = v_r1;
  select * into v_row from public.claim_wallet_outbox('apple', v_queue) c where c.wallet_pass_id = v_p6a;
  v_r2 := v_row.id;
  perform internal.wallet_test_ok(v_r2 is not null and v_r2 <> v_r1, 'bail expiré : la ligne en attente est réclamée');
  perform internal.wallet_test_eq((select status from public.wallet_outbox where id = v_r1), 'done',
    'l''ancienne ligne est close (la nouvelle relit l''état courant)');

  update public.wallet_outbox set locked_until = now() - interval '1 second' where id = v_r2;
  select * into v_row from public.claim_wallet_outbox('apple', v_queue) c where c.wallet_pass_id = v_p6a;
  perform internal.wallet_test_ok(v_row.id = v_r2 and v_row.attempts = 2,
    'bail expiré sans remplaçante : la ligne est reprise (2e essai)');

  perform internal.wallet_test_ok(
    public.complete_wallet_outbox(v_r2, '{"syncedHash":"hash-a"}'), 'fin de traitement acceptée');
  perform internal.wallet_test_ok(
    (select synced_hash = 'hash-a' and last_synced_at = now() from public.wallet_passes where id = v_p6a),
    'empreinte livrée et horodatage enregistrés');
  perform internal.wallet_test_ok(
    not public.complete_wallet_outbox(v_r2, '{"syncedHash":"hash-b"}'), 'une ligne close ne se termine pas deux fois');

  -- ─────────────────────────────────────────────────────────────────
  raise notice '── 7. Version Apple ──';
  select * into v_ver1 from public.wallet_record_render(v_p6a, 'render-hash-1');
  select * into v_ver2 from public.wallet_record_render(v_p6a, 'render-hash-1');
  perform internal.wallet_test_ok(v_ver2.version_seq = v_ver1.version_seq and v_ver2.version_at = v_ver1.version_at,
    'même rendu : version inchangée');
  select * into v_ver3 from public.wallet_record_render(v_p6a, 'render-hash-2');
  select * into v_ver4 from public.wallet_record_render(v_p6a, 'render-hash-3');
  perform internal.wallet_test_ok(v_ver3.version_seq > v_ver1.version_seq and v_ver4.version_seq > v_ver3.version_seq,
    'rendu différent : numéro de version croissant');
  perform internal.wallet_test_ok(v_ver3.version_at > v_ver1.version_at and v_ver4.version_at > v_ver3.version_at,
    'Last-Modified strictement croissant, même dans la même seconde');
  perform internal.wallet_test_eq(extract(microseconds from v_ver4.version_at)::int % 1000000, 0,
    'Last-Modified à la seconde');

  -- ─────────────────────────────────────────────────────────────────
  raise notice '── 8. Fin de traitement : final, réouverture, report, alertes ──';
  update public.wallet_passes set alerts = '{"your_turn":"2026-01-01T10:00:00+00"}' where id = v_p6a;
  update public.queue_entries set people_ahead = 8 where id = v_e[6];
  v_r1 := internal.wallet_test_claim(v_p6a);
  perform public.complete_wallet_outbox(v_r1, '{"syncedHash":"h-final","final":true}');
  perform internal.wallet_test_ok(
    (select state = 'final' and final_at = now() from public.wallet_passes where id = v_p6a),
    'état final enregistré');

  update public.queue_entries set people_ahead = 9 where id = v_e[6];
  v_r1 := internal.wallet_test_claim(v_p6a);
  perform public.complete_wallet_outbox(v_r1, '{"reopen":true}');
  perform internal.wallet_test_ok(
    (select state = 'active' and final_at is null and alerts = '{}'::jsonb from public.wallet_passes where id = v_p6a),
    'ticket revenu en file : pass rouvert, registre d''alertes remis à zéro');

  perform public.staff_queue_action(v_pub[6], 'complete', v_owner);
  v_r1 := internal.wallet_test_claim(v_p6a);
  perform public.complete_wallet_outbox(v_r1, '{"final":true}');
  update public.queue_entries set people_ahead = 3 where id = v_e[6];
  v_r1 := internal.wallet_test_claim(v_p6a);
  perform public.complete_wallet_outbox(v_r1, '{"reopen":true}');
  perform internal.wallet_test_eq((select state from public.wallet_passes where id = v_p6a), 'final',
    'réouverture refusée tant que le ticket n''est pas revenu en file');

  update public.queue_entries set people_ahead = 4 where id = v_e[6];
  v_r1 := internal.wallet_test_claim(v_p6a);
  perform public.complete_wallet_outbox(v_r1,
    jsonb_build_object('nextRunAfter', now() + interval '2 hours'));
  select * into v_row from public.wallet_outbox where wallet_pass_id = v_p6a and status = 'pending';
  perform internal.wallet_test_ok(v_row.run_after = now() + interval '2 hours' and v_row.reasons = array['archive'],
    'transition différée : une ligne future « archive »');

  update public.wallet_passes
     set notify_log = array[now() - interval '25 hours', now() - interval '1 hour']
   where id = v_p6a;
  update public.queue_entries set people_ahead = 5 where id = v_e[6];
  v_r1 := internal.wallet_test_claim(v_p6a);
  perform internal.wallet_test_ok(v_r1 is not null, 'un nouveau changement avance l''archivage différé');
  perform public.complete_wallet_outbox(v_r1,
    '{"syncedHash":"h-alert","alertKind":"ahead_one","alertNotified":true}');
  perform internal.wallet_test_ok(
    (select cardinality(notify_log) = 2 and notify_log[2] = now()
            and notify_log[1] > now() - interval '24 hours' and alerts ? 'ahead_one'
     from public.wallet_passes where id = v_p6a),
    'journal d''alertes élagué à 24 h, moment inscrit au registre');
  perform internal.wallet_test_eq(
    (select count(*)::int from public.notification_deliveries
      where queue_entry_id = v_e[6] and channel::text = 'apple_wallet'
        and kind = 'ahead_one' and status = 'sent'),
    1, 'alerte acceptée : une ligne notification_deliveries apple_wallet');

  update public.queue_entries set people_ahead = 6 where id = v_e[6];
  v_r1 := internal.wallet_test_claim(v_p6a);
  begin
    perform public.complete_wallet_outbox(v_r1, '{"alertKind":"loterie"}');
    raise exception 'ÉCHEC: moment d''alerte inconnu accepté';
  exception when invalid_parameter_value then
    raise notice '  ok  moment d''alerte inconnu refusé';
  end;

  -- ─────────────────────────────────────────────────────────────────
  raise notice '── 9. Échecs ──';
  v_status := public.fail_wallet_outbox(v_r1, 'APNs 503', 30, false);
  perform internal.wallet_test_eq(v_status, 'pending', 'échec temporaire : reprogrammé');
  perform internal.wallet_test_ok(
    (select run_after = now() + interval '30 seconds' and last_error = 'APNs 503'
     from public.wallet_outbox where id = v_r1), 'nouvel essai dans 30 s, erreur conservée');
  perform internal.wallet_test_ok(
    not exists (select 1 from public.claim_wallet_outbox('apple', v_queue) c where c.id = v_r1),
    'pas réclamée avant l''échéance');
  update public.wallet_outbox set run_after = now() where id = v_r1;
  v_r1 := internal.wallet_test_claim(v_p6a);
  perform internal.wallet_test_eq(public.fail_wallet_outbox(v_r1, 'Certificat refusé', 0, true), 'dead',
    'échec définitif : abandonnée');

  update public.queue_entries set people_ahead = 7 where id = v_e[6];
  v_r1 := internal.wallet_test_claim(v_p6a);
  update public.queue_entries set people_ahead = 8 where id = v_e[6];
  perform internal.wallet_test_eq(public.fail_wallet_outbox(v_r1, 'délai', 30, false), 'done',
    'échec alors qu''une ligne attend : la ligne en attente la remplace');
  perform internal.wallet_test_clear(v_p6a);

  -- ─────────────────────────────────────────────────────────────────
  raise notice '── 10. Instantané : jamais de prénom ──';
  update public.wallet_passes set live = true where id = v_p6g;
  v_snap := public.wallet_pass_snapshot(v_p6a);
  perform internal.wallet_test_ok(v_snap::text not like '%Zébulon%', 'le prénom n''apparaît nulle part');
  perform internal.wallet_test_ok(
    v_snap ?& array['pass', 'entry', 'queue', 'location', 'organization', 'event', 'access', 'deliveredKinds'],
    'l''instantané porte toutes ses parties');
  perform internal.wallet_test_eq(v_snap -> 'entry' ->> 'status', 'completed', 'statut du ticket');
  perform internal.wallet_test_eq(v_snap -> 'entry' ->> 'staffName', 'Inès', 'professionnel assigné');
  perform internal.wallet_test_ok(v_snap -> 'deliveredKinds' -> 'apple_wallet' ? 'ahead_one',
    'moments déjà livrés, par canal');
  perform internal.wallet_test_ok((v_snap -> 'organization' ->> 'walletEnabled')::boolean,
    'Wallet actif par défaut');
  perform internal.wallet_test_ok(jsonb_typeof(v_snap -> 'event') = 'null', 'hors événement : pas d''événement');
  perform internal.wallet_test_ok(public.wallet_pass_snapshot(extensions.gen_random_uuid()) is null,
    'pass inconnu : instantané nul');

  v_p2a := (public.wallet_issue_pass('apple', v_pub[2], v_s[2], null, v_apple) ->> 'id')::uuid;
  perform public.client_queue_action(v_pub[2], v_s[2], 'leave');
  v_snap := public.wallet_pass_snapshot(v_p2a);
  perform internal.wallet_test_ok(
    v_snap -> 'entry' ->> 'statusActor' = 'client' and v_snap -> 'entry' ->> 'statusEvent' = 'client_leave',
    '« vous avez quitté la file » : l''acteur de l''annulation est connu');

  -- ─────────────────────────────────────────────────────────────────
  raise notice '── 11. Une panne Wallet ne casse jamais une action de file ──';
  v_p3a := (public.wallet_issue_pass('apple', v_pub[3], v_s[3], null, v_apple) ->> 'id')::uuid;
  update public.wallet_passes set live = true where id = v_p3a;
  begin
    alter table public.wallet_outbox rename to wallet_outbox_indisponible;
    v_res := public.staff_queue_action(v_pub[3], 'call', v_owner);
    perform internal.wallet_test_eq(v_res -> 'entry' ->> 'status', 'next',
      'file d''envoi introuvable : l''appel du client réussit quand même');
    raise exception 'wallet-test-annulation';
  exception when others then
    if sqlerrm <> 'wallet-test-annulation' then
      raise;
    end if;
  end;
  perform internal.wallet_test_ok(to_regclass('public.wallet_outbox') is not null, 'file d''envoi restaurée');

  -- ─────────────────────────────────────────────────────────────────
  raise notice '── 12. Garde multi-tenant ──';
  perform public.set_queue_status(v_queue_b, 'open', v_rival);
  v_res := public.add_walkin(v_queue_b, 'Client B', null, null, v_rival);
  select id into v_walk_b from public.queue_entries where public_id = v_res -> 'entry' ->> 'id';
  begin
    insert into public.wallet_passes (provider, kind, organization_id, location_id, queue_id,
                                      queue_entry_id, external_id, class_ref)
    values ('apple', 'queue', v_org, v_loc, v_queue, v_walk_b,
            internal.generate_public_id(22), 'pass.test.rangvia');
    raise exception 'ÉCHEC: pass relié au ticket d''une autre organisation';
  exception when others then
    if sqlerrm like 'ÉCHEC:%' then raise; end if;
    raise notice '  ok  un pass ne peut pas relier le ticket d''une autre organisation';
  end;
  begin
    insert into public.wallet_passes (provider, kind, organization_id, location_id, queue_id,
                                      queue_entry_id, client_session_id, external_id, class_ref)
    values ('apple', 'queue', v_org, v_loc, v_queue, v_e[4],
            (public.upsert_client_session(v_org_b, 'wallet-core-rival', 'web') ->> 'id')::uuid,
            internal.generate_public_id(22), 'pass.test.rangvia');
    raise exception 'ÉCHEC: pass relié à la session d''une autre organisation';
  exception when others then
    if sqlerrm like 'ÉCHEC:%' then raise; end if;
    raise notice '  ok  ni à la session d''une autre organisation';
  end;

  -- ─────────────────────────────────────────────────────────────────
  raise notice '── 13. Émission : éligibilité ──';
  update public.queue_entries set completed_at = now() - interval '31 minutes' where id = v_e[6];
  begin
    perform public.wallet_issue_pass('apple', v_pub[6], v_s[6], null, v_apple);
    raise exception 'ÉCHEC: ticket terminé depuis 31 min émis';
  exception when sqlstate 'VT020' then
    raise notice '  ok  ticket terminé depuis plus de 30 min : refusé';
  end;
  update public.queue_entries set completed_at = now() - interval '5 minutes' where id = v_e[6];
  perform internal.wallet_test_ok(
    (public.wallet_issue_pass('apple', v_pub[6], v_s[6], null, v_apple) ->> 'id')::uuid = v_p6a,
    'le « Merci » reste téléchargeable 30 min');

  update public.organizations set status = 'suspended' where id = v_org;
  begin
    perform public.wallet_issue_pass('apple', v_pub[5], v_s[5], null, v_apple);
    raise exception 'ÉCHEC: organisation suspendue servie';
  exception when sqlstate 'VT007' then
    raise notice '  ok  organisation suspendue : refusé';
  end;
  update public.organizations set status = 'active' where id = v_org;

  update public.organization_settings set features = '{"wallet":false}' where organization_id = v_org;
  begin
    perform public.wallet_issue_pass('apple', v_pub[5], v_s[5], null, v_apple);
    raise exception 'ÉCHEC: Wallet désactivé mais pass émis';
  exception when sqlstate 'VT021' then
    raise notice '  ok  Wallet désactivé pour l''organisation : refusé';
  end;
  update public.organization_settings set features = '{}' where organization_id = v_org;

  -- ─────────────────────────────────────────────────────────────────
  raise notice '── 14. Drop : billet d''événement et déclencheurs ──';
  insert into public.event_campaigns (organization_id, location_id, queue_id, name, status, wave_size, started_at)
  values (v_org, v_loc, v_queue, 'Drop Wallet', 'live', 10, now())
  returning id into v_event;

  v_res := public.wallet_issue_pass('apple', v_pub[5], v_s[5], null, v_apple);
  v_p5a := (v_res ->> 'id')::uuid;
  perform internal.wallet_test_ok(v_res ->> 'kind' = 'event'
    and (select event_id from public.wallet_passes where id = v_p5a) = v_event,
    'un événement en cours tient la file : billet d''événement');
  v_res := public.wallet_issue_pass('google', v_pub[5], v_s[5], null, v_google);
  v_p5g := (v_res ->> 'id')::uuid;
  perform internal.wallet_test_ok(
    v_res ->> 'externalId' like '3388000000099999999.rvtest_e_%'
    and v_res ->> 'classRef' = '3388000000099999999.rvtest_evt_' || replace(v_event::text, '-', ''),
    'Google : objet e_ et classe propre à l''événement');

  -- Accès par le laisser-passer (cookie rv_event_pass), sans session.
  insert into public.event_access_passes (event_id, organization_id, location_id, queue_entry_id,
                                          token_hash, valid_until, grace_until)
  values (v_event, v_org, v_loc, v_e[4], encode(extensions.digest('wallet-core-4', 'sha256'), 'hex'),
          now() + interval '10 minutes', now() + interval '15 minutes')
  returning public_id into v_access4;
  v_res := public.wallet_issue_pass('apple', v_pub[4], null, v_access4, v_apple);
  v_p4a := (v_res ->> 'id')::uuid;
  perform internal.wallet_test_ok((v_res ->> 'created')::boolean, 'le laisser-passer du ticket ouvre l''émission');
  begin
    perform public.wallet_issue_pass('apple', v_pub[5], null, v_access4, v_apple);
    raise exception 'ÉCHEC: laisser-passer d''un autre ticket accepté';
  exception when sqlstate 'VT009' then
    raise notice '  ok  le laisser-passer d''un autre ticket est refusé';
  end;

  update public.wallet_passes set live = true where id in (v_p5a, v_p5g, v_p4a);
  perform internal.wallet_test_clear(v_p5a);
  perform internal.wallet_test_clear(v_p4a);

  perform count(*) from public.issue_event_wave(v_event, v_owner, 10);
  select * into v_row from public.wallet_outbox where wallet_pass_id = v_p5a and status = 'pending';
  perform internal.wallet_test_ok(v_row.priority = 1 and 'event_pass' = any (v_row.reasons),
    'émission d''une vague : moment clé « event_pass »');
  perform internal.wallet_test_eq(internal.wallet_test_pending(v_p5g), 1, 'Google suit le même rythme');

  v_snap := public.wallet_pass_snapshot(v_p5a);
  perform internal.wallet_test_ok(
    v_snap -> 'access' ->> 'status' = 'issued'
    and (v_snap -> 'access' ->> 'wave')::int = 1
    and length(v_snap -> 'access' ->> 'tokenHash') = 64
    and v_snap -> 'event' ->> 'name' = 'Drop Wallet'
    and (v_snap -> 'event' ->> 'walletQrEnabled')::boolean,
    'instantané d''un drop : accès, vague, marque, QR Wallet accepté');

  select token_hash into v_hash5 from public.event_access_passes where queue_entry_id = v_e[5];
  perform internal.wallet_test_clear(v_p5a);
  perform public.redeem_event_pass(v_hash5, v_owner);
  perform internal.wallet_test_eq(internal.wallet_test_pending(v_p5a), 1, 'validation au contrôle : mise en file');

  update public.event_access_passes set grace_until = now() - interval '1 minute' where public_id = v_access4;
  perform internal.wallet_test_clear(v_p4a);
  perform count(*) from public.expire_event_passes();
  select * into v_row from public.wallet_outbox where wallet_pass_id = v_p4a and status = 'pending';
  perform internal.wallet_test_ok(v_row.priority = 1, 'expiration de l''accès : mise en file');

  perform internal.wallet_test_clear(v_p5a);
  update public.event_campaigns set wallet_qr_enabled = false where id = v_event;
  select * into v_row from public.wallet_outbox where wallet_pass_id = v_p5a and status = 'pending';
  perform internal.wallet_test_ok(v_row.priority = 0 and v_row.reasons = array['event'],
    'QR Wallet refusé pour l''événement : le billet est redessiné');

  perform internal.wallet_test_clear(v_p5a);
  perform public.set_queue_status(v_queue, 'paused', v_owner, 'Pause');
  select * into v_row from public.wallet_outbox where wallet_pass_id = v_p5a and status = 'pending';
  perform internal.wallet_test_ok(v_row.reasons = array['queue'] and v_row.priority = 0,
    'pause de la file : mise en file, sans urgence');

  perform internal.wallet_test_clear(v_p5a);
  perform count(*) from public.close_event_campaign(v_event, v_owner, 'sold_out');
  select * into v_row from public.wallet_outbox where wallet_pass_id = v_p5a and status = 'pending';
  perform internal.wallet_test_ok(v_row.priority = 1 and 'event' = any (v_row.reasons),
    'clôture de l''événement : moment clé');

  perform internal.wallet_test_clear(v_p5a);
  update public.locations set name = 'Wallet Noyau — Bastille' where id = v_loc;
  perform internal.wallet_test_ok(
    (select reasons = array['branding'] from public.wallet_outbox where wallet_pass_id = v_p5a and status = 'pending'),
    'nouveau nom d''établissement : pass redessiné');
  perform internal.wallet_test_clear(v_p5a);
  update public.organization_settings set brand_accent = 'jade' where organization_id = v_org;
  perform internal.wallet_test_eq(internal.wallet_test_pending(v_p5a), 1, 'nouvel accent : pass redessiné');
  perform internal.wallet_test_clear(v_p5a);
  update public.organizations set name = 'Wallet Noyau Maison' where id = v_org;
  perform internal.wallet_test_eq(internal.wallet_test_pending(v_p5a), 1, 'nouveau nom d''organisation : pass redessiné');
  perform internal.wallet_test_clear(v_p5a);
  update public.organization_settings set send_completion_review = false where organization_id = v_org;
  perform internal.wallet_test_eq(internal.wallet_test_pending(v_p5a), 0, 'un réglage sans rapport ne réveille rien');

  -- ─────────────────────────────────────────────────────────────────
  raise notice '── 15. Purge ──';
  perform public.set_queue_status(v_queue, 'open', v_owner);
  for v_i in 1 .. 8 loop
    v_res := public.add_walkin(v_queue, null, null, null, v_owner);
    v_walk := v_walk || (select id from public.queue_entries where public_id = v_res -> 'entry' ->> 'id');
    v_pp := v_pp || extensions.gen_random_uuid();
    insert into public.wallet_passes (id, provider, kind, organization_id, location_id, queue_id,
                                      queue_entry_id, external_id, class_ref, live)
    values (v_pp[v_i], 'apple', 'queue', v_org, v_loc, v_queue, v_walk[v_i],
            internal.generate_public_id(22), 'pass.test.rangvia', true);
  end loop;
  -- 1 : actif, ticket actif → conservé tel quel.
  -- 2 : actif, ticket terminé depuis 3 h → final (filet) + synchronisation.
  update public.queue_entries set status = 'completed', completed_at = now() - interval '3 hours' where id = v_walk[2];
  -- 3 : final depuis 25 h, tenu à jour → travail d'effacement.
  update public.wallet_passes set state = 'final', final_at = now() - interval '25 hours' where id = v_pp[3];
  -- 4 : final depuis 25 h, plus d'appareil → effacé directement.
  update public.wallet_passes set state = 'final', final_at = now() - interval '25 hours', live = false where id = v_pp[4];
  -- 5 : effacé depuis 8 jours → supprimé.
  update public.wallet_passes set state = 'scrubbed', scrubbed_at = now() - interval '8 days', live = false where id = v_pp[5];
  -- 6 : révoqué depuis 8 jours → supprimé.
  update public.wallet_passes set state = 'revoked', revoked_at = now() - interval '8 days' where id = v_pp[6];
  -- 7 : final depuis 2 h seulement → conservé.
  update public.wallet_passes set state = 'final', final_at = now() - interval '2 hours' where id = v_pp[7];
  -- 8 : créé il y a 31 jours → filet ultime.
  update public.wallet_passes set created_at = now() - interval '31 days' where id = v_pp[8];

  -- Organisation en suppression : ses passes sont effacés tout de suite.
  insert into public.wallet_passes (provider, kind, organization_id, location_id, queue_id,
                                    queue_entry_id, external_id, class_ref, live)
  values ('apple', 'queue', v_org_b, v_loc_b, v_queue_b, v_walk_b,
          internal.generate_public_id(22), 'pass.test.rangvia', true),
         ('google', 'queue', v_org_b, v_loc_b, v_queue_b, v_walk_b,
          '3388000000099999999.rvtest_q_' || encode(extensions.gen_random_bytes(16), 'hex'),
          '3388000000099999999.rvtest_file_v1', false);
  update public.organizations set status = 'pending_deletion' where id = v_org_b;

  insert into public.wallet_apple_devices (device_library_identifier, push_token)
  values ('orphelin-purge-01', repeat('ab', 32));
  insert into public.wallet_outbox (wallet_pass_id, provider, queue_id, status, updated_at)
  values (v_pp[1], 'apple', v_queue, 'done', now() - interval '8 days');
  insert into public.wallet_outbox (wallet_pass_id, provider, queue_id, created_at)
  values (v_pp[1], 'apple', v_queue, now() - interval '3 days');

  v_purge := public.purge_wallet_data();

  perform internal.wallet_test_eq((select state from public.wallet_passes where id = v_pp[1]), 'active',
    'pass d''un ticket en cours : conservé');
  perform internal.wallet_test_ok(
    (select state = 'final' from public.wallet_passes where id = v_pp[2])
    and exists (select 1 from public.wallet_outbox where wallet_pass_id = v_pp[2] and status = 'pending'
                  and 'archive' = any (reasons)),
    'filet : ticket terminé depuis 3 h → pass final et dernière synchronisation');
  perform internal.wallet_test_ok(
    exists (select 1 from public.wallet_outbox where wallet_pass_id = v_pp[3] and status = 'pending' and job = 'scrub'),
    'final depuis 25 h : travail d''effacement');
  perform internal.wallet_test_ok(
    (select state = 'scrubbed' and scrubbed_at = now() from public.wallet_passes where id = v_pp[4]),
    'final depuis 25 h sans copie chez le fournisseur : effacé directement');
  perform internal.wallet_test_ok(
    not exists (select 1 from public.wallet_passes where id in (v_pp[5], v_pp[6], v_pp[8])),
    'effacé ou révoqué depuis 7 jours, créé depuis 30 jours : supprimés');
  perform internal.wallet_test_eq((select state from public.wallet_passes where id = v_pp[7]), 'final',
    'final depuis 2 h : conservé');
  perform internal.wallet_test_ok(
    exists (select 1 from public.wallet_outbox o join public.wallet_passes p on p.id = o.wallet_pass_id
            where p.organization_id = v_org_b and p.provider = 'apple'
              and o.status = 'pending' and o.job = 'scrub' and o.priority = 1)
    and (select state from public.wallet_passes where organization_id = v_org_b and provider = 'google') = 'scrubbed',
    'organisation en suppression : effacement immédiat');
  perform internal.wallet_test_ok(
    not exists (select 1 from public.wallet_apple_devices where device_library_identifier = 'orphelin-purge-01'),
    'appareil Apple orphelin : supprimé');
  perform internal.wallet_test_ok(
    not exists (select 1 from public.wallet_outbox where wallet_pass_id = v_pp[1] and status = 'done'),
    'lignes closes de plus de 7 jours : supprimées');
  perform internal.wallet_test_ok(
    exists (select 1 from public.wallet_outbox where wallet_pass_id = v_pp[1] and status = 'dead'),
    'ligne en attente depuis 2 jours (fournisseur non configuré) : abandonnée');
  perform internal.wallet_test_ok(v_purge ?& array['scrubJobs', 'scrubbedPasses', 'deletedPasses', 'deletedDevices'],
    'la purge rend ses compteurs');

  -- Le travail d'effacement se termine : plus d'état ni de copie tenue à jour.
  update public.wallet_outbox set status = 'done' where wallet_pass_id <> v_pp[3] and status = 'pending'
    and provider = 'apple' and queue_id = v_queue;
  v_r1 := internal.wallet_test_claim(v_pp[3]);
  perform public.complete_wallet_outbox(v_r1, '{}');
  perform internal.wallet_test_ok(
    (select state = 'scrubbed' and not live and alerts = '{}'::jsonb from public.wallet_passes where id = v_pp[3]),
    'effacement terminé : pass effacé, plus rien n''est tenu à jour');
  update public.queue_entries set people_ahead = people_ahead + 1 where id = v_walk[3];
  perform internal.wallet_test_eq(internal.wallet_test_pending(v_pp[3]), 0, 'un pass effacé ne se remet jamais en file');

  -- ─────────────────────────────────────────────────────────────────
  raise notice '── 16. Droits : rien pour le navigateur ──';
  perform internal.wallet_test_ok(not exists (
      select 1 from unnest(array['wallet_passes', 'wallet_outbox', 'wallet_apple_devices',
                                 'wallet_apple_registrations', 'wallet_google_classes']) t
      cross join unnest(array['anon', 'authenticated']) r
      where has_table_privilege(r, 'public.' || t, 'select, insert, update, delete')),
    'anon et authenticated : aucun droit sur les tables Wallet');
  perform internal.wallet_test_ok(not exists (
      select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname like 'wallet%' and c.relkind = 'r' and not c.relrowsecurity),
    'RLS activée sur toutes les tables Wallet');
  perform internal.wallet_test_ok(not exists (
      select 1 from pg_policy pol join pg_class c on c.oid = pol.polrelid
      where c.relname like 'wallet%'),
    'aucune politique : même un membre ne lit rien');
  perform internal.wallet_test_ok(not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      cross join unnest(array['anon', 'authenticated']) r
      where n.nspname = 'public'
        and (p.proname like '%wallet%')
        and has_function_privilege(r, p.oid, 'execute')),
    'anon et authenticated : aucune fonction Wallet exécutable');
  perform internal.wallet_test_ok(not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname like '%wallet%'
        and not has_function_privilege('service_role', p.oid, 'execute')),
    'service_role : toutes les fonctions Wallet publiques');
  perform internal.wallet_test_ok(not exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'internal') and p.proname like '%wallet%'
        and p.proname not like 'wallet_test_%'
        and (not p.prosecdef
             or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
        and p.proname <> 'wallet_merge_reasons'),
    'toutes les fonctions Wallet : SECURITY DEFINER et search_path figé');

  begin
    execute 'set local role anon';
    perform count(*) from public.wallet_passes;
    execute 'reset role';
    raise exception 'ÉCHEC: anon a lu wallet_passes';
  exception when insufficient_privilege then
    execute 'reset role';
    raise notice '  ok  anon ne lit pas les passes';
  end;
  begin
    execute 'set local role authenticated';
    perform public.wallet_pass_snapshot(v_p6a);
    execute 'reset role';
    raise exception 'ÉCHEC: authenticated a lu un instantané';
  exception when insufficient_privilege then
    execute 'reset role';
    raise notice '  ok  un compte connecté ne lit pas d''instantané';
  end;
  begin
    execute 'set local role service_role';
    perform internal.enqueue_wallet_update(v_p6a, 'position', false);
    execute 'reset role';
    raise exception 'ÉCHEC: service_role a appelé une fonction interne';
  exception when insufficient_privilege then
    execute 'reset role';
    raise notice '  ok  les fonctions internes ne sont pas exposées, même au serveur';
  end;

  raise notice '';
  raise notice '✅ Wallet (socle) : tous les tests passent.';
end
$$;

-- =====================================================================
-- Concurrence réelle : deux connexions réclament en même temps.
-- ---------------------------------------------------------------------
-- La première connexion réclame une ligne et garde la transaction
-- ouverte ; la seconde (dblink) réclame tout ce qui est dû. `skip locked`
-- doit lui faire sauter la ligne verrouillée, sans l'attendre.
-- Sans l'extension dblink (PostgreSQL compilé sans contrib), le cas est
-- signalé et non vérifié.
-- =====================================================================
do $$
begin
  begin
    create extension if not exists dblink with schema extensions;
  exception when others then
    raise notice '  --  dblink indisponible : concurrence non vérifiée (%)', sqlerrm;
  end;
end
$$;

do $$
declare
  v_owner uuid := extensions.gen_random_uuid();
  v_prov  jsonb;
  v_org   uuid;
  v_queue uuid;
  v_sess  uuid;
  v_pub   text;
  v_pass  uuid;
  v_i     int;
begin
  if to_regprocedure('extensions.dblink_connect(text,text)') is null then
    return;
  end if;
  insert into auth.users (id, email) values (v_owner, 'wallet-concurrence@test.local');
  v_prov  := public.provision_organization(v_owner, 'Wallet Concurrence', 'barber', 'Wallet Concurrence Centre');
  v_org   := (v_prov -> 'organization' ->> 'id')::uuid;
  v_queue := (v_prov -> 'queue' ->> 'id')::uuid;
  perform public.set_queue_status(v_queue, 'open', v_owner);
  -- Aucune autre ligne Google due : la seconde connexion ne verra que celles-ci.
  update public.wallet_outbox set status = 'done', locked_until = null
   where provider = 'google' and status in ('pending', 'processing');
  for v_i in 1 .. 3 loop
    v_sess := (public.upsert_client_session(v_org, 'wallet-concurrence-' || v_i, 'web') ->> 'id')::uuid;
    v_pub := public.join_queue(v_queue, v_sess, null, null, null, 'qr') -> 'entry' ->> 'id';
    v_pass := (public.wallet_issue_pass('google', v_pub, v_sess, null,
      '{"objectPrefix":"3388000000099999999.rvconc_","queueClass":"3388000000099999999.rvconc_file_v1"}')
      ->> 'id')::uuid;
    perform public.wallet_google_mark_live(v_pass, 'h0');
    perform internal.enqueue_wallet_update(v_pass, 'position', true);
  end loop;
end
$$;

begin;
do $$
declare
  v_mine   bigint;
  v_theirs bigint[];
  v_conn   text;
begin
  if to_regprocedure('extensions.dblink_connect(text,text)') is null then
    return;
  end if;
  select c.id into v_mine from public.claim_wallet_outbox('google', null, 1) c;

  v_conn := format('host=%s port=%s dbname=%s user=%s',
                   coalesce(host(inet_server_addr()), '127.0.0.1'),
                   coalesce(inet_server_port(), 5432), current_database(), current_user);
  perform extensions.dblink_connect('wallet_concurrence', v_conn);
  select array_agg(t.id) into v_theirs
  from extensions.dblink('wallet_concurrence',
         'select id from public.claim_wallet_outbox(''google'', null, 100)') as t (id bigint);
  perform extensions.dblink_disconnect('wallet_concurrence');

  perform internal.wallet_test_ok(v_mine is not null, 'première connexion : une ligne réclamée');
  perform internal.wallet_test_eq(cardinality(v_theirs), 2,
    'seconde connexion, en même temps : les deux autres, sans attendre');
  perform internal.wallet_test_ok(not (v_mine = any (v_theirs)),
    'jamais la même ligne deux fois (skip locked)');
end
$$;
commit;
