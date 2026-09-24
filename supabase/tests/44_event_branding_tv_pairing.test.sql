-- =====================================================================
-- Rangvia — rattrapage des écrans TV appairés (0044)
-- ---------------------------------------------------------------------
-- 0016 a existé en deux versions sur la branche ChatGPT. La première
-- posait une contrainte `unique` sur TOUS les `code_hash` ; la seconde un
-- index unique limité aux codes non consommés. Une base passée par la
-- première version ne rejoue jamais 0016 (registre par nom de fichier) :
-- c'est 0044 qui doit la remettre d'aplomb.
--
-- Le test reconstitue donc cette base « première version », vérifie que
-- le défaut s'y manifeste, applique 0044 DEUX fois (rejouable), puis
-- vérifie :
--   - la contrainte d'unicité globale a disparu, l'index partiel est là ;
--   - un code consommé peut resservir ; deux codes identiques EN ATTENTE
--     restent impossibles ;
--   - un code expiré mais jamais consommé bloque encore sa combinaison
--     tant qu'il reste en table : c'est la purge de createTvPairCode
--     (admin-v2.ts) qui la libère — contrat documenté ici ;
--   - search_path figé, SECURITY DEFINER et droits de la RPC d'appairage ;
--   - tables des écrans fermées à anon et authenticated, RLS active.
--
-- 0044 porte son propre `begin; … commit;` : le test ne peut pas vivre
-- dans une transaction annulée. Il met donc de côté les codes existants
-- (ceux du test 05) et, à la fin, efface tout ce qu'il a créé — écrans
-- (jetons fixes repeat('8') et repeat('9'), uniques en base), codes,
-- organisation « Écran 0044 », son slug, son journal et l'utilisateur
-- tv-0044@test.local — avant de restituer les codes d'avant. Un test
-- ultérieur peut réutiliser les mêmes valeurs sans collision.
-- =====================================================================

\set ON_ERROR_STOP on
\timing off
set client_min_messages = notice;

-- Les codes des tests précédents gêneraient la contrainte globale (le
-- test 05 réutilise volontairement un même code) : de côté.
create temp table saved_pair_codes as select * from public.display_pair_codes;
delete from public.display_pair_codes;

-- ---------------------------------------------------------------------
-- Base « 0016 première version ».
-- ---------------------------------------------------------------------
drop index if exists public.display_pair_codes_unconsumed_code_idx;
alter table public.display_pair_codes
  add constraint display_pair_codes_code_hash_key unique (code_hash);

create temp table t44 (k text primary key, v uuid);

do $$
declare
  v_owner uuid := extensions.gen_random_uuid();
  v_prov jsonb;
  v_org uuid;
  v_loc uuid;
  v_queue uuid;
  v_code_hash text := repeat('7', 64);
begin
  raise notice '';
  raise notice '── 0044 : écrans TV, base passée par la première version de 0016 ──';

  insert into auth.users (id, email) values (v_owner, 'tv-0044@test.local');
  v_prov := public.provision_organization(
    v_owner, 'Écran 0044', 'event', 'Salle 0044', 'shared', 'rangvia'
  );
  v_org := (v_prov -> 'organization' ->> 'id')::uuid;
  v_loc := (v_prov -> 'location' ->> 'id')::uuid;
  v_queue := (v_prov -> 'queue' ->> 'id')::uuid;
  insert into t44 values ('owner', v_owner), ('org', v_org), ('loc', v_loc), ('queue', v_queue);

  insert into public.display_pair_codes (
    organization_id, location_id, queue_id, display_name,
    code_hash, expires_at, created_by
  ) values (
    v_org, v_loc, v_queue, 'TV comptoir',
    v_code_hash, now() + interval '10 minutes', v_owner
  );
  if public.consume_display_pair_code(v_code_hash, repeat('8', 64)) is null then
    raise exception 'ÉCHEC: code valide non consommé (base première version)';
  end if;

  -- Le défaut que 0044 corrige : la même combinaison ne ressert pas.
  begin
    insert into public.display_pair_codes (
      organization_id, location_id, queue_id, display_name,
      code_hash, expires_at, created_by
    ) values (
      v_org, v_loc, v_queue, 'TV bis',
      v_code_hash, now() + interval '10 minutes', v_owner
    );
    raise exception 'ÉCHEC: la base simulée n''a pas la contrainte de la première version';
  exception when unique_violation then
    raise notice '  ok  première version : un code consommé ne ressert pas (défaut reproduit)';
  end;
