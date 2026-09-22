-- =====================================================================
-- VotreTour — 0011 : création de compte, d'établissement et de plaques
-- =====================================================================

-- ---------------------------------------------------------------------
-- Création d'une plaque (NFC + QR + URL unique)
-- ---------------------------------------------------------------------
create or replace function public.create_plate(
  p_location_id uuid,
  p_label       text default 'Plaque comptoir',
  p_queue_id    uuid default null,
  p_staff_id    uuid default null,
  p_kind        public.plate_kind default 'both',
  p_created_by  uuid default null,
  p_slug_hint   text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_location public.locations;
  v_plate_id uuid := extensions.gen_random_uuid();
  v_code     text;
  v_queue    uuid := p_queue_id;
  v_plate    public.plates;
begin
  select * into v_location from public.locations where id = p_location_id;
  if not found then
    raise exception 'Établissement introuvable' using errcode = 'VT005';
  end if;

  if v_queue is null then
    select id into v_queue from public.queues
    where location_id = p_location_id
    order by is_default desc, created_at limit 1;
  end if;

  v_code := internal.reserve_slug(
    coalesce(p_slug_hint, v_location.name || '-' || p_label),
    'plate', v_location.organization_id, v_plate_id
  );

  insert into public.plates (
    id, organization_id, location_id, queue_id, staff_id, code, label, kind, created_by
  ) values (
    v_plate_id, v_location.organization_id, p_location_id, v_queue, p_staff_id,
    v_code, p_label, p_kind, p_created_by
  )
  returning * into v_plate;

  return jsonb_build_object(
    'id', v_plate.id, 'code', v_plate.code, 'label', v_plate.label,
    'kind', v_plate.kind, 'queueId', v_plate.queue_id, 'staffId', v_plate.staff_id,
    'isActive', v_plate.is_active
  );
end;
$$;

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
begin
  if not exists (select 1 from public.organizations where id = p_organization_id) then
    raise exception 'Organisation introuvable' using errcode = 'VT005';
  end if;

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
      'id', v_queue.id, 'name', v_queue.name, 'mode', v_queue.mode, 'status', v_queue.status
    ),
    'plate', v_plate
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Provisionnement complet d'un nouveau compte professionnel
-- ---------------------------------------------------------------------
-- Appelé par l'onboarding : crée l'organisation, rattache le
-- propriétaire, crée l'établissement, sa file, sa plaque et démarre la
-- période d'essai. Le tout dans une seule transaction.
create or replace function public.provision_organization(
  p_user_id       uuid,
  p_org_name      text,
  p_activity      public.activity_type default 'other',
  p_location_name text default null,
  p_queue_mode    public.queue_mode default 'shared',
  p_plan_code     text default 'starter'
) returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_org      public.organizations;
  v_slug     text;
  v_location jsonb;
  v_plan     public.plans;
  v_attempt  int := 0;
begin
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Compte introuvable' using errcode = 'VT005';
  end if;

  -- Slug d'organisation (espace de noms distinct de /e/).
  loop
    v_slug := case when v_attempt = 0
      then coalesce(internal.slugify(p_org_name), 'org')
      else coalesce(internal.slugify(p_org_name), 'org') || '-' || lower(internal.generate_public_id(4))
    end;
    exit when not exists (select 1 from public.organizations where slug = v_slug);
    v_attempt := v_attempt + 1;
    if v_attempt > 10 then
      raise exception 'Impossible de générer un identifiant d''organisation';
    end if;
  end loop;

  insert into public.organizations (name, slug, activity, created_by, onboarding_step)
  values (p_org_name, v_slug, coalesce(p_activity, 'other'), p_user_id, 'location')
  returning * into v_org;

  insert into public.organization_members (organization_id, user_id, role, status, accepted_at)
  values (v_org.id, p_user_id, 'owner', 'active', now());

  select * into v_plan from public.plans where code = p_plan_code and is_active;
  if not found then
    select * into v_plan from public.plans where is_active order by sort_order limit 1;
  end if;

  if found then
    insert into public.subscriptions (
      organization_id, plan_id, status, trial_ends_at, current_period_start, current_period_end
    ) values (
      v_org.id, v_plan.id, 'trialing',
      now() + make_interval(days => v_plan.trial_days),
      now(), now() + make_interval(days => v_plan.trial_days)
    );
  end if;

  if p_location_name is not null then
    v_location := public.create_location(
      v_org.id, p_location_name, p_activity, null, null, null, 'FR',
      'Europe/Paris', null, p_queue_mode, p_user_id
    );
  end if;

  insert into public.audit_logs (organization_id, actor, actor_user_id, action, target_type, target_id)
  values (v_org.id, 'staff', p_user_id, 'organization.created', 'organization', v_org.id::text);

  return jsonb_build_object(
    'organization', jsonb_build_object(
      'id', v_org.id, 'name', v_org.name, 'slug', v_org.slug, 'activity', v_org.activity
    ),
    'location', v_location -> 'location',
    'queue', v_location -> 'queue',
    'plate', v_location -> 'plate',
    'plan', case when v_plan.id is null then null
                 else jsonb_build_object('code', v_plan.code, 'name', v_plan.name,
                                         'trialDays', v_plan.trial_days) end
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Quotas : vérifie qu'une organisation peut encore créer une ressource
-- ---------------------------------------------------------------------
create or replace function public.check_org_quota(
  p_organization_id uuid,
  p_resource        text
) returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_plan    public.plans;
  v_sub     public.subscriptions;
  v_limit   int;
  v_used    int;
  v_override jsonb;
begin
  select * into v_sub from public.subscriptions where organization_id = p_organization_id;
  if found then
    select * into v_plan from public.plans where id = v_sub.plan_id;
  end if;
  if v_plan.id is null then
    select * into v_plan from public.plans where is_active order by sort_order limit 1;
  end if;

  v_override := coalesce(v_sub.quota_overrides, '{}'::jsonb);

  v_limit := case p_resource
    when 'locations' then coalesce((v_override ->> 'max_locations')::int, v_plan.max_locations)
    when 'staff'     then coalesce((v_override ->> 'max_staff')::int, v_plan.max_staff)
    when 'plates'    then coalesce((v_override ->> 'max_plates')::int, v_plan.max_plates)
    when 'queues'    then coalesce((v_override ->> 'max_queues')::int, v_plan.max_queues)
    else null
  end;

  v_used := case p_resource
    when 'locations' then (select count(*) from public.locations where organization_id = p_organization_id)
    when 'staff'     then (select count(*) from public.staff where organization_id = p_organization_id and is_active)
    when 'plates'    then (select count(*) from public.plates where organization_id = p_organization_id and is_active)
    when 'queues'    then (select count(*) from public.queues where organization_id = p_organization_id)
    else 0
  end;

  return jsonb_build_object(
    'resource', p_resource,
    'used', v_used,
    'limit', v_limit,
    -- -1 = illimité
    'allowed', v_limit is null or v_limit < 0 or v_used < v_limit,
    'planCode', v_plan.code,
    'subscriptionStatus', v_sub.status
  );
end;
$$;

do $$
declare fn text;
  fns text[] := array[
    'public.create_plate(uuid,text,uuid,uuid,public.plate_kind,uuid,text)',
    'public.create_location(uuid,text,public.activity_type,text,text,text,text,text,text,public.queue_mode,uuid,text)',
    'public.provision_organization(uuid,text,public.activity_type,text,public.queue_mode,text)',
    'public.check_org_quota(uuid,text)'
  ];
begin
  foreach fn in array fns loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end
$$;
