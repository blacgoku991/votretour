-- =====================================================================
-- Rangvia — Wallet : Google (classes, objets, lien d'avis)
-- ---------------------------------------------------------------------
-- Classes Google à synchroniser (événement sans classe, classe salie par
-- un changement de marque, erreur à retenter, rien pour une organisation
-- suspendue ou sans Wallet), étiquette de salissure qui ne recule jamais
-- (deux connexions), objet marqué `live` après son insertion REST, et
-- source « wallet » des clics d'avis.
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
  v_owner   uuid := extensions.gen_random_uuid();
  v_prov    jsonb;
  v_org     uuid;
  v_loc     uuid;
  v_queue   uuid;
  v_s1      uuid;
  v_pub1    text;
  v_entry1  uuid;
  v_event   uuid;
  v_google  jsonb := '{"objectPrefix":"3388000000088888888.rvg_",
                       "queueClass":"3388000000088888888.rvg_file_v1",
                       "eventClassPrefix":"3388000000088888888.rvg_evt_"}';
  v_class   text;
  v_qclass  text := '3388000000088888888.rvg_file_v1';
  v_res     jsonb;
  v_pass    uuid;
  v_row     record;
  v_dirty   timestamptz;
begin
  raise notice '';
  raise notice '══ Wallet : Google ══';

  insert into auth.users (id, email) values (v_owner, 'wallet-google-owner@test.local');
  v_prov  := public.provision_organization(v_owner, 'Wallet Robot', 'barber', 'Wallet Robot Centre');
  v_org   := (v_prov -> 'organization' ->> 'id')::uuid;
  v_loc   := (v_prov -> 'location' ->> 'id')::uuid;
  v_queue := (v_prov -> 'queue' ->> 'id')::uuid;
  perform public.set_queue_status(v_queue, 'open', v_owner);
  v_s1 := (public.upsert_client_session(v_org, 'wallet-google-1', 'android_web') ->> 'id')::uuid;
  v_pub1 := public.join_queue(v_queue, v_s1, null, null, null, 'qr') -> 'entry' ->> 'id';
  select id into v_entry1 from public.queue_entries where public_id = v_pub1;

  -- ─────────────────────────────────────────────────────────────────
  raise notice '── 1. Lien d''avis au dos du pass ──';
  insert into public.review_clicks (organization_id, location_id, queue_entry_id, entry_public_id, source)
  values (v_org, v_loc, v_entry1, v_pub1, 'wallet');
  perform internal.wallet_test_ok(
    exists (select 1 from public.review_clicks where queue_entry_id = v_entry1 and source = 'wallet'),
    'un clic d''avis venu du Wallet est compté');
  begin
    insert into public.review_clicks (organization_id, location_id, queue_entry_id, entry_public_id, source)
    values (v_org, v_loc, v_entry1, v_pub1, 'pirate');
    raise exception 'ÉCHEC: source d''avis inconnue acceptée';
  exception when check_violation then
    raise notice '  ok  une source inconnue reste refusée';
  end;

  -- ─────────────────────────────────────────────────────────────────
  raise notice '── 2. Classe de la file ──';
  perform internal.wallet_test_eq((public.wallet_google_class_upsert(v_qclass, 'queue', null)).class_id, v_qclass,
    'classe de file enregistrée');
  perform internal.wallet_test_eq((public.wallet_google_class_upsert(v_qclass, 'queue', null)).kind, 'queue',
    'enregistrement idempotent');
  perform internal.wallet_test_ok(
    exists (select 1 from public.wallet_google_classes_due(200) d where d.class_id = v_qclass),
    'jamais synchronisée : à synchroniser');
  perform public.wallet_google_class_synced(v_qclass, 'hash-classe-file', 'APPROVED', null);
  perform internal.wallet_test_ok(
    not exists (select 1 from public.wallet_google_classes_due(200) d where d.class_id = v_qclass),
    'synchronisée : plus rien à faire');
  begin
    perform public.wallet_google_class_upsert(v_qclass, 'event', null);
    raise exception 'ÉCHEC: classe d''événement sans événement acceptée';
  exception when sqlstate 'VT022' then
    raise notice '  ok  classe incohérente refusée';
  end;
  begin
    perform public.wallet_google_class_upsert('pas un identifiant', 'queue', null);
    raise exception 'ÉCHEC: identifiant de classe malformé accepté';
  exception when sqlstate 'VT022' then
    raise notice '  ok  identifiant de classe malformé refusé';
  end;

  -- ─────────────────────────────────────────────────────────────────
  raise notice '── 3. Classe d''un événement ──';
  insert into public.event_campaigns (organization_id, location_id, queue_id, name, status)
  values (v_org, v_loc, v_queue, 'Drop Robot', 'draft')
  returning id into v_event;
  perform internal.wallet_test_ok(
    not exists (select 1 from public.wallet_google_classes_due(200) d where d.event_id = v_event),
    'événement en brouillon : pas de classe');
  update public.event_campaigns set status = 'live', started_at = now() where id = v_event;
  select * into v_row from public.wallet_google_classes_due(200) d where d.event_id = v_event;
  perform internal.wallet_test_ok(v_row.event_id = v_event and v_row.class_id is null and v_row.kind = 'event'
                                  and v_row.dirty_at is null,
    'événement en cours sans classe : signalé pour création (sans étiquette)');

  update public.organization_settings set features = '{"wallet":false}' where organization_id = v_org;
  perform internal.wallet_test_ok(
    not exists (select 1 from public.wallet_google_classes_due(200) d where d.event_id = v_event),
    'Wallet désactivé par l''organisation : rien de l''événement ne part chez Google');
  update public.organization_settings set features = '{}' where organization_id = v_org;
  update public.organizations set status = 'suspended' where id = v_org;
  perform internal.wallet_test_ok(
    not exists (select 1 from public.wallet_google_classes_due(200) d where d.event_id = v_event),
    'organisation suspendue : rien non plus');
  update public.organizations set status = 'active' where id = v_org;

  v_class := '3388000000088888888.rvg_evt_' || replace(v_event::text, '-', '');
  v_dirty := (public.wallet_google_class_upsert(v_class, 'event', v_event)).dirty_at;
  select * into v_row from public.wallet_google_classes_due(200) d where d.event_id = v_event;
  perform internal.wallet_test_ok(v_row.class_id = v_class and v_row.dirty and v_row.dirty_at = v_dirty,
    'classe créée, pas encore synchronisée');
  -- L'étiquette fait l'aller-retour par un Date JavaScript (milliseconde).
  perform internal.wallet_test_eq(v_dirty, date_trunc('milliseconds', v_dirty),
    'étiquette à la milliseconde');
  perform public.wallet_google_class_synced(v_class, 'hash-classe-1', 'UNDER_REVIEW', null, v_dirty);
  perform internal.wallet_test_ok(
    (select not dirty and review_status = 'UNDER_REVIEW' and synced_hash = 'hash-classe-1'
     from public.wallet_google_classes where class_id = v_class),
    'synchronisée du premier coup avec l''étiquette rendue à la création, en revue chez Google');

  update public.event_campaigns set accent_hex = '#0A7C66' where id = v_event;
  perform internal.wallet_test_ok(
    (select dirty from public.wallet_google_classes where class_id = v_class),
    'nouvelle couleur de l''événement : classe à resynchroniser');
  perform internal.wallet_test_ok(
    exists (select 1 from public.wallet_google_classes_due(200) d where d.class_id = v_class),
    'elle figure parmi les classes à synchroniser');
  update public.organization_settings set features = '{"wallet":false}' where organization_id = v_org;
  perform internal.wallet_test_ok(
    not exists (select 1 from public.wallet_google_classes_due(200) d where d.class_id = v_class),
    'Wallet désactivé : la classe salie attend, sans partir');
  update public.organization_settings set features = '{}' where organization_id = v_org;

  -- La marque change PENDANT l'envoi : la classe reste à synchroniser.
  select dirty_at into v_dirty from public.wallet_google_classes where class_id = v_class;
  perform public.wallet_google_class_synced(v_class, 'hash-classe-2', 'APPROVED', null, v_dirty - interval '1 second');
  perform internal.wallet_test_ok(
    (select dirty and review_status = 'APPROVED' from public.wallet_google_classes where class_id = v_class),
    'changement survenu pendant la synchronisation : pas perdu');
  perform public.wallet_google_class_synced(v_class, 'hash-classe-3', null, null, v_dirty);
  perform internal.wallet_test_ok(
    (select not dirty and synced_hash = 'hash-classe-3' and review_status = 'APPROVED'
     from public.wallet_google_classes where class_id = v_class),
    'synchronisation à jour : classe propre, statut de revue conservé');

  perform public.wallet_google_class_synced(v_class, null, null, 'HTTP 503');
  perform internal.wallet_test_ok(
    not exists (select 1 from public.wallet_google_classes_due(200) d where d.class_id = v_class),
    'erreur récente : on laisse Google respirer');
  alter table public.wallet_google_classes disable trigger wallet_google_classes_touch;
  update public.wallet_google_classes set updated_at = now() - interval '11 minutes' where class_id = v_class;
  alter table public.wallet_google_classes enable trigger wallet_google_classes_touch;
  perform internal.wallet_test_ok(
    exists (select 1 from public.wallet_google_classes_due(200) d where d.class_id = v_class),
    'erreur depuis plus de 10 min : nouvel essai');

  -- ─────────────────────────────────────────────────────────────────
  raise notice '── 4. Objet : créé au clic, puis tenu à jour ──';
  v_res := public.wallet_issue_pass('google', v_pub1, v_s1, null, v_google);
  v_pass := (v_res ->> 'id')::uuid;
  perform internal.wallet_test_eq(v_res ->> 'classRef', v_class, 'le billet pointe la classe de l''événement');
  perform internal.wallet_test_ok(not (v_res ->> 'live')::boolean, 'avant l''insertion REST : pas tenu à jour');

  perform internal.wallet_test_ok(public.wallet_google_mark_live(v_pass, 'hash-objet-1'), 'objet inséré chez Google');
  perform internal.wallet_test_ok(
    (select live and synced_hash = 'hash-objet-1' and last_synced_at = now()
     from public.wallet_passes where id = v_pass),
    'tenu à jour, empreinte du rendu livré enregistrée');
  perform internal.wallet_test_ok(not public.wallet_google_mark_live(extensions.gen_random_uuid(), 'x'),
    'objet inconnu : rien');

  perform public.staff_queue_action(v_pub1, 'call', v_owner);
  select * into v_row from public.wallet_outbox where wallet_pass_id = v_pass and status = 'pending';
  perform internal.wallet_test_ok(v_row.provider = 'google' and v_row.priority = 1,
    'appel du client : mise à jour Google prioritaire');

  -- Budget Google : trois alertes par 24 h, relues par le serveur.
  update public.wallet_passes
     set notify_log = array[now() - interval '3 hours', now() - interval '2 hours', now() - interval '1 hour']
   where id = v_pass;
  select c.id into v_row from public.claim_wallet_outbox('google', v_queue) c where c.wallet_pass_id = v_pass;
  perform public.complete_wallet_outbox(v_row.id,
    '{"syncedHash":"hash-objet-2","alertKind":"your_turn","alertNotified":false}');
  perform internal.wallet_test_ok(
    (select cardinality(notify_log) = 3 and alerts ? 'your_turn' from public.wallet_passes where id = v_pass),
    'message sans sonnerie (budget atteint) : inscrit au registre, pas au budget');
  perform internal.wallet_test_eq(
    (select count(*)::int from public.notification_deliveries
      where queue_entry_id = v_entry1 and channel::text = 'google_wallet'),
    0, 'et aucune « notification envoyée » n''est comptée');

  -- Fin d'un apple : mark_live ne touche jamais un pass Apple.
  perform internal.wallet_test_ok(
    not public.wallet_google_mark_live(
      (public.wallet_issue_pass('apple', v_pub1, v_s1, null, '{"passTypeId":"pass.test.rangvia"}') ->> 'id')::uuid,
      'x'),
    'wallet_google_mark_live ignore les passes Apple');

  -- ─────────────────────────────────────────────────────────────────
  raise notice '── 5. Suppression de l''événement ──';
  delete from public.event_campaigns where id = v_event;
  perform internal.wallet_test_ok(
    not exists (select 1 from public.wallet_google_classes where class_id = v_class),
    'la classe de l''événement disparaît avec lui');
  perform internal.wallet_test_ok(
    (select event_id is null from public.wallet_passes where id = v_pass),
    'le billet reste, détaché de l''événement');

  -- ─────────────────────────────────────────────────────────────────
  raise notice '── 6. Droits ──';
  begin
    execute 'set local role authenticated';
    perform * from public.wallet_google_classes_due(10);
    execute 'reset role';
    raise exception 'ÉCHEC: authenticated a lu les classes Google';
  exception when insufficient_privilege then
    execute 'reset role';
    raise notice '  ok  les classes Google restent réservées au serveur';
  end;

  raise notice '';
  raise notice '✅ Wallet (Google) : tous les tests passent.';
