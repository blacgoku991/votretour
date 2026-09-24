-- =====================================================================
-- Rangvia — 0042 : le métier d'une file est attribué par l'équipe Rangvia
-- ---------------------------------------------------------------------
-- Décision du propriétaire : le métier (profil de file : walkin, vehicle,
-- device, table, desk, retail, event) est attribué par le super-admin
-- SEULEMENT, à l'installation. Le commerçant déclare son activité à
-- l'inscription ; il ne choisit ni ne change son métier.
--
-- Conséquence ici : la création d'un établissement ne déduit plus aucun
-- profil de l'activité.
--
-- * create_location (même signature que 0037) : la file naît TOUJOURS au
--   passage (walkin), avec les réglages d'un barbier qui s'inscrit, et
--   sans prestation par défaut, quelle que soit l'activité (garage,
--   restaurant, santé…). L'activité déclarée reste inscrite telle quelle
--   sur l'organisation (même règle qu'avant : seulement si elle était
--   encore « other »). Pour un barbier, rien ne change : c'était déjà
--   walkin, avec exactement ces réglages (test 11).
-- * provision_organization (0011) n'est pas redéfinie : elle délègue la
--   file à create_location, et hérite donc de la règle.
--
-- L'attribution d'un métier passe par public.switch_queue_profile (0034),
-- appelée par l'action serveur réservée au super-admin
-- (server/actions/admin-profiles.ts). Elle garde son refus VT017 tant
-- qu'un ticket est actif, ses réglages par défaut du métier
-- (apply_profile_defaults, qui relit l'activité de l'organisation : une
-- activité « health » donne bien un guichet de santé) et ses motifs par
-- défaut. Rien n'est changé à cette fonction.
--
-- Les files existantes ne sont pas touchées.
-- =====================================================================

begin;

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

  -- Toujours le passage : ce sont les valeurs par défaut des colonnes,
  -- posées par le même chemin qu'en 0037 pour un barbier (le mode de file
  -- choisi est gardé en walkin). Le métier viendra du super-admin.
  perform internal.apply_profile_defaults(v_queue.id, 'walkin', v_activity);
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

  -- L'activité déclarée est gardée telle quelle : elle renseigne l'équipe
  -- Rangvia (et, plus tard, les réglages par défaut du métier attribué).
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

comment on function public.create_location(uuid,text,public.activity_type,text,text,text,text,text,text,public.queue_mode,uuid,text) is
  'Crée un établissement, sa file (toujours au passage : le métier est attribué par le super-admin) et sa plaque. Réservée à service_role.';

-- Motif de 0010 : jamais appelable depuis le navigateur. `create or
-- replace` garde les droits de 0037 ; on les repose pour que ce fichier
-- se suffise à lui-même.
revoke all on function public.create_location(uuid,text,public.activity_type,text,text,text,text,text,text,public.queue_mode,uuid,text)
  from public, anon, authenticated;
grant execute on function public.create_location(uuid,text,public.activity_type,text,text,text,text,text,text,public.queue_mode,uuid,text)
  to service_role;

notify pgrst, 'reload schema';

commit;
