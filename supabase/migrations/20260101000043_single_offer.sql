-- =====================================================================
-- Rangvia — 0043 : une offre unique, avec des frais d'installation
-- =====================================================================
-- Décision du propriétaire : plus de packs. Rangvia se vend en une seule
-- offre, 59,90 € HT par mois, plus 149 € HT de frais d'installation payés
-- une fois. L'installation, c'est le travail de l'équipe Rangvia : le
-- métier de la file est activé par le super-admin, les réglages posés
-- avec le commerçant. Tous les prix du site sont hors taxes.
--
-- Ce que fait ce fichier :
--
--   1. FRAIS D'INSTALLATION SUR L'OFFRE. `plans.setup_fee_cents` (entier
--      ≥ 0, modifiable dans /admin/offres comme le prix mensuel) et
--      `plans.stripe_price_id_setup`, le prix Stripe PONCTUEL que la
--      session de paiement ajoute au premier abonnement. Sans ce prix
--      Stripe alors que les frais sont non nuls, l'application REFUSE
--      d'ouvrir le paiement (server/actions/billing.ts) : on n'encaisse
--      jamais un abonnement sans ses frais par erreur.
--
--   2. FRAIS PAYÉS UNE FOIS. `subscriptions.setup_fee_paid_at` : l'heure
--      à laquelle Stripe a confirmé le paiement des frais, posée par le
--      webhook (api/stripe/webhook), jamais par le commerçant — les
--      membres ne lisent `subscriptions` qu'en lecture (0010). Une ligne
--      par organisation (contrainte d'unicité de 0005) : la colonne dit
--      donc bien « cette organisation a réglé son installation ». La
--      règle de l'application est aussi simple que ça : frais dus tant
--      que la colonne est vide. Un abonnement payant ANTÉRIEUR à l'offre
--      unique (aucun en production : Rangvia n'est pas lancé, mais la
--      migration ne le suppose pas) est réputé réglé à sa date de début :
--      il n'a jamais eu de frais à payer, et un changement d'offre ne doit
--      pas les lui réclamer après coup.
--
--   2 bis. L'INSTALLATION FAITE. `subscriptions.setup_done_at` : l'heure
--      à laquelle l'équipe Rangvia a terminé l'installation (métier
--      activé, réglages posés avec le commerçant). L'installation est un
--      service humain : une fois les frais payés, quelqu'un doit s'en
--      charger. Le super-admin voit dans /admin/offres les « installations
--      à faire » (frais payés, installation pas encore faite) et pose
--      cette heure quand c'est fait ; elle ne s'écrit que côté serveur,
--      comme `setup_fee_paid_at`.
--
--   3. L'OFFRE UNIQUE. Code `rangvia`, publique et active, 5 990 centimes
--      par mois, 14 900 de frais d'installation, SANS prix annuel (0 : la
--      bascule mensuel/annuel disparaît du site). Ses quotas et ses
--      fonctions (`features`) sont ceux de l'ancienne offre la plus
--      complète : personne ne perd rien en passant à l'offre unique, et le
--      super-admin peut les ajuster ensuite sans redéploiement.
--
--   4. LES ANCIENNES OFFRES SE RETIRENT, SANS ÊTRE SUPPRIMÉES.
--      `is_active = false` et `is_public = false` : elles sortent du site
--      (policy `plans_public_select`) et du paiement (startCheckout
--      n'ouvre qu'une offre active), mais restent en base, parce que des
--      abonnements, le journal d'audit et les événements Stripe y
--      renvoient (`subscriptions.plan_id … on delete restrict`).
--
--   5. LES ESSAIS PASSENT À L'OFFRE UNIQUE. Un abonnement qui n'a jamais
--      été payé (aucun `stripe_subscription_id`) et qui pointe sur une
--      ancienne offre est rattaché à `rangvia` : l'espace commerçant montre
--      l'offre qu'il pourra réellement souscrire, avec ses quotas. Un
--      abonnement déjà payé garde son offre : Stripe continue de facturer
--      le prix souscrit, et le changer ici mentirait sur la facture.
--
-- `provision_organization` n'est pas redéfinie : son offre par défaut
-- (`starter`) n'est plus active, elle retombe donc d'elle-même sur la
-- première offre active par `sort_order`, c'est-à-dire `rangvia`.
--
-- Hors des plages Wallet (0021-0030) et profils (0031-0038) : aucune de
-- leurs tables ni fonctions n'est lue ou modifiée ici.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Frais d'installation de l'offre
-- ---------------------------------------------------------------------
alter table public.plans
  add column if not exists setup_fee_cents int not null default 0,
  add column if not exists stripe_price_id_setup text;

alter table public.plans drop constraint if exists plans_setup_fee_cents_check;
alter table public.plans
  add constraint plans_setup_fee_cents_check check (setup_fee_cents >= 0);

comment on column public.plans.setup_fee_cents is
  'Frais d''installation HT, en centimes, payés une fois au premier abonnement de l''organisation. 0 = aucun.';