end
$$;

-- =====================================================================
-- Étiquette de salissure : deux transactions qui se chevauchent.
-- ---------------------------------------------------------------------
-- T1 (formulaire « nom ») commence, T2 (couleur) modifie et valide, le
-- serveur lit l'étiquette et envoie ; T1 modifie et valide APRÈS. Avec
-- now() (heure de début de T1), l'étiquette reculait et le nouveau nom ne
-- partait jamais chez Google.
-- =====================================================================
-- dblink sert aux cas à deux connexions ; le test 20 le crée aussi, mais
-- ce fichier doit pouvoir tourner seul.
do $$
begin
  begin
    create extension if not exists dblink with schema extensions;
  exception when others then
    raise notice '  --  dblink indisponible : concurrence non vérifiée (%)', sqlerrm;
  end;
end
$$;

create temp table wallet_test_ctx (k text primary key, v text not null);

do $$
declare
  v_owner uuid := extensions.gen_random_uuid();
  v_prov  jsonb;
  v_org   uuid;
  v_event uuid;
  v_class text;
begin
  if to_regprocedure('extensions.dblink_connect(text,text)') is null then
    return;
  end if;
  insert into auth.users (id, email) values (v_owner, 'wallet-etiquette@test.local');
  v_prov := public.provision_organization(v_owner, 'Wallet Étiquette', 'barber', 'Wallet Étiquette Centre');
  v_org  := (v_prov -> 'organization' ->> 'id')::uuid;
  insert into public.event_campaigns (organization_id, location_id, queue_id, name, status, started_at)
  values (v_org, (v_prov -> 'location' ->> 'id')::uuid, (v_prov -> 'queue' ->> 'id')::uuid,
          'Drop Étiquette', 'live', now())
  returning id into v_event;
  v_class := '3388000000088888888.rvg_evt_' || replace(v_event::text, '-', '');
  perform public.wallet_google_class_synced(v_class, 'h0', 'APPROVED', null,
    (public.wallet_google_class_upsert(v_class, 'event', v_event)).dirty_at);
  insert into wallet_test_ctx values ('event', v_event::text), ('class', v_class);