end
$$;

-- ---------------------------------------------------------------------
-- 0044, deux fois : la seconde passe ne doit rien changer ni échouer.
-- ---------------------------------------------------------------------
-- Les `if exists` / `if not exists` de la migration annoncent chacun
-- leur « skipping » : bruit attendu, masqué pour garder la sortie lisible.
set client_min_messages = warning;
\ir ../migrations/20260101000044_event_branding_tv_pairing.sql
\ir ../migrations/20260101000044_event_branding_tv_pairing.sql
set client_min_messages = notice;

do $$
declare
  v_owner uuid := (select v from t44 where k = 'owner');
  v_org uuid := (select v from t44 where k = 'org');
  v_loc uuid := (select v from t44 where k = 'loc');
  v_queue uuid := (select v from t44 where k = 'queue');
  v_code_hash text := repeat('7', 64);
  v_result jsonb;
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.display_pair_codes'::regclass
      and conname = 'display_pair_codes_code_hash_key'
  ) then
    raise exception 'ÉCHEC: contrainte d''unicité globale toujours présente';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and indexname = 'display_pair_codes_unconsumed_code_idx'
      and indexdef ilike '%unique%'
      and indexdef ilike '%where (consumed_at is null)%'
  ) then
    raise exception 'ÉCHEC: index unique partiel absent';
  end if;
  raise notice '  ok  contrainte globale retirée, index partiel en place (0044 rejoué deux fois)';

  -- Le code consommé ressert…
  insert into public.display_pair_codes (
    organization_id, location_id, queue_id, display_name,
    code_hash, expires_at, created_by
  ) values (
    v_org, v_loc, v_queue, 'TV bis',
    v_code_hash, now() + interval '10 minutes', v_owner
  );
  v_result := public.consume_display_pair_code(v_code_hash, repeat('9', 64));
  if v_result is null or (v_result ->> 'name') <> 'TV bis' then
    raise exception 'ÉCHEC: le code réattribué n''appaire pas le bon écran : %', v_result;
  end if;
  raise notice '  ok  un code consommé ressert et appaire le nouvel écran';

  -- …mais deux appairages en attente ne partagent jamais un code.
  insert into public.display_pair_codes (
    organization_id, location_id, queue_id, display_name,
    code_hash, expires_at, created_by
  ) values (
    v_org, v_loc, v_queue, 'TV ter',
    repeat('6', 64), now() + interval '10 minutes', v_owner
  );
  begin
    insert into public.display_pair_codes (
      organization_id, location_id, queue_id, display_name,
      code_hash, expires_at, created_by
    ) values (
      v_org, v_loc, v_queue, 'TV quater',
      repeat('6', 64), now() + interval '10 minutes', v_owner
    );
    raise exception 'ÉCHEC: deux codes identiques en attente acceptés';
  exception when unique_violation then
    raise notice '  ok  deux codes identiques en attente refusés';
  end;

  -- Code expiré, jamais consommé : l'index partiel le compte encore
  -- (`where consumed_at is null` ne regarde pas l'heure). Il n'appaire
  -- plus rien, mais bloque sa combinaison jusqu'à sa purge — celle que
  -- createTvPairCode fait avant chaque tirage, à l'identique ci-dessous.
  insert into public.display_pair_codes (
    organization_id, location_id, queue_id, display_name,
    code_hash, expires_at, created_by
  ) values (
    v_org, v_loc, v_queue, 'TV expirée',
    repeat('5', 64), now() - interval '1 minute', v_owner
  );
  if public.consume_display_pair_code(repeat('5', 64), repeat('4', 64)) is not null then
    raise exception 'ÉCHEC: un code expiré a appairé un écran';
  end if;
  begin
    insert into public.display_pair_codes (
      organization_id, location_id, queue_id, display_name,
      code_hash, expires_at, created_by
    ) values (
      v_org, v_loc, v_queue, 'TV nouvelle',
      repeat('5', 64), now() + interval '10 minutes', v_owner
    );
    raise exception 'ÉCHEC: un code expiré non purgé ne bloque plus sa combinaison (revoir la purge de createTvPairCode)';
  exception when unique_violation then
    raise notice '  ok  un code expiré non consommé bloque sa combinaison tant qu''il reste en table';
  end;
  delete from public.display_pair_codes
  where expires_at < now() and consumed_at is null;
  insert into public.display_pair_codes (
    organization_id, location_id, queue_id, display_name,
    code_hash, expires_at, created_by
  ) values (
    v_org, v_loc, v_queue, 'TV nouvelle',
    repeat('5', 64), now() + interval '10 minutes', v_owner
  );
  if exists (select 1 from public.display_pair_codes where code_hash = repeat('5', 64) and expires_at < now()) then
    raise exception 'ÉCHEC: la purge a laissé le code expiré';
  end if;
  raise notice '  ok  après la purge des codes expirés, la combinaison ressert';

  -- Fonctions : chemin figé, droits réservés au serveur.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'consume_display_pair_code'
      and p.prosecdef
      and 'search_path=public, internal, extensions' = any(p.proconfig)
  ) then
    raise exception 'ÉCHEC: consume_display_pair_code sans SECURITY DEFINER ou search_path figé';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'internal' and p.proname = 'assert_display_binding_consistency'
      and 'search_path=public, internal, extensions' = any(p.proconfig)
  ) then
    raise exception 'ÉCHEC: garde multi-tenant des écrans sans search_path figé';
  end if;
  if has_function_privilege('anon', 'public.consume_display_pair_code(text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.consume_display_pair_code(text, text)', 'execute')
     or not has_function_privilege('service_role', 'public.consume_display_pair_code(text, text)', 'execute') then
    raise exception 'ÉCHEC: droits de consume_display_pair_code incorrects';
  end if;
  if has_function_privilege('anon', 'internal.assert_display_binding_consistency()', 'execute')
     or has_function_privilege('authenticated', 'internal.assert_display_binding_consistency()', 'execute') then
    raise exception 'ÉCHEC: la garde multi-tenant est appelable depuis le navigateur';
  end if;
  raise notice '  ok  RPC d''appairage : SECURITY DEFINER, search_path figé, service_role seul';

  -- Tables : ni lecture ni écriture depuis le navigateur, RLS active.
  if has_table_privilege('anon', 'public.display_pair_codes', 'select')
     or has_table_privilege('authenticated', 'public.display_pair_codes', 'select')
     or has_table_privilege('anon', 'public.display_devices', 'select')
     or has_table_privilege('authenticated', 'public.display_devices', 'select')
     or has_table_privilege('authenticated', 'public.display_devices', 'update') then
    raise exception 'ÉCHEC: tables des écrans accessibles depuis le navigateur';
  end if;
  if exists (
    select 1 from pg_class
    where oid in ('public.display_pair_codes'::regclass, 'public.display_devices'::regclass)
      and not relrowsecurity
  ) then
    raise exception 'ÉCHEC: RLS inactive sur les tables des écrans';
  end if;
  raise notice '  ok  tables des écrans fermées à anon et authenticated, RLS active';
