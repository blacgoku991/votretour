-- =====================================================================
-- VotreTour — programmation des tags NFC
-- ---------------------------------------------------------------------
-- Une plaque mal enregistrée se corrige avec un tournevis, pas avec un
-- redéploiement. On vérifie ici le contrat de record_plate_write() :
-- le compteur, le journal, le verrouillage définitif, et l'étanchéité
-- entre organisations.
-- =====================================================================

\set ON_ERROR_STOP on

do $$
declare
  v_owner uuid := '44444444-4444-4444-8444-444444444444';
  v_other uuid := '55555555-5555-4555-8555-555555555555';
  v_prov jsonb;
  v_org uuid;
  v_other_org uuid;
  v_location uuid;
  v_plate uuid;
  v_code text;
  v_row public.plates;
  v_url text;
  v_caught text;
begin
  raise notice '';
  raise notice '══ Programmation des plaques NFC ══';

  delete from public.organizations where slug in ('nfc-barber', 'nfc-garage');
  delete from auth.users where id in (v_owner, v_other);
  insert into auth.users (id, email) values
    (v_owner, 'owner@nfc.test'), (v_other, 'other@nfc.test');

  v_prov := public.provision_organization(v_owner, 'NFC Barber', 'barber', 'NFC Barber Centre');
  v_org := (v_prov -> 'organization' ->> 'id')::uuid;
  v_location := (v_prov -> 'location' ->> 'id')::uuid;

  v_prov := public.provision_organization(v_other, 'NFC Garage', 'garage', 'NFC Garage Sud');
  v_other_org := (v_prov -> 'organization' ->> 'id')::uuid;

  select id, code into v_plate, v_code
  from public.plates where organization_id = v_org order by created_at limit 1;
  perform internal.assert(v_plate is not null, 'la création d''un commerce crée sa plaque');

  v_url := 'https://votretour.fr/e/' || v_code;

  raise notice '';
  raise notice '── 1. Une plaque neuve n''est pas programmée ──';
  select * into v_row from public.plates where id = v_plate;
  perform internal.assert(v_row.programmed_at is null, 'une plaque neuve n''a jamais été écrite');
  perform internal.assert_eq(v_row.programmed_count, 0, 'son compteur d''écritures est à zéro');
  perform internal.assert(v_row.nfc_locked_at is null, 'elle n''est pas verrouillée');

  raise notice '';
  raise notice '── 2. Première écriture, relue et vérifiée ──';
  v_row := public.record_plate_write(v_org, v_plate, v_owner, v_url, '04:A2:B9:1C', false, true);
  perform internal.assert(v_row.programmed_at is not null, 'la date de programmation est posée');
  perform internal.assert_eq(v_row.programmed_count, 1, 'le compteur passe à 1');
  perform internal.assert_eq(v_row.nfc_serial, '04:A2:B9:1C', 'le numéro de série du tag est retenu');
  perform internal.assert(v_row.nfc_locked_at is null, 'sans verrouillage demandé, rien n''est verrouillé');
  perform internal.assert_eq(
    (select count(*)::int from public.plate_writes where plate_id = v_plate),
    1, 'le journal des écritures contient une ligne');
  perform internal.assert(
    (select verified from public.plate_writes where plate_id = v_plate),
    'la relecture réussie est enregistrée comme telle');

  raise notice '';
  raise notice '── 3. Une écriture non relue est enregistrée non vérifiée ──';
  v_row := public.record_plate_write(v_org, v_plate, v_owner, v_url, null, false, false);
  perform internal.assert_eq(v_row.programmed_count, 2, 'reprogrammer incrémente le compteur');
  perform internal.assert_eq(v_row.nfc_serial, '04:A2:B9:1C',
    'un numéro de série absent n''efface pas celui déjà connu');
  perform internal.assert(
    not (select verified from public.plate_writes where plate_id = v_plate order by created_at desc limit 1),
    'on n''affiche pas « vérifiée » sur une plaque qui n''a pas été relue');

  raise notice '';
  raise notice '── 4. Une plaque d''un autre commerce est refusée ──';
  begin
    perform public.record_plate_write(v_other_org, v_plate, v_other, v_url, null, false, true);
    perform internal.assert(false, 'une écriture inter-organisations aurait dû échouer');
  exception when sqlstate 'VT011' then
    perform internal.assert(true, 'impossible d''enregistrer l''écriture de la plaque d''autrui');
  end;

  raise notice '';
  raise notice '── 5. Le verrouillage est définitif ──';
  v_row := public.record_plate_write(v_org, v_plate, v_owner, v_url, '04:A2:B9:1C', true, true);
  perform internal.assert(v_row.nfc_locked_at is not null, 'le tag est marqué verrouillé');

  begin
    perform public.record_plate_write(v_org, v_plate, v_owner, v_url, null, false, true);
    perform internal.assert(false, 'réécrire un tag verrouillé aurait dû échouer');
  exception when sqlstate 'VT012' then
    perform internal.assert(true, 'un tag verrouillé ne peut plus être réécrit');
  end;

  perform internal.assert_eq(
    (select programmed_count from public.plates where id = v_plate),
    3, 'la tentative refusée n''a pas incrémenté le compteur');

  raise notice '';
  raise notice '✅ Programmation des plaques : tous les tests passent.';
end
$$;

-- ---------------------------------------------------------------------
-- RLS : le journal des écritures ne fuit pas entre commerces
-- ---------------------------------------------------------------------
-- Comme pour les autres tests d'isolation, on se place réellement dans
-- le rôle PostgREST : internal.assert n'y est pas accessible, donc on
-- lève directement l'exception.

begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}';

  do $$
  declare n int;
  begin
    raise notice '';
    raise notice '── 6. Isolation du journal des écritures ──';
    select count(*) into n from public.plate_writes;
    if n <> 0 then
      raise exception 'ÉCHEC: un autre commerçant voit % écritures de plaque', n;
    end if;
    raise notice '  ok  un autre commerçant ne voit aucune écriture de plaque';

    select count(*) into n from public.plates;
    if n <> 1 then
      raise exception 'ÉCHEC: un autre commerçant voit % plaques', n;
    end if;
    raise notice '  ok  il ne voit que la plaque de son propre commerce';
  end
  $$;
rollback;

begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}';

  do $$
  declare n int;
  begin
    select count(*) into n from public.plate_writes;
    if n < 3 then
      raise exception 'ÉCHEC: le propriétaire ne voit que % écritures', n;
    end if;
    raise notice '  ok  le propriétaire voit l''historique de ses propres plaques';

    begin
      insert into public.plate_writes (organization_id, plate_id, written_url)
      select organization_id, id, 'https://pirate.example/e/x' from public.plates limit 1;
      raise exception 'ÉCHEC: une écriture directe dans le journal a été acceptée';
    exception
      when insufficient_privilege then
        raise notice '  ok  personne ne peut forger une écriture depuis le navigateur';
    end;

    raise notice '';
    raise notice '✅ Isolation du journal : tous les tests passent.';
  end
  $$;
rollback;