comment on column public.plans.stripe_price_id_setup is
  'Prix Stripe ponctuel (one-off) des frais d''installation. Obligatoire dès que setup_fee_cents > 0 : sans lui, le paiement est refusé.';

-- ---------------------------------------------------------------------
-- 2. Frais payés : l'heure, posée par le webhook Stripe
-- ---------------------------------------------------------------------
alter table public.subscriptions
  add column if not exists setup_fee_paid_at timestamptz;

comment on column public.subscriptions.setup_fee_paid_at is
  'Heure à laquelle Stripe a confirmé le paiement des frais d''installation (webhook, une seule fois). null = frais encore dus au premier abonnement. Abonnements payants antérieurs à 0043 : réputés réglés.';

alter table public.subscriptions
  add column if not exists setup_done_at timestamptz;

comment on column public.subscriptions.setup_done_at is
  'Heure à laquelle l''équipe Rangvia a terminé l''installation (posée par le super-admin, /admin/offres). Frais payés et colonne vide = installation à faire.';

-- Les abonnements déjà payés avant l'offre unique n'ont jamais eu de frais
-- d'installation : réputés réglés, à la date de début de l'abonnement, et
-- sans installation à faire (ils fonctionnent déjà).
update public.subscriptions
   set setup_fee_paid_at = coalesce(current_period_start, created_at),
       setup_done_at     = coalesce(setup_done_at, current_period_start, created_at)
 where stripe_subscription_id is not null
   and setup_fee_paid_at is null;

-- La liste « Installations à faire » du super-admin : frais payés,
-- installation pas encore faite. Index partiel, minuscule par nature.
create index if not exists subscriptions_setup_todo_idx
  on public.subscriptions (setup_fee_paid_at)
  where setup_fee_paid_at is not null and setup_done_at is null;

-- ---------------------------------------------------------------------
-- 3. L'offre unique, avec les quotas de l'ancienne offre la plus complète
-- ---------------------------------------------------------------------
do $$
declare
  v_source public.plans;
  v_offer  uuid;
  v_moved  int;
begin
  -- « La plus complète » : les quotas comparés un à un, illimité (-1)
  -- au-dessus de tout nombre, puis le prix pour départager. On préfère une
  -- offre encore active : c'est celle que le super-admin tenait à jour.
  select * into v_source
    from public.plans
   where code <> 'rangvia'
   order by is_active desc,
            (case when max_locations < 0 then 2147483647 else max_locations end) desc,
            (case when max_staff     < 0 then 2147483647 else max_staff     end) desc,
            (case when max_plates    < 0 then 2147483647 else max_plates    end) desc,
            (case when max_queues    < 0 then 2147483647 else max_queues    end) desc,
            (case when history_days  < 0 then 2147483647 else history_days  end) desc,
            price_month_cents desc,
            code
   limit 1;

  select id into v_offer from public.plans where code = 'rangvia';

  if v_offer is null then
    insert into public.plans (
      code, name, tagline, description, currency,
      price_month_cents, price_year_cents, setup_fee_cents,
      trial_days, max_locations, max_staff, max_plates, max_queues, history_days,
      features, is_active, is_public, sort_order
    ) values (
      'rangvia', 'Rangvia',
      'Une file d’attente installée et réglée pour votre métier.',
      'L’équipe Rangvia installe votre file, active votre métier et règle tout avec vous. Ensuite, un seul abonnement, tout compris.',
      'EUR',
      5990, 0, 14900,
      coalesce(v_source.trial_days, 14),
      coalesce(v_source.max_locations, -1),
      coalesce(v_source.max_staff, -1),
      coalesce(v_source.max_plates, -1),
      coalesce(v_source.max_queues, -1),
      coalesce(v_source.history_days, 730),
      coalesce(v_source.features, '{}'::jsonb),
      true, true, 10
    )
    returning id into v_offer;
  else
    -- Rejeu sur une base qui aurait déjà la ligne : on remet seulement
    -- l'offre en vitrine. Prix et quotas éventuellement retouchés par le
    -- super-admin ne sont pas écrasés.
    update public.plans set is_active = true, is_public = true where id = v_offer;
  end if;

  -- 4. Les anciennes offres quittent le site et le paiement, sans être
  --    supprimées (abonnements, audit et événements Stripe y renvoient).
  update public.plans
     set is_active = false, is_public = false
   where id <> v_offer and (is_active or is_public);

  -- 5. Les abonnements jamais payés suivent l'offre unique.
  update public.subscriptions s
     set plan_id = v_offer
   where s.plan_id <> v_offer
     and s.stripe_subscription_id is null;
  get diagnostics v_moved = row_count;

  insert into public.audit_logs (actor, action, target_type, target_id, metadata)
  values ('system', 'plans.single_offer', 'plan', v_offer::text,
          jsonb_build_object(
            'quotasFrom', v_source.code,
            'unpaidSubscriptionsMoved', v_moved));
end
$$;

commit;

notify pgrst, 'reload schema';
