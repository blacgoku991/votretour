-- =====================================================================
-- Rangvia — l'offre unique et ses frais d'installation (0043)
-- ---------------------------------------------------------------------
-- Ce test tient ce que la base garantit seule :
--
--   - UNE offre active et publique, `rangvia` : 5 990 centimes par mois,
--     14 900 de frais d'installation, pas de prix annuel, en euros ;
--   - ses quotas et ses fonctions sont ceux de l'ancienne offre la plus
--     complète (Business, tout illimité) ;
--   - les anciennes offres sont toujours là (jamais supprimées), mais ni
--     actives ni publiques : un visiteur anonyme ne voit que `rangvia` ;
--   - les frais ne peuvent pas être négatifs ; l'heure de paiement des
--     frais est vide par défaut, et un membre ne peut pas l'écrire ;
--   - un nouveau compte, quelle que soit l'offre demandée par l'ancien
--     code (`starter`, `pro`), est rattaché à l'offre unique, et ses
--     quotas sont ceux de l'offre unique ;
--   - un abonnement déjà PAYÉ sur une ancienne offre la garde : l'offre
--     retirée reste lisible par son abonnement et par les quotas.
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

do $$
declare
  v_offer    public.plans;
  v_business public.plans;
  v_owner    uuid;
  v_prov     jsonb;
  v_org      uuid;
  v_paid_org uuid;
  v_quota    jsonb;
  v_n        int;
  v_codes    text;
  v_role     text;