end
$$;

-- ---------------------------------------------------------------------
-- Nettoyage : tout ce que ce test a créé part, les codes d'avant
-- reviennent. Les écrans et codes suivent l'organisation (cascade) ; le
-- journal (`on delete set null`) et le registre des slugs (sans clé
-- étrangère) sont effacés à la main.
-- ---------------------------------------------------------------------
do $$
declare
  v_owner uuid := (select v from t44 where k = 'owner');
  v_org uuid := (select v from t44 where k = 'org');
begin
  delete from public.display_pair_codes;
  delete from public.audit_logs where organization_id = v_org;
  delete from public.organizations where id = v_org;
  -- Après l'organisation : les sites pointent encore sur leur slug.
  delete from public.slug_registry where organization_id = v_org;
  delete from auth.users where id = v_owner;

  if exists (select 1 from public.display_devices
             where token_hash in (repeat('4', 64), repeat('8', 64), repeat('9', 64)))
     or exists (select 1 from public.organizations where id = v_org)
     or exists (select 1 from public.slug_registry where organization_id = v_org)
     or exists (select 1 from public.audit_logs where organization_id = v_org)
     or exists (select 1 from public.profiles where id = v_owner)
     or exists (select 1 from auth.users where id = v_owner) then
    raise exception 'ÉCHEC: le test 44 laisse des traces en base';
  end if;
  raise notice '  ok  écrans, organisation et utilisateur du test effacés';
end
$$;

insert into public.display_pair_codes select * from saved_pair_codes;
