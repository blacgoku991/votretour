-- Séquences réelles de tests/wallet/sequences-0021.json (sequences.test.ts).
--
-- Chaque instruction est sa propre transaction : les horloges du moteur,
-- du pass et des événements de file diffèrent comme en production (les
-- comparaisons d'horodatages d'alerts.ts en dépendent). Le complément de
-- pg_temp.full_snap() reproduit completeWalletSnapshot() (outbox.ts).
--
-- Régénération, sur une base de vérification À SOI (jamais la partagée),
-- migrations de W0 (0021) appliquées :
--   psql -At -h 127.0.0.1 -p 54399 -U postgres -d votretour_w1 \
--     -f apps/web/tests/wallet/sequences-0021.sql | tail -1 \
--     | python3 -m json.tool --indent 1 --sort-keys --no-ensure-ascii \
--     > apps/web/tests/wallet/sequences-0021.json
-- Les données créées restent dans cette base : verify-db.sh la recrée.
\set ON_ERROR_STOP 1
create temp table ids (k text primary key, v text);
create temp table out_snap (label text primary key, doc jsonb);

create function pg_temp.full_snap(p_pass uuid) returns jsonb language sql as $$
  -- Même complément que completeWalletSnapshot() (outbox.ts).
  select s
    || jsonb_build_object('queue', (s->'queue') || jsonb_build_object('runningEventId',
         (select to_jsonb(ev.id) from public.event_campaigns ev
           where ev.queue_id = (s->'queue'->>'id')::uuid and ev.status in ('live','paused') limit 1)))
    || jsonb_build_object('entry', (s->'entry') || jsonb_build_object(
         'rankResetAt', (select to_jsonb(qe.created_at) from public.queue_events qe
                          join public.queue_entries e on e.id = qe.entry_id
                         where e.public_id = s->'entry'->>'publicId'
                           and qe.event_type in ('defer','absent_move_back','restore')
                         order by qe.created_at desc limit 1),
         'engineLedger', (select e.notification_status from public.queue_entries e where e.public_id = s->'entry'->>'publicId')))
  from (select public.wallet_pass_snapshot(p_pass) as s) x
$$;
create function pg_temp.id(p text) returns text language sql as $$ select v from ids where k = p $$;
create function pg_temp.shot(p_label text, p_pass text) returns void language sql as $$
  insert into out_snap values (p_label, pg_temp.full_snap(p_pass::uuid))
$$;

-- ── auto_serve : A en prestation, B à 1, C derrière ──
do $$
declare v_owner uuid := extensions.gen_random_uuid(); v_prov jsonb; v_org uuid; v_queue uuid; v_s uuid; i int;
begin
  insert into auth.users (id, email) values (v_owner, 'w1-seq-auto-'||v_owner||'@test.local');
  v_prov := public.provision_organization(v_owner, 'Séquences Auto', 'barber', 'Séquences Auto Centre');
  v_org := (v_prov->'organization'->>'id')::uuid; v_queue := (v_prov->'queue'->>'id')::uuid;
  perform public.set_queue_status(v_queue, 'open', v_owner);
  insert into ids values ('owner', v_owner), ('queue', v_queue);
  for i in 1..3 loop
    v_s := (public.upsert_client_session(v_org, 'w1-seq-auto-'||v_owner||i, 'web')->>'id')::uuid;
    insert into ids values ('s'||i, v_s), ('e'||i, public.join_queue(v_queue, v_s, 'Zébulon', null, null, 'qr')->'entry'->>'id');
  end loop;
  perform public.staff_queue_action(pg_temp.id('e1'), 'start_serving', v_owner, null, '{}');
end $$;
select pg_sleep(1.1);
insert into ids select 'gpass', public.wallet_issue_pass('google', pg_temp.id('e2'), pg_temp.id('s2')::uuid, null,
  '{"objectPrefix":"3388000000099999999.rvseq_","queueClass":"3388000000099999999.rvseq_file_v1","eventClassPrefix":"3388000000099999999.rvseq_evt_"}')->>'id';