begin
  raise notice '';
  raise notice '── L’offre unique : rangvia ──';

  select * into v_offer from public.plans where code = 'rangvia';
  perform internal.assert(v_offer.id is not null, 'l’offre rangvia existe');
  perform internal.assert_eq(v_offer.price_month_cents, 5990, 'prix mensuel HT (centimes)');
  perform internal.assert_eq(v_offer.setup_fee_cents, 14900, 'frais d’installation HT (centimes)');
  perform internal.assert_eq(v_offer.price_year_cents, 0, 'aucun prix annuel');
  perform internal.assert_eq(v_offer.currency, 'EUR', 'devise');
  perform internal.assert(v_offer.is_active and v_offer.is_public, 'active et publique');
  perform internal.assert(v_offer.stripe_price_id_setup is null and v_offer.stripe_price_id_month is null,
    'aucun identifiant Stripe inventé : le super-admin les renseigne');

  select count(*) into v_n from public.plans where is_active;
  perform internal.assert_eq(v_n, 1, 'une seule offre active');
  select count(*) into v_n from public.plans where is_public;
  perform internal.assert_eq(v_n, 1, 'une seule offre publique');

  raise notice '';
  raise notice '── Les quotas de l’ancienne offre la plus complète ──';

  select * into v_business from public.plans where code = 'business';
  perform internal.assert(v_business.id is not null, 'l’ancienne offre Business est toujours en base');
  perform internal.assert_eq(
    array[v_offer.max_locations, v_offer.max_staff, v_offer.max_plates, v_offer.max_queues, v_offer.history_days],
    array[v_business.max_locations, v_business.max_staff, v_business.max_plates, v_business.max_queues, v_business.history_days],
    'quotas repris de Business');
  perform internal.assert_eq(v_offer.features, v_business.features, 'fonctions reprises de Business');

  raise notice '';
  raise notice '── Les anciennes offres : retirées, jamais supprimées ──';

  select string_agg(code, ',' order by code) into v_codes
    from public.plans where code in ('starter', 'pro', 'business') and not is_active and not is_public;
  perform internal.assert_eq(v_codes, 'business,pro,starter', 'starter, pro et business : ni actives ni publiques');

  -- Ce que voit un visiteur de /tarifs et des pages métier (clé anon).
  set local role anon;
  select string_agg(code, ',' order by code) into v_codes from public.plans;
  reset role;
  perform internal.assert_eq(v_codes, 'rangvia', 'anon ne voit que l’offre unique');

  raise notice '';
  raise notice '── Frais d’installation : bornes et droits ──';

  begin
    update public.plans set setup_fee_cents = -1 where id = v_offer.id;
    raise exception 'ÉCHEC: des frais négatifs ont été acceptés';
  exception when check_violation then
    raise notice '  ok  frais négatifs refusés';
  end;

  perform internal.assert(
    has_column_privilege('service_role', 'public.subscriptions', 'setup_fee_paid_at', 'update'),
    'le webhook (service_role) peut horodater le paiement des frais');
  foreach v_role in array array['anon', 'authenticated'] loop
    perform internal.assert(
      not has_column_privilege(v_role, 'public.subscriptions', 'setup_fee_paid_at', 'update')
        and not has_column_privilege(v_role, 'public.plans', 'setup_fee_cents', 'update')
        and not has_column_privilege(v_role, 'public.plans', 'stripe_price_id_setup', 'update'),
      format('%s ne peut écrire ni les frais ni leur paiement', v_role));
  end loop;

  raise notice '';
  raise notice '── Un nouveau compte : l’offre unique, frais à payer ──';

  v_owner := extensions.gen_random_uuid();
  insert into auth.users (id, email) values (v_owner, 'offre-unique@test.local');
  -- L'ancien code par défaut ('starter') n'est plus actif : repli sur
  -- la première offre active, l'offre unique.
  v_prov := public.provision_organization(v_owner, 'Salon Offre Unique', 'barber', 'Salon — Lyon', 'shared', 'starter');
  v_org := (v_prov -> 'organization' ->> 'id')::uuid;
  perform internal.assert_eq(v_prov -> 'plan' ->> 'code', 'rangvia', 'provisionnement : offre unique');
  perform internal.assert_eq(
    (select p.code from public.subscriptions s join public.plans p on p.id = s.plan_id where s.organization_id = v_org),
    'rangvia', 'abonnement d’essai rattaché à rangvia');
  perform internal.assert(
    (select setup_fee_paid_at is null and stripe_subscription_id is null
       from public.subscriptions where organization_id = v_org),
    'frais d’installation pas encore payés (premier abonnement à venir)');

  v_prov := public.provision_organization(v_owner, 'Garage Ancien Code', 'garage', null, 'shared', 'pro');
  perform internal.assert_eq(v_prov -> 'plan' ->> 'code', 'rangvia', 'ancien code « pro » : offre unique aussi');

  v_quota := public.check_org_quota(v_org, 'staff');
  perform internal.assert_eq(v_quota ->> 'planCode', 'rangvia', 'quotas lus sur l’offre unique');
  perform internal.assert_eq((v_quota ->> 'limit')::int, v_offer.max_staff, 'limite de professionnels de l’offre unique');

  raise notice '';
  raise notice '── Un abonnement payé sur une ancienne offre la garde ──';

  v_prov := public.provision_organization(v_owner, 'Fidèle Pro', 'barber', null, 'shared', 'rangvia');
  v_paid_org := (v_prov -> 'organization' ->> 'id')::uuid;
  update public.subscriptions
     set plan_id = (select id from public.plans where code = 'pro'),
         status = 'active', stripe_subscription_id = 'sub_test_fidele'
   where organization_id = v_paid_org;
  v_quota := public.check_org_quota(v_paid_org, 'locations');
  perform internal.assert_eq(v_quota ->> 'planCode', 'pro', 'l’offre retirée reste lisible par son abonnement');
  perform internal.assert_eq((v_quota ->> 'limit')::int,
    (select max_locations from public.plans where code = 'pro'), 'et ses quotas s’appliquent toujours');

  begin
    delete from public.plans where code = 'pro';
    raise exception 'ÉCHEC: une offre souscrite a pu être supprimée';
  exception when foreign_key_violation then
    raise notice '  ok  une offre souscrite ne peut pas être supprimée';
  end;

  raise notice '';
  raise notice '── Le passage à l’offre unique est journalisé ──';

  perform internal.assert(
    exists (select 1 from public.audit_logs
             where action = 'plans.single_offer' and target_id = v_offer.id::text
               and metadata ->> 'quotasFrom' = 'business'),
    'audit : offre unique créée, quotas repris de business');

  raise notice '✅ Offre unique : 59,90 € HT/mois + 149 € HT d’installation, anciennes offres retirées sans suppression';
end
$$;

rollback;