end
$$;

do $$
declare
  v_event uuid := (select v::uuid from wallet_test_ctx where k = 'event');
  v_class text := (select v from wallet_test_ctx where k = 'class');
  v_conn  text;
  v_read  timestamptz;
begin
  raise notice '';
  raise notice '── 7. Étiquette de salissure : transactions qui se chevauchent ──';
  if to_regprocedure('extensions.dblink_connect(text,text)') is null then
    raise notice '  --  dblink indisponible : non vérifié';
    return;
  end if;
  perform set_config('lock_timeout', '5s', true);
  perform internal.wallet_test_ok(
    (select not dirty from public.wallet_google_classes where class_id = v_class), 'classe propre au départ');

  v_conn := format('host=%s port=%s dbname=%s user=%s',
                   coalesce(host(inet_server_addr()), '127.0.0.1'),
                   coalesce(inet_server_port(), 5432), current_database(), current_user);
  perform extensions.dblink_connect('wallet_t1', v_conn);
  perform extensions.dblink_connect('wallet_t2', v_conn);

  perform extensions.dblink_exec('wallet_t1', 'begin');
  perform * from extensions.dblink('wallet_t1', 'select now()::text') as t (x text);
  perform pg_sleep(0.02);
  perform extensions.dblink_exec('wallet_t2', format(
    'update public.event_campaigns set accent_hex = %L where id = %L', '#0A7C66', v_event));
  select dirty_at into v_read from public.wallet_google_classes where class_id = v_class;

  perform extensions.dblink_exec('wallet_t1', format(
    'update public.event_campaigns set name = %L where id = %L', 'Drop Étiquette — nouveau nom', v_event));
  perform extensions.dblink_exec('wallet_t1', 'commit');
  perform extensions.dblink_disconnect('wallet_t1');
  perform extensions.dblink_disconnect('wallet_t2');

  perform internal.wallet_test_ok(
    (select dirty_at > v_read from public.wallet_google_classes where class_id = v_class),
    'l''étiquette ne recule pas quand une transaction plus ancienne valide après');
  perform public.wallet_google_class_synced(v_class, 'h-couleur', null, null, v_read);
  perform internal.wallet_test_ok(
    (select dirty and synced_hash = 'h-couleur' from public.wallet_google_classes where class_id = v_class),
    'nom validé pendant l''envoi de la couleur : la classe reste à synchroniser');

  raise notice '';
  raise notice '✅ Wallet (Google, concurrence) : tous les tests passent.';
end
$$;
