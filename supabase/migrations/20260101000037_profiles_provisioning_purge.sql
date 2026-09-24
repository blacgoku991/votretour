-- =====================================================================
-- Rangvia — 0037 : profils métier, provisionnement et purge
-- ---------------------------------------------------------------------
-- * create_location (même signature) : la file créée reçoit le profil de
--   l'activité et ses réglages par défaut ; les prestations par défaut
--   du profil sont créées, SAUF en walkin : un barbier qui s'inscrit
--   obtient exactement ce qu'il obtenait avant.
-- * purge_expired_data (même signature) : les informations métier
--   (immatriculation, modèle, devis, jeton de suivi) partent en même
--   temps que les prénoms, à data_retention_days ; les compteurs de
--   numéros des jours passés sont supprimés.
-- * Liste récapitulative des droits de toutes les fonctions publiques
--   créées ou redéfinies par 0034 à 0037.
--
-- Les files existantes ne sont pas touchées : elles restent en walkin.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Création d'un établissement complet (avec file + plaque)
-- ---------------------------------------------------------------------
create or replace function public.create_location(
  p_organization_id uuid,
  p_name            text,
  p_activity        public.activity_type default null,
  p_address_line1   text default null,
  p_postal_code     text default null,
  p_city            text default null,
  p_country_code    text default 'FR',
  p_timezone        text default 'Europe/Paris',
  p_google_review_url text default null,
  p_queue_mode      public.queue_mode default 'shared',
  p_created_by      uuid default null,
  p_slug_hint       text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_location_id uuid := extensions.gen_random_uuid();
  v_slug     text;
  v_location public.locations;
  v_queue    public.queues;
  v_plate    jsonb;
  v_activity public.activity_type;
  v_profile  public.queue_profile;
begin
  select activity into v_activity from public.organizations where id = p_organization_id;
  if not found then
    raise exception 'Organisation introuvable' using errcode = 'VT005';
  end if;
  v_activity := coalesce(p_activity, v_activity);

  v_slug := internal.reserve_slug(
    coalesce(p_slug_hint, p_name), 'location', p_organization_id, v_location_id
  );

  insert into public.locations (
    id, organization_id, name, slug, address_line1, postal_code, city,
    country_code, timezone, google_review_url
  ) values (
    v_location_id, p_organization_id, p_name, v_slug, p_address_line1,
    p_postal_code, p_city, coalesce(p_country_code, 'FR'),
    coalesce(p_timezone, 'Europe/Paris'), p_google_review_url
  )
  returning * into v_location;

  insert into public.queues (
    organization_id, location_id, name, mode, status, is_default
  ) values (
    p_organization_id, v_location_id, 'File principale',
    coalesce(p_queue_mode, 'shared'), 'closed', true
  )
  returning * into v_queue;

  -- Profil de l'activité et réglages cohérents. En walkin, ce sont les
  -- valeurs par défaut des colonnes : rien ne change pour un barbier.
  v_profile := internal.default_profile(v_activity);
  perform internal.apply_profile_defaults(v_queue.id, v_profile, v_activity);
  if v_profile <> 'walkin' then
    perform internal.seed_default_services(v_location_id, v_profile);
  end if;
  select * into v_queue from public.queues where id = v_queue.id;

  -- Horaires par défaut : lundi-samedi 9h-19h, dimanche fermé.
  insert into public.opening_hours (organization_id, location_id, weekday, opens_at, closes_at, is_closed)
  select p_organization_id, v_location_id, d,
         case when d = 6 then null else time '09:00' end,
         case when d = 6 then null else time '19:00' end,
         d = 6
  from generate_series(0, 6) as d;

  v_plate := public.create_plate(
    v_location_id, 'Comptoir', v_queue.id, null, 'both', p_created_by, p_slug_hint
  );

  if p_activity is not null then
    update public.organizations set activity = p_activity
    where id = p_organization_id and activity = 'other';
  end if;

  return jsonb_build_object(
    'location', jsonb_build_object(
      'id', v_location.id, 'name', v_location.name, 'slug', v_location.slug,
      'city', v_location.city, 'timezone', v_location.timezone
    ),
    'queue', jsonb_build_object(
      'id', v_queue.id, 'name', v_queue.name, 'mode', v_queue.mode, 'status', v_queue.status,
      'profile', v_queue.profile
    ),
    'plate', v_plate
  );
end;
$$;

-- ---------------------------------------------------------------------
-- RGPD : purge automatique (même signature qu'en 0009)
-- ---------------------------------------------------------------------
-- Conditions ÉTENDUES, jamais restreintes : un ticket anonymisé avant
-- l'est toujours, au même délai (data_retention_days), et perd en plus
-- ses informations métier. L'immatriculation part ainsi en même temps
-- que le prénom. Les événements 'stage' ne contiennent que des codes
-- d'étape et suivent la règle existante de l'étape 4.
create or replace function public.purge_expired_data()
returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_anonymized int := 0;
  v_sessions   int := 0;
  v_events     int := 0;
  v_deliveries int := 0;
  v_subs       int := 0;
  v_limits     int := 0;
  v_counters   int := 0;
begin
  -- 1. Anonymisation des tickets au-delà de la rétention.
  with expired as (
    select e.id
    from public.queue_entries e
    join public.organization_settings s on s.organization_id = e.organization_id
    where e.joined_at < now() - make_interval(days => s.data_retention_days)
      and (e.client_name is not null
           or e.client_session_id is not null
           or e.details <> '{}'::jsonb
           or e.registration_key is not null
           or e.claim_token_hash is not null)
  )
  update public.queue_entries t
     set client_name = null,
         client_session_id = null,
         staff_note = null,
         metadata = '{}'::jsonb,
         details = '{}'::jsonb,
         registration_key = null,
         claim_token_hash = null,
         claim_expires_at = null
    from expired x
   where t.id = x.id;
  get diagnostics v_anonymized = row_count;

  -- 2. Suppression des sessions clients expirées.
  delete from public.client_sessions cs
  using public.organization_settings s
  where s.organization_id = cs.organization_id
    and (cs.expires_at < now()
         or cs.last_seen_at < now() - make_interval(days => s.data_retention_days));
  get diagnostics v_sessions = row_count;

  -- 3. Abonnements push morts.
  delete from public.notification_subscriptions
  where (expires_at is not null and expires_at < now() - interval '2 days')
     or (not is_active and updated_at < now() - interval '7 days')
     or failure_count >= 8;
  get diagnostics v_subs = row_count;

  -- 4. Historique d'événements au-delà de la rétention du plan.
  delete from public.queue_events qe
  using public.organization_settings s
  where s.organization_id = qe.organization_id
    and qe.created_at < now() - make_interval(days => greatest(s.data_retention_days, 30));
  get diagnostics v_events = row_count;

  delete from public.notification_deliveries
  where created_at < now() - interval '30 days';
  get diagnostics v_deliveries = row_count;

  delete from public.rate_limits where expires_at < now() - interval '1 hour';
  get diagnostics v_limits = row_count;

  delete from public.plate_scans where created_at < now() - interval '180 days';

  -- 5. Compteurs de numéros des jours passés. On garde la veille (jour
  -- UTC) : dans un fuseau en retard sur UTC, c'est encore « aujourd'hui ».
  -- Le compteur continu (1970-01-01) des ateliers n'est jamais supprimé.
  delete from public.queue_ticket_counters
  where scope_day < current_date - 1
    and scope_day <> date '1970-01-01';
  get diagnostics v_counters = row_count;

  return jsonb_build_object(
    'anonymizedEntries', v_anonymized,
    'deletedSessions', v_sessions,
    'deletedSubscriptions', v_subs,
    'deletedEvents', v_events,
    'deletedDeliveries', v_deliveries,
    'deletedRateLimits', v_limits,
    'deletedTicketCounters', v_counters,
    'at', now()
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Droits : liste récapitulative (motif de 0010)
-- ---------------------------------------------------------------------
-- Toutes les fonctions publiques créées ou redéfinies par 0034 à 0037.
-- Aucune n'est appelable par anon ni par authenticated : le serveur
-- Next.js les appelle avec la clé service_role, après avoir authentifié
-- l'appelant, vérifié le tenant et limité le débit. 0034 et 0035 posent
-- déjà ces droits ; les réaffirmer ici rend l'état final lisible d'un
-- coup d'œil et rattrape toute redéfinition future par erreur.
do $$
declare
  fn text;
  fns text[] := array[
    -- 0034 : moteur
    'public.join_queue(uuid,uuid,text,uuid,uuid,public.entry_source,uuid,jsonb)',
    'public.add_walkin(uuid,text,uuid,uuid,uuid,uuid,jsonb)',
    'public.client_queue_action(text,uuid,text)',
    'public.staff_queue_action(text,text,uuid,uuid,jsonb)',
    'public.claim_pending_notifications(uuid)',
    'public.claim_entry_notification(uuid,public.notification_kind)',
    'public.claim_entry_notification_key(uuid,text)',
    'public.claim_due_review_notifications(int)',
    'public.expire_stale_entries()',
    'public.desk_call_next(uuid,uuid,uuid)',
    'public.peek_claim(text)',
    'public.claim_entry(text,uuid)',
    'public.switch_queue_profile(uuid,public.queue_profile,uuid)',
    -- 0035 : sérialisation
    'public.resolve_entry_point(text)',
    'public.ticket_state(text,uuid)',
    'public.queue_snapshot(uuid)',
    -- 0037 : provisionnement et purge
    'public.create_location(uuid,text,public.activity_type,text,text,text,text,text,text,public.queue_mode,uuid,text)',
    'public.purge_expired_data()'
  ];
begin
  foreach fn in array fns loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end
$$;

notify pgrst, 'reload schema';

commit;