select count(*) from public.claim_pending_notifications(pg_temp.id('queue')::uuid);
select pg_temp.shot('auto-1-waiting-one', pg_temp.id('gpass'));
select pg_sleep(1.1);
select public.staff_queue_action(pg_temp.id('e1'), 'complete', pg_temp.id('owner')::uuid, null, '{}') is not null;
select count(*) from public.claim_pending_notifications(pg_temp.id('queue')::uuid);
select pg_temp.shot('auto-2-serving', pg_temp.id('gpass'));
select pg_sleep(1.1);
select public.staff_queue_action(pg_temp.id('e2'), 'defer', pg_temp.id('owner')::uuid, null, '{"by":1}') is not null;
select count(*) from public.claim_pending_notifications(pg_temp.id('queue')::uuid);
select pg_temp.shot('auto-3-deferred', pg_temp.id('gpass'));
select pg_sleep(1.1);
select public.staff_queue_action(pg_temp.id('e3'), 'complete', pg_temp.id('owner')::uuid, null, '{}') is not null;
select count(*) from public.claim_pending_notifications(pg_temp.id('queue')::uuid);
select pg_temp.shot('auto-4-recalled', pg_temp.id('gpass'));

-- ── call_next : D seul, appelé puis servi ──
do $$
declare v_owner uuid := extensions.gen_random_uuid(); v_prov jsonb; v_org uuid; v_loc uuid; v_queue uuid; v_s uuid;
begin
  insert into auth.users (id, email) values (v_owner, 'w1-seq-call-'||v_owner||'@test.local');
  v_prov := public.provision_organization(v_owner, 'Séquences Appel', 'barber', 'Séquences Appel Centre');
  v_org := (v_prov->'organization'->>'id')::uuid; v_loc := (v_prov->'location'->>'id')::uuid; v_queue := (v_prov->'queue'->>'id')::uuid;
  update public.queues set advance_mode = 'call_next' where id = v_queue;
  perform public.set_queue_status(v_queue, 'open', v_owner);
  insert into ids values ('owner2', v_owner), ('org2', v_org), ('loc2', v_loc), ('queue2', v_queue);
  v_s := (public.upsert_client_session(v_org, 'w1-seq-call-1-'||v_owner, 'web')->>'id')::uuid;
  insert into ids values ('s4', v_s), ('e4', public.join_queue(v_queue, v_s, 'Zébulon', null, null, 'qr')->'entry'->>'id');
  v_s := (public.upsert_client_session(v_org, 'w1-seq-call-2-'||v_owner, 'web')->>'id')::uuid;
  insert into ids values ('s5', v_s), ('e5', public.join_queue(v_queue, v_s, 'Zébulon', null, null, 'qr')->'entry'->>'id');
end $$;
insert into ids select 'apass', public.wallet_issue_pass('apple', pg_temp.id('e4'), pg_temp.id('s4')::uuid, null, '{"passTypeId":"pass.test.rangvia"}')->>'id';
select pg_sleep(1.1);
select public.staff_queue_action(pg_temp.id('e4'), 'call', pg_temp.id('owner2')::uuid, null, '{}') is not null;
select pg_temp.shot('call-1-called', pg_temp.id('apass'));
select pg_sleep(1.1);
select public.staff_queue_action(pg_temp.id('e4'), 'start_serving', pg_temp.id('owner2')::uuid, null, '{}') is not null;
select pg_temp.shot('call-2-serving', pg_temp.id('apass'));

-- ── drop lancé après l'ajout du pass de file (E, 1 devant) ──
insert into ids select 'dpass', public.wallet_issue_pass('google', pg_temp.id('e5'), pg_temp.id('s5')::uuid, null,
  '{"objectPrefix":"3388000000099999999.rvseq_","queueClass":"3388000000099999999.rvseq_file_v1","eventClassPrefix":"3388000000099999999.rvseq_evt_"}')->>'id';
select pg_temp.shot('drop-0-before', pg_temp.id('dpass'));
insert into public.event_campaigns (organization_id, location_id, queue_id, name, status, started_at)
select pg_temp.id('org2')::uuid, pg_temp.id('loc2')::uuid, pg_temp.id('queue2')::uuid, 'Drop Aurore', 'live', now();
select pg_temp.shot('drop-1-running', pg_temp.id('dpass'));

select jsonb_object_agg(label, doc) from out_snap;
