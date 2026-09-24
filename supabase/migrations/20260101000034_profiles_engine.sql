-- =====================================================================
-- Rangvia — 0034 : profils métier, moteur
-- ---------------------------------------------------------------------
-- Le moteur ne change que là où le profil l'exige, et toujours derrière
-- une condition qui ne peut pas être vraie en walkin :
--   * profile <> 'walkin' (ou un test équivalent sur le profil) ;
--   * stage is not null (toujours null en walkin) ;
--   * profile_options ? … ({} en walkin).
-- En walkin, chaque fonction suit donc exactement le chemin d'avant :
-- les tests SQL 01 à 07 passent sans aucune modification.
--
-- Codes d'erreur ajoutés à la table de 0007. VT011 à VT014 sont déjà
-- pris par les plaques (0013, 0017 : introuvable, verrouillée,
-- indisponible, quantité) et traduits comme tels par lib/errors.ts ; les
-- profils prennent donc la suite :
--   VT015 informations invalides (champ hors liste blanche, format,
--         immatriculation manquante, couverts hors limites…)
--   VT016 trop de messages (10 par ticket, 30 s entre deux)
--   VT017 file non vide : « Terminez ou videz la file avant de changer
--         de profil »
--
-- Fonctions publiques : security definer, search_path figé, réservées à
-- service_role (droits révoqués pour public, anon et authenticated dès
-- ce fichier ; 0037 en redonne la liste récapitulative).
-- =====================================================================

begin;

-- =====================================================================
-- 1. Fonctions internes pures
-- =====================================================================

-- Profil par défaut d'une activité. Le tableau est écrit une ligne par
-- activité, ('activité', 'profil') : lib/profiles/index.ts en porte le
-- miroir exact, et un test vitest compare les deux en lisant ce fichier.
create or replace function internal.default_profile(p_activity public.activity_type)
returns public.queue_profile
language sql
immutable
as $$
  select coalesce((
    select m.profile::public.queue_profile
    from (values
      ('barber',        'walkin'),
      ('hair_salon',    'walkin'),
      ('nail_bar',      'walkin'),
      ('beauty',        'walkin'),
      ('other',         'walkin'),
      ('garage',        'vehicle'),
      ('auto_center',   'vehicle'),
      ('phone_repair',  'device'),
      ('aftersales',    'device'),
      ('restaurant',    'table'),
      ('counter',       'desk'),
      ('admin_service', 'desk'),
      ('health',        'desk'),
      ('shop',          'retail'),
      ('event',         'event')
    ) as m(activity, profile)
    where m.activity = p_activity::text
  ), 'walkin'::public.queue_profile);
$$;

-- Profils où le client suit une position (« N personnes devant vous »).
-- En atelier, ce qui avance est un véhicule ou un appareil, prêt dans le
-- désordre : la position n'a pas de sens pour les notifications.
create or replace function internal.profile_uses_position(p public.queue_profile)
returns boolean
language sql
immutable
as $$
  select p in ('walkin', 'table', 'desk', 'retail', 'event');
$$;

-- Profils où « c'est votre tour » suppose un appel explicite : au
-- restaurant, le premier groupe de la liste n'a pas de table tant que
-- l'hôte ne l'appelle pas ; au guichet, on attend son numéro. La tête de
-- file y reçoit donc « vous êtes les prochains », pas « c'est votre tour ».
create or replace function internal.profile_call_based(p public.queue_profile)
returns boolean
language sql
immutable
as $$
  select p in ('table', 'desk');
$$;

-- Un technicien a plusieurs véhicules ou appareils en cours à la fois.
create or replace function internal.profile_parallel(p public.queue_profile)
returns boolean
language sql
immutable
as $$
  select p in ('vehicle', 'device');
$$;

-- TERMINER enchaîne-t-il automatiquement sur le suivant ? Jamais en
-- atelier (les véhicules sont prêts dans le désordre) ni au restaurant
-- (la table libérée ne convient pas forcément au groupe suivant).
create or replace function internal.profile_auto_advance(p public.queue_profile)
returns boolean
language sql
immutable
as $$
  select p not in ('vehicle', 'device', 'table');
$$;

-- Étapes déclarées par profil et statut correspondant. Une ligne par
-- étape, ('profil', 'étape', 'statut') : lib/profiles/<profil>.ts en
-- porte le vocabulaire, et un test vitest (profile-parity) vérifie en
-- lisant ce tableau que chaque étape a ses libellés, et inversement.
-- Renvoie null si l'étape est inconnue pour ce profil.
create or replace function internal.stage_status(p public.queue_profile, p_stage text)
returns public.entry_status
language sql
immutable
as $$
  select s.status::public.entry_status
  from (values
    ('vehicle', 'received',      'waiting'),
    ('vehicle', 'diagnosis',     'serving'),
    ('vehicle', 'quote_pending', 'serving'),
    ('vehicle', 'waiting_parts', 'serving'),
    ('vehicle', 'in_repair',     'serving'),
    ('vehicle', 'ready',         'next'),
    ('device',  'received',      'waiting'),
    ('device',  'diagnosis',     'serving'),
    ('device',  'quote_pending', 'serving'),
    ('device',  'waiting_parts', 'serving'),
    ('device',  'in_repair',     'serving'),
    ('device',  'ready',         'next'),
    ('retail',  'preparing',     'serving'),
    ('retail',  'ready',         'next')
  ) as s(profile, stage, status)
  where s.profile = p::text and s.stage = p_stage;
$$;

-- Étape posée à l'inscription : « reçu » en atelier, aucune ailleurs.
create or replace function internal.initial_stage(p public.queue_profile)
returns text
language sql
immutable
as $$
  select case when p in ('vehicle', 'device') then 'received' end;
$$;

-- Étape cohérente avec un statut atteint par une action générique
-- (démarrer, décaler, remettre en file…). Renvoie l'étape courante quand
-- le couple reste légitime : « prêt » + « le client arrive » (present).
create or replace function internal.stage_for_status(
  p       public.queue_profile,
  p_stage text,
  p_status public.entry_status
) returns text
language sql
immutable
as $$
  select case
    when p_status = 'waiting' then internal.initial_stage(p)
    when p_status = 'serving' and p in ('vehicle', 'device')
      then case when p_stage = 'received' then 'diagnosis' else 'in_repair' end
    when p_status = 'serving' and p = 'retail' then 'preparing'
    when p_status = 'next' and p in ('vehicle', 'device', 'retail') then 'ready'
    else p_stage
  end;
$$;

-- Immatriculation normalisée : majuscules, lettres et chiffres seulement.
-- « ab 123-cd » donne AB123CD. Null si rien ne reste.
create or replace function internal.normalize_registration(p_value text)
returns text
language sql
immutable
as $$
  select nullif(upper(regexp_replace(coalesce(p_value, ''), '[^A-Za-z0-9]', '', 'g')), '');
$$;

-- Masquage : seuls les 3 derniers caractères alphanumériques restent
-- lisibles, les séparateurs sont conservés. AB-123-CD donne ••-••3-CD,
-- 1234 AB 75 donne •••• •B 75. C'est la seule forme qui quitte le poste
-- du professionnel (écran TV, aperçu de rattachement, notifications).
create or replace function internal.mask_registration(p_value text)
returns text
language plpgsql
immutable
as $$
declare
  v_out  text := '';
  v_seen int := 0;
  v_ch   text;
  i      int;
begin
  if p_value is null or internal.normalize_registration(p_value) is null then
    return null;
  end if;
  for i in reverse length(p_value) .. 1 loop
    v_ch := substr(p_value, i, 1);
    if v_ch ~ '[A-Za-z0-9]' then
      v_seen := v_seen + 1;
      v_out := case when v_seen <= 3 then upper(v_ch) else '•' end || v_out;
    else
      v_out := v_ch || v_out;
    end if;
  end loop;
  return v_out;
end;
$$;

-- Forme d'affichage d'une immatriculation saisie. France : SIV
-- (AB-123-CD) ou FNI (1234 AB 75) quand la saisie s'y prête, sinon la
-- saisie en majuscules. Le contrôle strict des formats est fait côté
-- serveur Next.js (lib/profiles/registration.ts) ; ici on reste souple,
-- en défense en profondeur seulement.
create or replace function internal.format_registration(p_value text, p_country text)
returns text
language plpgsql
immutable
as $$
declare
  v_norm text := internal.normalize_registration(p_value);
  v_m    text[];
begin
  if v_norm is null then
    return null;
  end if;
  if coalesce(p_country, 'FR') = 'FR' then
    if v_norm ~ '^[A-Z]{2}[0-9]{3}[A-Z]{2}$' then
      return substr(v_norm, 1, 2) || '-' || substr(v_norm, 3, 3) || '-' || substr(v_norm, 6, 2);
    end if;
    v_m := regexp_match(v_norm, '^([0-9]{1,4})([A-Z]{1,3})(97[1-6]|2A|2B|[0-9]{2})$');
    if v_m is not null then
      return v_m[1] || ' ' || v_m[2] || ' ' || v_m[3];
    end if;
  end if;
  return upper(regexp_replace(trim(p_value), '\s+', ' ', 'g'));
end;
$$;

-- Numéro court affiché : « A-042 » au guichet et en boutique, « 0042 »
-- (dossier) en atelier appareil.
create or replace function internal.format_ticket_no(
  p      public.queue_profile,
  p_prefix text,
  p_no   int
) returns text
language sql
immutable
as $$
  select case
    when p_no is null then null
    when p = 'device' then lpad(p_no::text, 4, '0')
    else coalesce(p_prefix, 'A') || '-' ||
         case when p_no < 1000 then lpad(p_no::text, 3, '0') else p_no::text end
  end;
$$;

-- Texte libre saisi : caractères de contrôle retirés, espaces resserrés.
-- Null si vide.
create or replace function internal.clean_text(p_value text)
returns text
language sql
immutable
as $$
  select nullif(trim(regexp_replace(regexp_replace(coalesce(p_value, ''), '[[:cntrl:]]', ' ', 'g'), '\s+', ' ', 'g')), '');
$$;

-- ---------------------------------------------------------------------
-- Validation des informations métier (défense en profondeur)
-- ---------------------------------------------------------------------
-- Le serveur Next.js valide déjà par zod ; cette fonction refait le
-- contrôle en base, par liste blanche : un champ oublié ou ajouté par
-- erreur (un « code » de déverrouillage, par exemple) est refusé, jamais
-- stocké. La valeur saisie n'apparaît jamais dans le message d'erreur.
--
-- Qui peut poser quoi :
--   client : ce qu'il décrit lui-même (immatriculation, modèle, motif,
--            couverts, numéro de commande…) ;
--   staff  : en plus, ce que seul le professionnel constate (clés reçues,
--            accessoires déposés, promesse de délai) ;
--   system : en plus, le devis, que seules les actions send_quote et
--            quote_accept/quote_decline écrivent. Le professionnel ne peut
--            donc pas fabriquer l'accord d'un client par update_details.
-- Une clé à null vaut absence (elle n'est pas conservée).
create or replace function internal.clean_details(
  p_profile public.queue_profile,
  p_details jsonb,
  p_actor   public.actor_type
) returns jsonb
language plpgsql
stable
set search_path = public, internal, extensions
as $$
declare
  v_in      jsonb := coalesce(p_details, '{}'::jsonb);
  v_out     jsonb := '{}'::jsonb;
  v_allowed text[];
  v_key     text;
  v_val     jsonb;
  v_text    text;
  v_num     numeric;
  v_ts      timestamptz;
  v_items   text[];
  v_quote   jsonb;
begin
  if jsonb_typeof(v_in) <> 'object' then
    raise exception 'Informations invalides' using errcode = 'VT015';
  end if;

  v_allowed := case p_profile
    when 'vehicle' then array['registration', 'country', 'model', 'reasonText', 'stay',
                              'keys', 'readyEta', 'quote']
    when 'device'  then array['deviceKind', 'model', 'reasonText',
                              'accessories', 'readyEta', 'quote']
    when 'table'   then array['partySize', 'seating', 'needs']
    when 'retail'  then array['orderRef']
    -- walkin, event : aucune information métier. desk : le motif est la
    -- prestation (service_id) ; aucun texte libre, en santé comme ailleurs.
    else array[]::text[]
  end;

  for v_key, v_val in select j.key, j.value from jsonb_each(v_in) j loop
    if not (v_key = any (v_allowed)) then
      raise exception 'Informations invalides : champ « % » non accepté pour ce profil', v_key
        using errcode = 'VT015';
    end if;
    if v_key in ('keys', 'readyEta', 'accessories') and p_actor = 'client' then
      raise exception 'Informations invalides : champ « % » réservé au professionnel', v_key
        using errcode = 'VT015';
    end if;
    if v_key = 'quote' and p_actor <> 'system' then
      raise exception 'Informations invalides : le devis passe par son action dédiée'
        using errcode = 'VT015';
    end if;

    continue when jsonb_typeof(v_val) = 'null';

    case v_key
      when 'registration' then
        if jsonb_typeof(v_val) <> 'string' then
          raise exception 'Informations invalides : immatriculation' using errcode = 'VT015';
        end if;
        v_text := trim(v_val #>> '{}');
        if length(v_text) > 16 or v_text !~ '^[A-Za-z0-9 -]*$'
           or coalesce(length(internal.normalize_registration(v_text)), 0) not between 2 and 12 then
          raise exception 'Informations invalides : immatriculation' using errcode = 'VT015';
        end if;
        v_out := v_out || jsonb_build_object('registration', v_text);

      when 'country' then
        if v_val #>> '{}' not in ('FR', 'other') or jsonb_typeof(v_val) <> 'string' then
          raise exception 'Informations invalides : pays de l''immatriculation' using errcode = 'VT015';
        end if;
        v_out := v_out || jsonb_build_object('country', v_val #>> '{}');

      when 'model', 'reasonText', 'orderRef' then
        if jsonb_typeof(v_val) <> 'string' then
          raise exception 'Informations invalides : %', v_key using errcode = 'VT015';
        end if;
        v_text := internal.clean_text(v_val #>> '{}');
        continue when v_text is null;
        -- (CASE entre parenthèses : sinon PL/pgSQL arrêterait la condition
        -- du IF au premier THEN.)
        if length(v_text) > (case v_key when 'model' then 40 when 'reasonText' then 80 else 24 end)
           or (v_key = 'orderRef' and v_text !~ '^[A-Za-z0-9 _/-]+$') then
          raise exception 'Informations invalides : %', v_key using errcode = 'VT015';
        end if;
        v_out := v_out || jsonb_build_object(v_key, v_text);

      when 'stay' then
        if jsonb_typeof(v_val) <> 'string' or v_val #>> '{}' not in ('away', 'onsite') then
          raise exception 'Informations invalides : stay' using errcode = 'VT015';
        end if;
        v_out := v_out || jsonb_build_object('stay', v_val #>> '{}');

      when 'keys' then
        if jsonb_typeof(v_val) <> 'boolean' then
          raise exception 'Informations invalides : keys' using errcode = 'VT015';
        end if;
        v_out := v_out || jsonb_build_object('keys', v_val);

      when 'readyEta' then
        begin
          v_ts := (v_val #>> '{}')::timestamptz;
        exception when others then
          raise exception 'Informations invalides : promesse de délai' using errcode = 'VT015';
        end;
        if jsonb_typeof(v_val) <> 'string' or v_ts <= now() or v_ts > now() + interval '60 days' then
          raise exception 'Informations invalides : la promesse de délai doit être dans les 60 prochains jours'
            using errcode = 'VT015';
        end if;
        v_out := v_out || jsonb_build_object('readyEta', v_ts);

      when 'deviceKind' then
        if jsonb_typeof(v_val) <> 'string'
           or v_val #>> '{}' not in ('phone', 'tablet', 'computer', 'console', 'watch', 'other') then
          raise exception 'Informations invalides : type d''appareil' using errcode = 'VT015';
        end if;
        v_out := v_out || jsonb_build_object('deviceKind', v_val #>> '{}');

      when 'accessories', 'needs' then
        if jsonb_typeof(v_val) <> 'array'
           or exists (select 1 from jsonb_array_elements(v_val) a where jsonb_typeof(a) <> 'string') then
          raise exception 'Informations invalides : %', v_key using errcode = 'VT015';
        end if;
        select coalesce(array_agg(distinct a order by a), array[]::text[]) into v_items
        from jsonb_array_elements_text(v_val) a;
        if exists (
          select 1 from unnest(v_items) i
          where not (i = any (case v_key
                                when 'accessories' then array['charger', 'case', 'sim', 'other']
                                else array['highchair', 'accessible'] end))
        ) then
          raise exception 'Informations invalides : %', v_key using errcode = 'VT015';
        end if;
        v_out := v_out || jsonb_build_object(v_key, to_jsonb(v_items));

      when 'partySize' then
        if jsonb_typeof(v_val) <> 'number' then
          raise exception 'Informations invalides : nombre de couverts' using errcode = 'VT015';
        end if;
        v_num := (v_val #>> '{}')::numeric;
        if v_num <> trunc(v_num) or v_num not between 1 and 20 then
          raise exception 'Informations invalides : nombre de couverts (1 à 20)' using errcode = 'VT015';
        end if;
        v_out := v_out || jsonb_build_object('partySize', v_num::int);

      when 'seating' then
        if jsonb_typeof(v_val) <> 'string' or v_val #>> '{}' not in ('any', 'indoor', 'terrace') then
          raise exception 'Informations invalides : préférence de placement' using errcode = 'VT015';
        end if;
        v_out := v_out || jsonb_build_object('seating', v_val #>> '{}');

      when 'quote' then
        -- Écrit seulement par le moteur (p_actor = 'system') : on vérifie
        -- tout de même la forme, pour qu'aucun chemin ne stocke autre chose.
        if jsonb_typeof(v_val) <> 'object'
           or exists (select 1 from jsonb_object_keys(v_val) k
                      where k not in ('amountCents', 'label', 'sentAt', 'decision', 'decidedAt'))
           or jsonb_typeof(v_val -> 'amountCents') <> 'number'
           or (v_val ->> 'amountCents')::numeric <> trunc((v_val ->> 'amountCents')::numeric)
           or (v_val ->> 'amountCents')::numeric not between 0 and 10000000
           or jsonb_typeof(v_val -> 'label') <> 'string'
           or coalesce(length(internal.clean_text(v_val ->> 'label')), 0) not between 1 and 80
           or coalesce(v_val ->> 'decision', 'accepted') not in ('accepted', 'declined') then
          raise exception 'Informations invalides : devis' using errcode = 'VT015';
        end if;
        v_quote := jsonb_build_object(
          'amountCents', (v_val ->> 'amountCents')::int,
          'label',       internal.clean_text(v_val ->> 'label'),
          'sentAt',      v_val -> 'sentAt',
          'decision',    v_val -> 'decision',
          'decidedAt',   v_val -> 'decidedAt'
        );
        v_out := v_out || jsonb_build_object('quote', v_quote);
    end case;
  end loop;

  -- L'immatriculation est mise en forme une fois le pays connu.
  if v_out ? 'registration' then
    v_out := v_out || jsonb_build_object(
      'registration', internal.format_registration(v_out ->> 'registration', v_out ->> 'country')
    );
  end if;

  if pg_column_size(v_out) > 2048 then
    raise exception 'Informations invalides : trop volumineuses' using errcode = 'VT015';
  end if;

  return v_out;
end;
$$;

-- ---------------------------------------------------------------------
-- Numérotation
-- ---------------------------------------------------------------------
-- Compteur quotidien (jour local de l'établissement, même technique que
-- 0019) au guichet et en boutique, continu en atelier appareil. Repasse
-- à 1 après 9999. L'upsert rend l'attribution atomique.
create or replace function internal.next_ticket_no(p_queue_id uuid)
returns int
language plpgsql
volatile
set search_path = public, internal, extensions
as $$
declare
  v_profile public.queue_profile;
  v_tz      text;
  v_day     date;
  v_no      int;
begin
  select q.profile, coalesce(l.timezone, 'Europe/Paris')
    into v_profile, v_tz
  from public.queues q
  join public.locations l on l.id = q.location_id
  where q.id = p_queue_id;

  v_day := case when v_profile = 'device' then date '1970-01-01'
                else (now() at time zone v_tz)::date end;

  insert into public.queue_ticket_counters as c (queue_id, scope_day, last_no)
  values (p_queue_id, v_day, 1)
  on conflict (queue_id, scope_day) do update
    set last_no = case when c.last_no >= 9999 then 1 else c.last_no + 1 end
  returning c.last_no into v_no;

  return v_no;
end;
$$;

-- ---------------------------------------------------------------------
-- Horaires du jour local
-- ---------------------------------------------------------------------
-- {date, closed, opensAt, closesAt} du jour dans le fuseau de
-- l'établissement, dérogations datées comprises. Null si aucun horaire
-- n'est connu : le texte « Ouvert jusqu'à… » est alors omis, jamais deviné.
create or replace function internal.today_hours(p_location_id uuid)
returns jsonb
language plpgsql
stable
set search_path = public, internal, extensions
as $$
declare
  v_tz       text;
  v_day      date;
  v_override public.opening_hours_overrides;
  v_open     time;
  v_close    time;
  v_any      boolean;
begin
  select coalesce(timezone, 'Europe/Paris') into v_tz from public.locations where id = p_location_id;
  if not found then
    return null;
  end if;
  v_day := (now() at time zone v_tz)::date;

  select * into v_override
  from public.opening_hours_overrides
  where location_id = p_location_id and on_date = v_day;
  if found then
    return jsonb_build_object(
      'date', v_day,
      'closed', v_override.is_closed or v_override.opens_at is null or v_override.closes_at is null,
      'opensAt', case when v_override.is_closed then null else to_char(v_override.opens_at, 'HH24:MI') end,
      'closesAt', case when v_override.is_closed then null else to_char(v_override.closes_at, 'HH24:MI') end
    );
  end if;

  -- 0 = lundi dans opening_hours ; isodow 1 = lundi.
  select min(h.opens_at) filter (where not h.is_closed),
         max(h.closes_at) filter (where not h.is_closed),
         count(*) > 0
    into v_open, v_close, v_any
  from public.opening_hours h
  where h.location_id = p_location_id
    and h.weekday = extract(isodow from v_day)::int - 1;

  if not v_any then
    return null;
  end if;
  return jsonb_build_object(
    'date', v_day,
    'closed', v_open is null,
    'opensAt', to_char(v_open, 'HH24:MI'),
    'closesAt', to_char(v_close, 'HH24:MI')
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Réglages par défaut d'un profil
-- ---------------------------------------------------------------------
-- Pose des réglages cohérents avec le profil. En walkin (et en event),
-- ce sont exactement les valeurs par défaut des colonnes : appliquée à
-- une file neuve, la fonction ne change rien, et une file ramenée en
-- walkin retrouve le comportement d'un barbier qui s'inscrit. Le mode
-- (commun / par professionnel) n'est touché que hors walkin et event :
-- un garage, un restaurant ou un guichet travaillent en file commune.
--
-- p_activity : activité à retenir quand l'organisation n'est pas encore
-- à jour (create_location la met à jour après la création de la file).
create or replace function internal.apply_profile_defaults(
  p_queue_id  uuid,
  p_profile   public.queue_profile,
  p_activity  public.activity_type default null
) returns void
language plpgsql
volatile
set search_path = public, internal, extensions
as $$
declare
  v_activity  public.activity_type;
  v_sensitive boolean;
  v_options   jsonb;
begin
  select coalesce(p_activity, o.activity) into v_activity
  from public.queues q
  join public.organizations o on o.id = q.organization_id
  where q.id = p_queue_id;
  if not found then
    raise exception 'File introuvable' using errcode = 'VT005';
  end if;

  v_sensitive := p_profile = 'desk' and v_activity = 'health';

  v_options := case p_profile
    when 'vehicle' then jsonb_build_object(
      'stayChoice', true,
      'registrationRequired', true,
      -- Écran TV : seuls les 3 derniers caractères, masqués en SQL.
      'tvRegistration', 'masked',
      'quotes', true,
      'review', true)
    when 'device' then jsonb_build_object(
      'quotes', true,
      'numbering', true,
      'review', true)
    when 'table' then jsonb_build_object(
      'partyMax', 12,
      'tableSizes', jsonb_build_array(2, 4, 6, 8),
      -- L'avis part 75 min après « Installer », pas au moment où l'on s'assoit.
      'reviewDelayMinutes', 75,
      'review', true)
    when 'desk' then jsonb_build_object(
      'numbering', true,
      'sensitive', v_sensitive,
      -- Pas d'avis par défaut en administration ni en santé.
      'review', v_activity not in ('admin_service', 'health'))
      -- Santé : aucune notification de fin de visite (null = jamais).
      || case when v_sensitive then jsonb_build_object('reviewDelayMinutes', null)
              else '{}'::jsonb end
    when 'retail' then jsonb_build_object(
      'numbering', false,
      'review', true)
    else '{}'::jsonb  -- walkin, event
  end;

  update public.queues q
     set profile = p_profile,
         profile_options = v_options,
         mode = case when p_profile in ('walkin', 'event') then q.mode else 'shared' end,
         advance_mode = case
           when p_profile in ('vehicle', 'device', 'table', 'desk') then 'call_next'
           else 'auto_serve' end::public.advance_mode,
         entry_ttl_minutes = case when p_profile in ('vehicle', 'device') then 10080 else 240 end,
         absent_policy = case
           when p_profile = 'table' then 'remove'
           when p_profile in ('vehicle', 'device') then 'hold'
           else 'move_back' end::public.absent_policy,
         absent_grace_minutes = 5,
         ask_client_name = not v_sensitive,
         client_name_required = p_profile = 'table',
         allow_service_choice = p_profile in ('vehicle', 'device', 'desk', 'retail'),
         allow_staff_choice = false
   where q.id = p_queue_id;
end;
$$;

-- Prestations (motifs) proposées par défaut à un profil. Aucune en
-- walkin, table et event : on n'ajoute rien aux barbiers.
create or replace function internal.default_services(p public.queue_profile)
returns text[]
language sql
immutable
as $$
  select case p
    when 'vehicle' then array['Vidange', 'Pneus', 'Freins', 'Diagnostic', 'Carrosserie', 'Climatisation', 'Autre']
    when 'device'  then array['Écran', 'Batterie', 'Connecteur de charge', 'Oxydation', 'Caméra', 'Autre']
    when 'desk'    then array['Accueil', 'Dépôt de dossier', 'Retrait']
    when 'retail'  then array['Être conseillé', 'Retirer une commande', 'Échange ou retour']
    else array[]::text[]
  end;
$$;

-- Crée les prestations par défaut si l'établissement n'en a aucune
-- d'active. Renvoie le nombre de prestations créées.
create or replace function internal.seed_default_services(
  p_location_id uuid,
  p_profile     public.queue_profile
) returns int
language plpgsql
volatile
set search_path = public, internal, extensions
as $$
declare
  v_org   uuid;
  v_count int := 0;
begin
  select organization_id into v_org from public.locations where id = p_location_id;
  if v_org is null or exists (
    select 1 from public.services s where s.location_id = p_location_id and s.is_active
  ) then
    return 0;
  end if;

  insert into public.services (organization_id, location_id, name, sort_order)
  select v_org, p_location_id, n.name, (n.ord::int - 1) * 10
  from unnest(internal.default_services(p_profile)) with ordinality as n(name, ord);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- =====================================================================
-- 2. Étapes
-- =====================================================================

-- Transition de statut provoquée par un changement d'étape.
-- La machine à états de 0006 (internal.allowed_transition) interdit
-- serving -> next : un client en prestation n'est pas « rappelé ». En
-- atelier, c'est pourtant le geste central : « en réparation » -> « prêt ».
-- Plutôt que d'élargir la machine partagée (le comportement des barbiers
-- changerait), les étapes ont leur propre règle, plus large et limitée à
-- elles : tout passage d'un statut actif à un autre statut actif. Les
-- horodatages suivent exactement internal.apply_transition (0007).
create or replace function internal.apply_stage_transition(
  p_entry_id       uuid,
  p_to             public.entry_status,
  p_actor          public.actor_type,
  p_actor_user_id  uuid,
  p_actor_staff_id uuid,
  p_payload        jsonb
) returns public.queue_entries
language plpgsql
volatile
set search_path = public, internal, extensions
as $$
declare
  v_before public.queue_entries;
  v_after  public.queue_entries;
begin
  select * into v_before from public.queue_entries where id = p_entry_id for update;
  if not found then
    raise exception 'Ticket introuvable' using errcode = 'VT005';
  end if;

  if v_before.status = p_to then
    return v_before;
  end if;

  if not (internal.allowed_transition(v_before.status, p_to)
          or (public.entry_is_active(v_before.status) and public.entry_is_active(p_to))) then
    raise exception 'Transition interdite: % -> %', v_before.status, p_to
      using errcode = 'VT006';
  end if;

  update public.queue_entries e
     set status = p_to,
         called_at = case
           when p_to = 'next' then now()
           when p_to in ('notified', 'serving') then coalesce(e.called_at, now())
           when p_to = 'waiting' then null
           else e.called_at end,
         returning_at = case when p_to = 'returning' then now() else e.returning_at end,
         present_at   = case when p_to = 'present'   then now() else e.present_at end,
         service_started_at = case
           when p_to = 'serving' then coalesce(e.service_started_at, now())
           when p_to = 'waiting' then null
           else e.service_started_at end,
         completed_at = case when p_to = 'completed' then now()
                             when p_to = 'waiting' then null else e.completed_at end,
         cancelled_at = case when p_to = 'cancelled' then now()
                             when p_to = 'waiting' then null else e.cancelled_at end,
         absent_at    = case when p_to = 'absent' then now()
                             when p_to = 'waiting' then null else e.absent_at end,
         expired_at   = case when p_to = 'expired' then now()
                             when p_to = 'waiting' then null else e.expired_at end,
         served_by_staff_id = case
           when p_to in ('serving', 'completed')
             then coalesce(e.served_by_staff_id, p_actor_staff_id, e.staff_id)
           else e.served_by_staff_id end
   where e.id = p_entry_id
  returning * into v_after;

  perform internal.log_queue_event(
    v_after, 'stage', v_before.status, p_to,
    p_actor, p_actor_user_id, p_actor_staff_id, p_payload
  );

  return v_after;
end;
$$;

-- Change l'étape d'un ticket actif. Le statut suit l'étape
-- (internal.stage_status) par internal.apply_stage_transition, qui
-- horodate comme toute transition. Un événement 'stage' {from, to,
-- notify} est toujours écrit ;
-- il ne contient jamais d'information métier (ni immatriculation, ni
-- modèle), seulement des codes d'étape.
--
-- Journal des notifications :
--   * on quitte « prêt » (cible autre que next) : your_turn est retiré,
--     pour que le prochain « Prêt » prévienne de nouveau le client ;
--   * « prêt » sans « Prévenir » : your_turn est marqué 'silenced', et le
--     balayage de la file ne l'enverra pas ;
--   * la clé 'stage:<étape>' est effacée à chaque entrée dans l'étape :
--     une seconde pièce commandée est un nouvel événement, prévenu comme
--     tel ; la même transition ne l'est jamais deux fois.
create or replace function internal.set_entry_stage(
  p_entry_id       uuid,
  p_stage          text,
  p_notify         boolean,
  p_actor          public.actor_type,
  p_actor_user_id  uuid,
  p_actor_staff_id uuid
) returns public.queue_entries
language plpgsql
volatile
set search_path = public, internal, extensions
as $$
declare
  v_entry   public.queue_entries;
  v_profile public.queue_profile;
  v_status  public.entry_status;
  v_from    text;
  v_payload jsonb;
begin
  select e.* into v_entry from public.queue_entries e where e.id = p_entry_id for update;
  if not found then
    raise exception 'Ticket introuvable' using errcode = 'VT005';
  end if;
  select q.profile into v_profile from public.queues q where q.id = v_entry.queue_id;

  v_status := internal.stage_status(v_profile, p_stage);
  if v_status is null then
    raise exception 'Étape inconnue pour ce profil : %', coalesce(p_stage, '(vide)')
      using errcode = 'VT006';
  end if;
  if not public.entry_is_active(v_entry.status) then
    raise exception 'Ce ticket n''est plus en cours' using errcode = 'VT006';
  end if;

  v_from := v_entry.stage;
  if v_from is not distinct from p_stage and v_entry.status = v_status then
    return v_entry;  -- idempotent : rien ne change, rien n'est journalisé
  end if;

  v_payload := jsonb_build_object('from', v_from, 'to', p_stage, 'notify', coalesce(p_notify, true));

  if v_entry.status <> v_status then
    v_entry := internal.apply_stage_transition(
      v_entry.id, v_status, p_actor, p_actor_user_id, p_actor_staff_id, v_payload
    );
  else
    perform internal.log_queue_event(
      v_entry, 'stage', v_entry.status, v_entry.status,
      p_actor, p_actor_user_id, p_actor_staff_id, v_payload
    );
  end if;

  update public.queue_entries e
     set stage = p_stage,
         stage_changed_at = now(),
         notification_status =
           (case when v_status <> 'next' then e.notification_status - 'your_turn'
                 else e.notification_status end)
           - ('stage:' || p_stage)
           || case when v_status = 'next' and not coalesce(p_notify, true)
                   then jsonb_build_object('your_turn', 'silenced')
                   else '{}'::jsonb end
   where e.id = v_entry.id
  returning * into v_entry;

  return v_entry;
end;
$$;

-- Réaligne l'étape après une action générique qui a changé le statut
-- (démarrer, décaler, remettre en file…) : « l'étape suit le statut ».
-- Sans effet sur un ticket sans étape, donc sur tout ticket walkin.
create or replace function internal.realign_stage(
  p_entry_id       uuid,
  p_actor          public.actor_type,
  p_actor_user_id  uuid,
  p_actor_staff_id uuid
) returns void
language plpgsql
volatile
set search_path = public, internal, extensions
as $$
declare
  v_entry   public.queue_entries;
  v_profile public.queue_profile;
  v_target  text;
begin
  select e.* into v_entry from public.queue_entries e where e.id = p_entry_id;
  if not found or v_entry.stage is null or not public.entry_is_active(v_entry.status) then
    return;
  end if;
  select q.profile into v_profile from public.queues q where q.id = v_entry.queue_id;

  if internal.stage_status(v_profile, v_entry.stage) is not distinct from v_entry.status then
    return;
  end if;

  v_target := internal.stage_for_status(v_profile, v_entry.stage, v_entry.status);
  if v_target is not distinct from v_entry.stage then
    return;
  end if;

  update public.queue_entries
     set stage = v_target,
         stage_changed_at = now()
   where id = v_entry.id;

  perform internal.log_queue_event(
    v_entry, 'stage', v_entry.status, v_entry.status,
    p_actor, p_actor_user_id, p_actor_staff_id,
    jsonb_build_object('from', v_entry.stage, 'to', v_target, 'notify', false, 'realigned', true)
  );
end;
$$;

-- =====================================================================
-- 3. Notifications
-- =====================================================================

-- Genre de notification dû à un ticket actif, d'après sa position et
-- son statut. En walkin, event et boutique (sans étape), c'est
-- exactement l'expression d'origine de 0006.
create or replace function internal.due_position_kind(
  p_profile public.queue_profile,
  p_stage   text,
  p_status  public.entry_status,
  p_ahead   int,
  p_thresh  int
) returns text
language sql
immutable
as $$
  select case
    -- Atelier, et tout ticket suivi par étape : seul « prêt » (next)
    -- prévient. Un dépôt n'est jamais « c'est votre tour ».
    when not internal.profile_uses_position(p_profile) or p_stage is not null then
      case when p_status = 'next' then 'your_turn' end
    -- Table et guichet : le tour vient de l'appel, pas de la position.
    when internal.profile_call_based(p_profile) then
      case
        when p_status in ('serving', 'next') then 'your_turn'
        when p_ahead <= 1 then 'ahead_one'
        when p_ahead <= p_thresh then 'ahead_two'
      end
    -- Expression d'origine (0006), inchangée.
    when p_status in ('serving', 'next') or p_ahead = 0 then 'your_turn'
    when p_ahead = 1 then 'ahead_one'
    when p_ahead <= p_thresh then 'ahead_two'
    else null
  end;
$$;

-- À l'inscription, le client voit déjà sa position : on neutralise les
-- paliers atteints. En atelier, on marque aussi l'étape de dépôt, pour
-- que le client qui vient de déposer ne soit pas prévenu de son propre
-- dépôt ; « c'est votre tour » n'y est jamais marqué d'avance.
create or replace function internal.seed_notification_baseline(p_entry_id uuid)
returns void
language plpgsql
as $$
declare
  v_status  public.entry_status;
  v_ahead   int;
  v_thresh  int;
  v_profile public.queue_profile;
  v_stage   text;
  v_kind    text;
begin
  select e.status, e.people_ahead, q.notify_ahead_threshold, q.profile, e.stage
    into v_status, v_ahead, v_thresh, v_profile, v_stage
  from public.queue_entries e
  join public.queues q on q.id = e.queue_id
  where e.id = p_entry_id;

  if not found then return; end if;

  if v_stage is not null then
    update public.queue_entries
       set notification_status = notification_status
         || jsonb_build_object('stage:' || v_stage, 'at_join')
     where id = p_entry_id;
  end if;

  v_kind := internal.due_position_kind(v_profile, v_stage, v_status, v_ahead, v_thresh);

  if v_kind is not null then
    update public.queue_entries
       set notification_status = internal.notification_ledger(notification_status, v_kind, 'at_join')
     where id = p_entry_id;
  end if;
end;
$$;

-- Réclame, de façon atomique, les notifications de position qui restent
-- à envoyer (même signature et même garantie qu'en 0006).
create or replace function public.claim_pending_notifications(p_queue_id uuid)
returns table (
  entry_id          uuid,
  entry_public_id   text,
  kind              public.notification_kind,
  client_session_id uuid,
  organization_id   uuid,
  location_id       uuid,
  client_name       text,
  people_ahead      int,
  status            public.entry_status
)
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
begin
  return query
  with candidates as (
    select
      e.id,
      internal.due_position_kind(q.profile, e.stage, e.status, e.people_ahead,
                                 q.notify_ahead_threshold) as kind_text
    from public.queue_entries e
    join public.queues q on q.id = e.queue_id
    where e.queue_id = p_queue_id
      and public.entry_is_active(e.status)
  ),
  claimed as (
    update public.queue_entries e
       set notification_status = internal.notification_ledger(e.notification_status, c.kind_text)
      from candidates c
     where e.id = c.id
       and c.kind_text is not null
       and not (e.notification_status ? c.kind_text)
    returning e.id, c.kind_text, e.public_id, e.client_session_id,
              e.organization_id, e.location_id, e.client_name,
              e.people_ahead, e.status
  )
  select cl.id, cl.public_id, cl.kind_text::public.notification_kind,
         cl.client_session_id, cl.organization_id, cl.location_id,
         cl.client_name, cl.people_ahead, cl.status
  from claimed cl;
end;
$$;

-- Réclame une notification ponctuelle (fin de passage, retrait…).
-- Avis différé : si la file porte profile_options.reviewDelayMinutes,
--   * null (« jamais ») : visit_completed n'est jamais réclamée ;
--   * un délai > 0 non écoulé depuis completed_at : false, SANS marquer
--     le journal, pour que claim_due_review_notifications (cron
--     api/cron/reviews) la réclame plus tard ;
--   * 0, ou toute autre valeur : envoi immédiat, comme aujourd'hui.
-- En walkin, profile_options = {} : la branche n'est jamais prise, et
-- staffAction('complete') continue d'envoyer l'avis tout de suite.
create or replace function public.claim_entry_notification(
  p_entry_id uuid,
  p_kind     public.notification_kind
) returns boolean
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_updated   int;
  v_options   jsonb;
  v_completed timestamptz;
  v_delay     jsonb;
begin
  if p_kind = 'visit_completed' then
    select q.profile_options, e.completed_at into v_options, v_completed
    from public.queue_entries e
    join public.queues q on q.id = e.queue_id
    where e.id = p_entry_id;

    if v_options ? 'reviewDelayMinutes' then
      v_delay := v_options -> 'reviewDelayMinutes';
      if jsonb_typeof(v_delay) = 'null' then
        return false;
      end if;
      if jsonb_typeof(v_delay) = 'number' and (v_delay #>> '{}')::numeric > 0
         and (v_completed is null
              or now() < v_completed + make_interval(mins => (v_delay #>> '{}')::numeric::int)) then
        return false;
      end if;
    end if;
  end if;

  update public.queue_entries
     set notification_status = notification_status
       || jsonb_build_object(p_kind::text, to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'))
   where id = p_entry_id
     and not (notification_status ? p_kind::text);
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- Journal générique à clé : 'stage:waiting_parts', 'quote:2', 'recall:1',
-- 'custom:7'… Une même clé n'est réclamée qu'une fois. Les compteurs
-- (quote_count, recall_count, custom_count) sont tenus par
-- staff_queue_action et lus par le serveur dans entry_json_staff.notified.
create or replace function public.claim_entry_notification_key(
  p_entry_id uuid,
  p_key      text
) returns boolean
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_updated int;
begin
  if p_key is null or p_key !~ '^[a-z_]+(:[a-z0-9_]+)?$' or length(p_key) > 64 then
    raise exception 'Clé de notification invalide' using errcode = 'VT015';
  end if;
  update public.queue_entries
     set notification_status = notification_status
       || jsonb_build_object(p_key, to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'))
   where id = p_entry_id
     and not (notification_status ? p_key);
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

-- Avis différés dus : tickets terminés dont le délai est écoulé, depuis
-- moins de 24 h, rattachés à un appareil et pas encore remerciés.
-- Réclamation atomique (même motif que claim_pending_notifications) :
-- deux crons concurrents ne réclament jamais le même ticket. Même forme
-- de retour que claim_pending_notifications, pour réutiliser la
-- livraison de dispatch.ts.
create or replace function public.claim_due_review_notifications(p_limit int default 200)
returns table (
  entry_id          uuid,
  entry_public_id   text,
  kind              public.notification_kind,
  client_session_id uuid,
  organization_id   uuid,
  location_id       uuid,
  client_name       text,
  people_ahead      int,
  status            public.entry_status
)
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
begin
  return query
  with due as (
    select e.id
    from public.queues q
    join public.queue_entries e
      on e.queue_id = q.id
     and e.status = 'completed'
     and e.completed_at > now() - interval '24 hours'
    where q.profile_options ? 'reviewDelayMinutes'
      and jsonb_typeof(q.profile_options -> 'reviewDelayMinutes') = 'number'
      and (q.profile_options ->> 'reviewDelayMinutes')::numeric > 0
      and e.completed_at + make_interval(mins => (q.profile_options ->> 'reviewDelayMinutes')::numeric::int) <= now()
      and e.client_session_id is not null
      and not (e.notification_status ? 'visit_completed')
    order by e.completed_at
    limit greatest(1, least(coalesce(p_limit, 200), 1000))
    for update of e skip locked
  ),
  claimed as (
    update public.queue_entries e
       set notification_status = e.notification_status
         || jsonb_build_object('visit_completed', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'))
      from due d
     where e.id = d.id
       and not (e.notification_status ? 'visit_completed')
    returning e.id, e.public_id, e.client_session_id, e.organization_id,
              e.location_id, e.client_name, e.people_ahead, e.status
  )
  select cl.id, cl.public_id, 'visit_completed'::public.notification_kind,
         cl.client_session_id, cl.organization_id, cl.location_id,
         cl.client_name, cl.people_ahead, cl.status
  from claimed cl;
end;
$$;

-- =====================================================================
-- 4. Avancement
-- =====================================================================

-- Promotion du suivant, sous verrou de file (même signature qu'en 0007).
-- Hors walkin :
--   * aucune promotion automatique en atelier et au restaurant ;
--   * au guichet, « un seul appelé » s'entend par guichet, pas pour toute
--     la file : trois guichets appellent trois numéros ;
--   * un ticket suivi par étape (commande en préparation, véhicule) n'est
--     ni « le suivant » ni une prestation qui occupe le professionnel.
create or replace function internal.promote_next(
  p_queue_id       uuid,
  p_staff_id       uuid,
  p_actor          public.actor_type,
  p_actor_user_id  uuid,
  p_actor_staff_id uuid
) returns public.queue_entries
language plpgsql
as $$
declare
  v_queue   public.queues;
  v_target  public.entry_status;
  v_head    public.queue_entries;
  v_busy    boolean;
begin
  select * into v_queue from public.queues where id = p_queue_id;
  if not found or v_queue.status <> 'open' then
    return null;
  end if;

  if not internal.profile_auto_advance(v_queue.profile) then
    return null;
  end if;

  v_target := case v_queue.advance_mode when 'auto_serve' then 'serving' else 'next' end;

  -- Un professionnel ne sert qu'une personne à la fois.
  if v_target = 'serving' then
    select exists (
      select 1 from public.queue_entries e
      where e.queue_id = p_queue_id
        and e.status = 'serving'
        and e.stage is null
        and (
          (p_staff_id is not null and e.staff_id is not distinct from p_staff_id)
          or (p_staff_id is null and v_queue.mode = 'shared')
        )
    ) into v_busy;
    if v_busy then
      return null;
    end if;
  else
    select exists (
      select 1 from public.queue_entries e
      where e.queue_id = p_queue_id
        and e.status = 'next'
        and e.stage is null
        and ((v_queue.mode = 'shared' and v_queue.profile <> 'desk')
             or e.staff_id is not distinct from p_staff_id)
    ) into v_busy;
    if v_busy then
      return null;
    end if;
  end if;

  select * into v_head
  from public.queue_entries e
  where e.queue_id = p_queue_id
    and e.status in ('waiting', 'notified', 'returning', 'present')
    and e.stage is null
    and (
      v_queue.mode = 'shared'
      or e.staff_id is not distinct from p_staff_id
    )
    -- En file commune, un client ayant choisi un professionnel précis
    -- n'est pris que par celui-ci.
    and (
      v_queue.mode <> 'shared'
      or e.staff_id is null
      or p_staff_id is null
      or e.staff_id = p_staff_id
    )
  order by internal.status_rank(e.status), e.sort_order, e.joined_at, e.id
  limit 1
  for update skip locked;

  if not found then
    return null;
  end if;

  if v_queue.mode = 'shared' and p_staff_id is not null and v_head.staff_id is null then
    update public.queue_entries set staff_id = p_staff_id where id = v_head.id;
  end if;

  return internal.apply_transition(
    v_head.id, v_target, p_actor, p_actor_user_id, p_actor_staff_id,
    case v_target when 'serving' then 'auto_start_serving' else 'auto_call_next' end,
    jsonb_build_object('promoted', true)
  );
end;
$$;

-- Expiration des tickets oubliés (même signature qu'en 0009). Le délai
-- court depuis le dernier changement d'étape quand il existe : une
-- voiture qui avance en atelier depuis trois jours n'expire pas. En
-- walkin, stage_changed_at est null : comportement identique.
create or replace function public.expire_stale_entries()
returns table (queue_id uuid, expired int)
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
begin
  return query
  with stale as (
    select e.id, e.queue_id
    from public.queue_entries e
    join public.queues q on q.id = e.queue_id
    where public.entry_is_active(e.status)
      and coalesce(e.stage_changed_at, e.joined_at) < now() - make_interval(mins => q.entry_ttl_minutes)
  ),
  done as (
    update public.queue_entries t
       set status = 'expired', expired_at = now()
      from stale s
     where t.id = s.id
    returning t.queue_id
  )
  select d.queue_id, count(*)::int from done d group by d.queue_id;
end;
$$;

-- =====================================================================
-- 5. Inscription et ajout manuel : un paramètre en plus, en dernier
-- =====================================================================
-- PostgREST ne sait pas choisir entre deux surcharges qui ont des
-- valeurs par défaut : l'ancienne signature est supprimée, et la
-- nouvelle ajoute p_details en DERNIER, avec une valeur par défaut. Tous
-- les appels existants, nommés (server/queue.ts) ou positionnels (tests
-- 01 à 07), restent valides.
drop function if exists public.join_queue(uuid, uuid, text, uuid, uuid, public.entry_source, uuid);

create function public.join_queue(
  p_queue_id          uuid,
  p_client_session_id uuid,
  p_client_name       text default null,
  p_staff_id          uuid default null,
  p_service_id        uuid default null,
  p_source            public.entry_source default 'qr',
  p_plate_id          uuid default null,
  p_details           jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_queue   public.queues;
  v_org     public.organizations;
  v_active  int;
  v_entry   public.queue_entries;
  v_existing public.queue_entries;
  v_staff   uuid := p_staff_id;
  v_name    text := nullif(trim(coalesce(p_client_name, '')), '');
  v_details jsonb;
  v_stage   text;
begin
  -- Verrou de file : sérialise inscriptions, avancements concurrents et
  -- changement de profil (switch_queue_profile prend le même verrou).
  select * into v_queue from public.queues where id = p_queue_id for update;
  if not found then
    raise exception 'File introuvable' using errcode = 'VT005';
  end if;

  select * into v_org from public.organizations where id = v_queue.organization_id;
  if v_org.status <> 'active' then
    raise exception 'Organisation suspendue' using errcode = 'VT007';
  end if;

  if v_queue.status = 'closed' then
    raise exception 'La file est fermée' using errcode = 'VT001';
  elsif v_queue.status = 'paused' then
    raise exception 'La file est en pause' using errcode = 'VT002';
  end if;

  -- Reprise idempotente : si l'appareil a déjà un ticket actif, on le
  -- renvoie au lieu d'en créer un second (retour sur la page, rescan…).
  -- En atelier aussi : un second dépôt depuis le même téléphone passe par
  -- le professionnel (ajout manuel, puis QR de suivi).
  select * into v_existing
  from public.queue_entries e
  where e.queue_id = p_queue_id
    and e.client_session_id = p_client_session_id
    and public.entry_is_active(e.status)
  limit 1;

  if found then
    return jsonb_build_object(
      'entry', internal.entry_json_client(v_existing),
      'rejoined', true,
      'queueId', p_queue_id
    );
  end if;

  -- Informations métier : liste blanche du profil ({} en walkin).
  v_details := internal.clean_details(v_queue.profile, p_details, 'client');

  -- Champs obligatoires, contrôlés dès que l'appelant parle le langage
  -- des profils (p_details renseigné). Un appel à 7 arguments (version
  -- précédente de l'application, ancien App Clip, retour arrière) reste
  -- valide sur toute file : il crée une fiche sans information métier,
  -- que le professionnel complète. Le serveur Next.js impose les mêmes
  -- champs en amont (zod), avant d'appeler cette fonction.
  if coalesce(p_details, '{}'::jsonb) <> '{}'::jsonb then
    if v_queue.profile = 'vehicle'
       and coalesce((v_queue.profile_options ->> 'registrationRequired')::boolean, false)
       and not (v_details ? 'registration') then
      raise exception 'Informations invalides : immatriculation requise' using errcode = 'VT015';
    end if;
    if v_queue.profile = 'table'
       and (v_details ->> 'partySize')::int > coalesce((v_queue.profile_options ->> 'partyMax')::int, 20) then
      raise exception 'Informations invalides : trop de couverts pour une inscription en ligne'
        using errcode = 'VT015';
    end if;
  end if;

  -- Santé : jamais de prénom, même envoyé par erreur.
  if coalesce((v_queue.profile_options ->> 'sensitive')::boolean, false) then
    v_name := null;
  end if;

  if v_queue.client_name_required and v_name is null then
    raise exception 'Prénom requis' using errcode = 'VT009';
  end if;

  if v_queue.max_active_entries is not null then
    select count(*) into v_active
    from public.queue_entries e
    where e.queue_id = p_queue_id and public.entry_is_active(e.status);
    if v_active >= v_queue.max_active_entries then
      raise exception 'La file est pleine' using errcode = 'VT003';
    end if;
  end if;

  -- Le choix du professionnel n'est retenu que s'il est autorisé.
  if v_staff is not null and not (v_queue.allow_staff_choice or v_queue.mode = 'per_staff') then
    v_staff := null;
  end if;
  if v_staff is not null and not exists (
    select 1 from public.staff s
    where s.id = v_staff and s.location_id = v_queue.location_id
      and s.is_active and s.accepts_queue
  ) then
    v_staff := null;
  end if;

  -- File par professionnel sans choix explicite : on affecte le moins chargé.
  if v_queue.mode = 'per_staff' and v_staff is null then
    select s.id into v_staff
    from public.staff s
    left join public.queue_entries e
      on e.staff_id = s.id and e.queue_id = p_queue_id and public.entry_is_active(e.status)
    where s.location_id = v_queue.location_id
      and s.is_active and s.accepts_queue and not s.is_on_break
    group by s.id, s.sort_order, s.display_name
    order by count(e.id), s.sort_order, s.display_name
    limit 1;

    if v_staff is null then
      raise exception 'Aucun professionnel disponible' using errcode = 'VT008';
    end if;
  end if;

  v_stage := internal.initial_stage(v_queue.profile);

  insert into public.queue_entries (
    organization_id, location_id, queue_id, staff_id, service_id,
    client_session_id, client_name, source, plate_id, sort_order, status,
    details, stage, stage_changed_at, registration_key, ticket_no
  ) values (
    v_queue.organization_id, v_queue.location_id, p_queue_id, v_staff,
    case when v_queue.allow_service_choice then p_service_id else null end,
    p_client_session_id, v_name, p_source, p_plate_id,
    internal.next_sort_order(p_queue_id), 'waiting',
    v_details, v_stage,
    case when v_stage is not null then now() end,
    internal.normalize_registration(v_details ->> 'registration'),
    case when coalesce((v_queue.profile_options ->> 'numbering')::boolean, false)
         then internal.next_ticket_no(p_queue_id) end
  )
  returning * into v_entry;

  if v_name is not null then
    update public.client_sessions
       set display_name = v_name, last_seen_at = now()
     where id = p_client_session_id;
  end if;

  if p_plate_id is not null then
    update public.plates
       set scan_count = scan_count + 1, last_scanned_at = now()
     where id = p_plate_id;
  end if;

  perform internal.log_queue_event(
    v_entry, 'join', null, 'waiting', 'client', null, null,
    jsonb_build_object('source', p_source, 'plateId', p_plate_id)
  );
  if v_stage is not null then
    perform internal.log_queue_event(
      v_entry, 'stage', 'waiting', 'waiting', 'client', null, null,
      jsonb_build_object('from', null, 'to', v_stage, 'notify', false)
    );
  end if;

  perform public.recompute_queue_positions(p_queue_id);
  perform internal.seed_notification_baseline(v_entry.id);

  select * into v_entry from public.queue_entries where id = v_entry.id;

  return jsonb_build_object(
    'entry', internal.entry_json_client(v_entry),
    'rejoined', false,
    'queueId', p_queue_id
  );
end;
$$;

drop function if exists public.add_walkin(uuid, text, uuid, uuid, uuid, uuid);

-- Ajout manuel par le professionnel (« Ajouter un véhicule », un groupe,
-- un ticket de guichet…). Le professionnel peut poser les champs qui lui
-- sont réservés (clés reçues, accessoires, promesse de délai). Le prénom
-- reste facultatif, comme avant : une voiture peut arriver sans.
create function public.add_walkin(
  p_queue_id       uuid,
  p_client_name    text,
  p_staff_id       uuid default null,
  p_service_id     uuid default null,
  p_actor_user_id  uuid default null,
  p_actor_staff_id uuid default null,
  p_details        jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_queue   public.queues;
  v_entry   public.queue_entries;
  v_details jsonb;
  v_stage   text;
  v_name    text := nullif(trim(coalesce(p_client_name, '')), '');
begin
  select * into v_queue from public.queues where id = p_queue_id for update;
  if not found then
    raise exception 'File introuvable' using errcode = 'VT005';
  end if;
  if v_queue.status = 'closed' then
    raise exception 'La file est fermée' using errcode = 'VT001';
  end if;

  v_details := internal.clean_details(v_queue.profile, p_details, 'staff');
  v_stage := internal.initial_stage(v_queue.profile);

  if coalesce((v_queue.profile_options ->> 'sensitive')::boolean, false) then
    v_name := null;
  end if;

  insert into public.queue_entries (
    organization_id, location_id, queue_id, staff_id, service_id,
    client_name, source, sort_order, status,
    details, stage, stage_changed_at, registration_key, ticket_no
  ) values (
    v_queue.organization_id, v_queue.location_id, p_queue_id, p_staff_id, p_service_id,
    v_name, 'staff',
    internal.next_sort_order(p_queue_id), 'waiting',
    v_details, v_stage,
    case when v_stage is not null then now() end,
    internal.normalize_registration(v_details ->> 'registration'),
    case when coalesce((v_queue.profile_options ->> 'numbering')::boolean, false)
         then internal.next_ticket_no(p_queue_id) end
  )
  returning * into v_entry;

  perform internal.log_queue_event(
    v_entry, 'staff_add', null, 'waiting', 'staff', p_actor_user_id, p_actor_staff_id
  );
  if v_stage is not null then
    perform internal.log_queue_event(
      v_entry, 'stage', 'waiting', 'waiting', 'staff', p_actor_user_id, p_actor_staff_id,
      jsonb_build_object('from', null, 'to', v_stage, 'notify', false)
    );
  end if;
  perform public.recompute_queue_positions(p_queue_id);
  perform internal.seed_notification_baseline(v_entry.id);
  select * into v_entry from public.queue_entries where id = v_entry.id;

  return jsonb_build_object('entry', internal.entry_json_staff(v_entry), 'queueId', p_queue_id);
end;
$$;

-- =====================================================================
-- 6. Actions du client
-- =====================================================================
-- Même signature. Actions ajoutées :
--   quote_accept / quote_decline : le devis doit attendre une décision
--     (étape quote_pending) ; la décision est horodatée, une seule fois ;
--   unfollow : l'appareil ne suit plus le véhicule ou l'appareil ; la
--     fiche d'atelier reste active chez le professionnel.
-- « leave » est refusé en atelier : on ne résilie pas une réparation
-- depuis son téléphone.
create or replace function public.client_queue_action(
  p_entry_public_id   text,
  p_client_session_id uuid,
  p_action            text
) returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_entry   public.queue_entries;
  v_to      public.entry_status;
  v_profile public.queue_profile;
  v_decision text;
begin
  select * into v_entry from public.queue_entries where public_id = p_entry_public_id;
  if not found then
    raise exception 'Ticket introuvable' using errcode = 'VT005';
  end if;
  if v_entry.client_session_id is distinct from p_client_session_id then
    raise exception 'Ce ticket n''appartient pas à cette session' using errcode = 'VT009';
  end if;

  select profile into v_profile from public.queues where id = v_entry.queue_id for update;
  -- Relu sous le verrou de file : l'état a pu changer entre-temps (un
  -- « ne plus suivre » concurrent, par exemple), d'où le second contrôle.
  select * into v_entry from public.queue_entries where id = v_entry.id for update;
  if v_entry.client_session_id is distinct from p_client_session_id then
    raise exception 'Ce ticket n''appartient pas à cette session' using errcode = 'VT009';
  end if;

  if p_action in ('quote_accept', 'quote_decline') then
    v_decision := case p_action when 'quote_accept' then 'accepted' else 'declined' end;
    if v_profile not in ('vehicle', 'device')
       or not public.entry_is_active(v_entry.status)
       or v_entry.stage is distinct from 'quote_pending'
       or jsonb_typeof(v_entry.details -> 'quote') is distinct from 'object'
       or jsonb_typeof(v_entry.details -> 'quote' -> 'decision') is distinct from 'null' then
      raise exception 'Aucun devis n''attend votre décision' using errcode = 'VT006';
    end if;
    update public.queue_entries
       set details = jsonb_set(
             details, '{quote}',
             (details -> 'quote')
               || jsonb_build_object('decision', v_decision, 'decidedAt', to_jsonb(now())))
     where id = v_entry.id
    returning * into v_entry;
    perform internal.log_queue_event(
      v_entry, 'quote_decision', v_entry.status, v_entry.status, 'client', null, null,
      jsonb_build_object('decision', v_decision)
    );

  elsif p_action = 'unfollow' then
    if v_profile not in ('vehicle', 'device') then
      raise exception 'Action client inconnue: %', p_action using errcode = 'VT006';
    end if;
    update public.queue_entries
       set client_session_id = null
     where id = v_entry.id
    returning * into v_entry;
    perform internal.log_queue_event(
      v_entry, 'unfollow', v_entry.status, v_entry.status, 'client', null, null, '{}'::jsonb
    );

  else
    if p_action = 'leave' and v_profile in ('vehicle', 'device') then
      raise exception 'Un dépôt en atelier ne s''annule pas depuis le téléphone' using errcode = 'VT006';
    end if;

    v_to := case p_action
      when 'leave'     then 'cancelled'
      when 'returning' then 'returning'
      when 'present'   then 'present'
      else null
    end::public.entry_status;

    if v_to is null then
      raise exception 'Action client inconnue: %', p_action using errcode = 'VT006';
    end if;

    v_entry := internal.apply_transition(
      v_entry.id, v_to, 'client', null, null, 'client_' || p_action,
      jsonb_build_object('action', p_action)
    );
  end if;

  perform public.recompute_queue_positions(v_entry.queue_id);
  select * into v_entry from public.queue_entries where id = v_entry.id;

  return jsonb_build_object(
    'entry', internal.entry_json_client(v_entry),
    'queueId', v_entry.queue_id
  );
end;
$$;

-- =====================================================================
-- 7. Actions du professionnel
-- =====================================================================
-- Même signature. Les branches historiques sont reprises à l'identique ;
-- trois sont nuancées hors walkin seulement :
--   complete      : pas de promotion en atelier ni au restaurant ;
--   start_serving : pas de contrôle « déjà occupé » en atelier ;
--   call          : au guichet, affecte le guichet (options.staffId ou le
--                   professionnel) et refuse un second appelé au même
--                   guichet (VT010) ; en atelier et pour une commande
--                   suivie en boutique, équivaut à set_stage('ready').
-- Branches ajoutées : set_stage, send_quote, update_details, set_eta,
-- set_claim, recall, message.
create or replace function public.staff_queue_action(
  p_entry_public_id text,
  p_action          text,
  p_actor_user_id   uuid default null,
  p_actor_staff_id  uuid default null,
  p_options         jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_entry     public.queue_entries;
  v_queue     public.queues;
  v_promoted  public.queue_entries;
  v_policy    public.absent_policy;
  v_by        int;
  v_new_order double precision;
  v_free_staff uuid;
  v_busy      boolean;
  v_desk      uuid;
  v_count     int;
  v_last      timestamptz;
  v_patch     jsonb;
  v_clean     jsonb;
  v_amount    numeric;
  v_label     text;
  v_ttl       int;
begin
  select * into v_entry from public.queue_entries where public_id = p_entry_public_id;
  if not found then
    raise exception 'Ticket introuvable' using errcode = 'VT005';
  end if;

  select * into v_queue from public.queues where id = v_entry.queue_id for update;
  -- Relu sous le verrou de file : un autre poste a pu agir entre-temps.
  select * into v_entry from public.queue_entries where id = v_entry.id;

  if p_actor_staff_id is not null and not exists (
    select 1 from public.staff s
    where s.id = p_actor_staff_id and s.organization_id = v_entry.organization_id
  ) then
    raise exception 'Professionnel hors organisation' using errcode = 'VT009';
  end if;

  case p_action

    when 'complete' then
      v_free_staff := coalesce(p_actor_staff_id, v_entry.staff_id, v_entry.served_by_staff_id);
      v_entry := internal.apply_transition(
        v_entry.id, 'completed', 'staff', p_actor_user_id, p_actor_staff_id,
        'complete', '{}'::jsonb
      );
      if internal.profile_auto_advance(v_queue.profile) then
        v_promoted := internal.promote_next(
          v_entry.queue_id, v_free_staff, 'staff', p_actor_user_id, p_actor_staff_id
        );
      end if;

    when 'start_serving' then
      v_free_staff := coalesce(p_actor_staff_id, v_entry.staff_id);
      if not internal.profile_parallel(v_queue.profile) then
        select exists (
          select 1 from public.queue_entries e
          where e.queue_id = v_entry.queue_id and e.status = 'serving' and e.id <> v_entry.id
            and e.stage is null
            and (
              (v_free_staff is not null and e.staff_id is not distinct from v_free_staff)
              or (v_free_staff is null and v_queue.mode = 'shared')
            )
        ) into v_busy;
        if v_busy then
          raise exception 'Ce professionnel a déjà une prestation en cours'
            using errcode = 'VT010';
        end if;
      end if;
      if v_queue.mode = 'shared' and v_free_staff is not null and v_entry.staff_id is null then
        update public.queue_entries set staff_id = v_free_staff where id = v_entry.id;
      end if;
      v_entry := internal.apply_transition(
        v_entry.id, 'serving', 'staff', p_actor_user_id, p_actor_staff_id, 'start_serving'
      );

    when 'call' then
      if v_queue.profile in ('vehicle', 'device')
         or (v_queue.profile = 'retail' and v_entry.stage is not null) then
        v_entry := internal.set_entry_stage(
          v_entry.id, 'ready', coalesce((p_options ->> 'notify')::boolean, true),
          'staff', p_actor_user_id, p_actor_staff_id
        );
      elsif v_queue.profile = 'desk' then
        v_desk := coalesce(nullif(p_options ->> 'staffId', '')::uuid, p_actor_staff_id);
        if v_desk is not null then
          if not exists (
            select 1 from public.staff s
            where s.id = v_desk and s.location_id = v_queue.location_id and s.is_active
          ) then
            raise exception 'Guichet inconnu pour cet établissement' using errcode = 'VT009';
          end if;
          if exists (
            select 1 from public.queue_entries e
            where e.queue_id = v_queue.id and e.status = 'next'
              and e.staff_id = v_desk and e.id <> v_entry.id
          ) then
            raise exception 'Ce guichet a déjà appelé quelqu''un' using errcode = 'VT010';
          end if;
          update public.queue_entries set staff_id = v_desk where id = v_entry.id;
        end if;
        v_entry := internal.apply_transition(
          v_entry.id, 'next', 'staff', p_actor_user_id, p_actor_staff_id, 'call',
          jsonb_build_object('deskStaffId', v_desk)
        );
      else
        v_entry := internal.apply_transition(
          v_entry.id, 'next', 'staff', p_actor_user_id, p_actor_staff_id, 'call'
        );
      end if;

    when 'mark_present' then
      v_entry := internal.apply_transition(
        v_entry.id, 'present', 'staff', p_actor_user_id, p_actor_staff_id, 'mark_present'
      );

    when 'mark_absent' then
      v_policy := coalesce(
        nullif(p_options ->> 'policy', '')::public.absent_policy,
        v_queue.absent_policy
      );
      if v_policy = 'move_back' then
        v_by := coalesce((p_options ->> 'by')::int, v_queue.absent_move_back_by);
        v_new_order := internal.sort_order_for_offset(v_entry, v_by);
        update public.queue_entries
           set sort_order = v_new_order,
               absent_at = now(),
               rejoin_count = rejoin_count + 1,
               -- Le client sera re-notifié quand son tour reviendra.
               notification_status = notification_status
                 - 'your_turn' - 'ahead_one' - 'ahead_two'
         where id = v_entry.id;
        select * into v_entry from public.queue_entries where id = v_entry.id;
        if v_entry.status <> 'waiting' then
          v_entry := internal.apply_transition(
            v_entry.id, 'waiting', 'staff', p_actor_user_id, p_actor_staff_id,
            'absent_move_back', jsonb_build_object('by', v_by)
          );
        else
          perform internal.log_queue_event(
            v_entry, 'absent_move_back', 'waiting', 'waiting',
            'staff', p_actor_user_id, p_actor_staff_id, jsonb_build_object('by', v_by)
          );
        end if;
        -- Le professionnel est libéré : on enchaîne sur le suivant.
        v_promoted := internal.promote_next(
          v_entry.queue_id, coalesce(p_actor_staff_id, v_entry.staff_id),
          'staff', p_actor_user_id, p_actor_staff_id
        );
      else
        v_free_staff := coalesce(p_actor_staff_id, v_entry.staff_id);
        v_entry := internal.apply_transition(
          v_entry.id, 'absent', 'staff', p_actor_user_id, p_actor_staff_id,
          'mark_absent', jsonb_build_object('policy', v_policy)
        );
        v_promoted := internal.promote_next(
          v_entry.queue_id, v_free_staff, 'staff', p_actor_user_id, p_actor_staff_id
        );
      end if;

    when 'defer' then
      v_by := greatest(coalesce((p_options ->> 'by')::int, v_queue.absent_move_back_by), 1);
      v_new_order := internal.sort_order_for_offset(v_entry, v_by);
      update public.queue_entries
         set sort_order = v_new_order,
             notification_status = notification_status
               - 'your_turn' - 'ahead_one' - 'ahead_two'
       where id = v_entry.id;
      select * into v_entry from public.queue_entries where id = v_entry.id;
      if v_entry.status in ('serving', 'next', 'present') then
        v_free_staff := coalesce(p_actor_staff_id, v_entry.staff_id);
        v_entry := internal.apply_transition(
          v_entry.id, 'waiting', 'staff', p_actor_user_id, p_actor_staff_id,
          'defer', jsonb_build_object('by', v_by)
        );
        v_promoted := internal.promote_next(
          v_entry.queue_id, v_free_staff, 'staff', p_actor_user_id, p_actor_staff_id
        );
      else
        perform internal.log_queue_event(
          v_entry, 'defer', v_entry.status, v_entry.status,
          'staff', p_actor_user_id, p_actor_staff_id, jsonb_build_object('by', v_by)
        );
      end if;

    when 'remove' then
      v_free_staff := coalesce(p_actor_staff_id, v_entry.staff_id);
      v_entry := internal.apply_transition(
        v_entry.id, 'skipped', 'staff', p_actor_user_id, p_actor_staff_id,
        'remove', jsonb_build_object('reason', p_options ->> 'reason')
      );
      v_promoted := internal.promote_next(
        v_entry.queue_id, v_free_staff, 'staff', p_actor_user_id, p_actor_staff_id
      );

    when 'restore' then
      update public.queue_entries
         set sort_order = case
               when (p_options ->> 'position') = 'front'
                 then coalesce((select min(sort_order) from public.queue_entries e2
                                where e2.queue_id = v_entry.queue_id
                                  and public.entry_is_active(e2.status)), 1000) - 1
               else internal.next_sort_order(v_entry.queue_id)
             end,
             rejoin_count = rejoin_count + 1,
             absent_at = null,
             notification_status = notification_status
               - 'your_turn' - 'ahead_one' - 'ahead_two'
       where id = v_entry.id;
      v_entry := internal.apply_transition(
        v_entry.id, 'waiting', 'staff', p_actor_user_id, p_actor_staff_id,
        'restore', p_options
      );

    when 'cancel' then
      v_free_staff := coalesce(p_actor_staff_id, v_entry.staff_id);
      v_entry := internal.apply_transition(
        v_entry.id, 'cancelled', 'staff', p_actor_user_id, p_actor_staff_id, 'cancel'
      );
      v_promoted := internal.promote_next(
        v_entry.queue_id, v_free_staff, 'staff', p_actor_user_id, p_actor_staff_id
      );

    when 'assign_staff' then
      update public.queue_entries
         set staff_id = nullif(p_options ->> 'staffId', '')::uuid
       where id = v_entry.id;
      select * into v_entry from public.queue_entries where id = v_entry.id;
      perform internal.log_queue_event(
        v_entry, 'assign_staff', v_entry.status, v_entry.status,
        'staff', p_actor_user_id, p_actor_staff_id, p_options
      );

    when 'note' then
      update public.queue_entries
         set staff_note = nullif(trim(coalesce(p_options ->> 'note', '')), '')
       where id = v_entry.id;
      select * into v_entry from public.queue_entries where id = v_entry.id;

    -- ----------------------------------------------------------------
    -- Branches des profils
    -- ----------------------------------------------------------------

    -- {stage, notify} : l'étape n'est connue que de son profil (sinon
    -- VT006). Aucun contrôle « déjà occupé » : une étape décrit l'objet
    -- suivi (véhicule, commande), pas la personne qui le traite.
    when 'set_stage' then
      v_entry := internal.set_entry_stage(
        v_entry.id, p_options ->> 'stage', coalesce((p_options ->> 'notify')::boolean, true),
        'staff', p_actor_user_id, p_actor_staff_id
      );

    -- {amountCents, label} : le devis est réécrit (décision remise à
    -- null : un devis modifié après accord redemande l'accord), puis
    -- l'étape passe à quote_pending. L'historique des décisions reste dans
    -- queue_events. Clé d'envoi : 'quote:<quote_count>'.
    when 'send_quote' then
      if v_queue.profile not in ('vehicle', 'device')
         or not coalesce((v_queue.profile_options ->> 'quotes')::boolean, false) then
        raise exception 'Les devis ne sont pas activés pour cette file' using errcode = 'VT006';
      end if;
      if not public.entry_is_active(v_entry.status) then
        raise exception 'Ce ticket n''est plus en cours' using errcode = 'VT006';
      end if;
      if jsonb_typeof(p_options -> 'amountCents') is distinct from 'number' then
        raise exception 'Informations invalides : montant du devis' using errcode = 'VT015';
      end if;
      v_amount := (p_options ->> 'amountCents')::numeric;
      v_label := internal.clean_text(p_options ->> 'label');
      if v_amount <> trunc(v_amount) or v_amount not between 0 and 10000000
         or v_label is null or length(v_label) > 80 then
        raise exception 'Informations invalides : devis' using errcode = 'VT015';
      end if;
      v_clean := internal.clean_details(v_queue.profile, jsonb_build_object('quote', jsonb_build_object(
        'amountCents', v_amount::int,
        'label', v_label,
        'sentAt', to_jsonb(now()),
        'decision', null,
        'decidedAt', null
      )), 'system');
      v_count := coalesce((v_entry.notification_status ->> 'quote_count')::int, 0) + 1;
      update public.queue_entries
         set details = details || v_clean,
             notification_status = notification_status || jsonb_build_object('quote_count', v_count)
       where id = v_entry.id
      returning * into v_entry;
      perform internal.log_queue_event(
        v_entry, 'quote_sent', v_entry.status, v_entry.status,
        'staff', p_actor_user_id, p_actor_staff_id, jsonb_build_object('n', v_count)
      );
      v_entry := internal.set_entry_stage(
        v_entry.id, 'quote_pending', coalesce((p_options ->> 'notify')::boolean, true),
        'staff', p_actor_user_id, p_actor_staff_id
      );

    -- {details} : fusion validée par clean_details(…, 'staff'). Une clé à
    -- null est retirée. Le devis n'y passe jamais (action dédiée).
    when 'update_details' then
      v_patch := p_options -> 'details';
      if jsonb_typeof(v_patch) is distinct from 'object' then
        raise exception 'Informations invalides' using errcode = 'VT015';
      end if;
      v_clean := internal.clean_details(v_queue.profile, v_patch, 'staff');
      v_patch := (v_entry.details - array(
                    select j.key from jsonb_each(v_patch) j where jsonb_typeof(j.value) = 'null'
                  )) || v_clean;
      -- Le pays et l'immatriculation se relisent ensemble.
      if v_patch ? 'registration' then
        v_patch := v_patch || jsonb_build_object('registration',
          internal.format_registration(v_patch ->> 'registration', v_patch ->> 'country'));
      end if;
      if pg_column_size(v_patch) > 2048 then
        raise exception 'Informations invalides : trop volumineuses' using errcode = 'VT015';
      end if;
      update public.queue_entries
         set details = v_patch,
             registration_key = internal.normalize_registration(v_patch ->> 'registration')
       where id = v_entry.id
      returning * into v_entry;
      perform internal.log_queue_event(
        v_entry, 'details_updated', v_entry.status, v_entry.status,
        'staff', p_actor_user_id, p_actor_staff_id,
        jsonb_build_object('keys', (select coalesce(jsonb_agg(k order by k), '[]'::jsonb)
                                    from jsonb_object_keys(p_options -> 'details') k))
      );

    -- {readyEta | null} : la promesse du professionnel (« Prévu jeudi
    -- 17 h »), dans les 60 jours. Ce n'est jamais un calcul du logiciel.
    when 'set_eta' then
      if v_queue.profile not in ('vehicle', 'device') then
        raise exception 'Action indisponible pour ce profil' using errcode = 'VT006';
      end if;
      if jsonb_typeof(p_options -> 'readyEta') is null
         or jsonb_typeof(p_options -> 'readyEta') = 'null' then
        update public.queue_entries set details = details - 'readyEta'
         where id = v_entry.id returning * into v_entry;
      else
        v_clean := internal.clean_details(
          v_queue.profile, jsonb_build_object('readyEta', p_options -> 'readyEta'), 'staff');
        update public.queue_entries set details = details || v_clean
         where id = v_entry.id returning * into v_entry;
      end if;
      perform internal.log_queue_event(
        v_entry, 'eta', v_entry.status, v_entry.status,
        'staff', p_actor_user_id, p_actor_staff_id,
        jsonb_build_object('set', v_entry.details ? 'readyEta')
      );

    -- {tokenHash, ttlMinutes} : QR de suivi à usage unique. Seulement
    -- pour une fiche active qui n'est encore suivie par aucun appareil ;
    -- 24 h au plus ; remplace le jeton précédent. Jamais en walkin ni en
    -- event, qui n'ont pas de fiche créée pour autrui.
    when 'set_claim' then
      if v_queue.profile in ('walkin', 'event') then
        raise exception 'Action indisponible pour ce profil' using errcode = 'VT006';
      end if;
      if not public.entry_is_active(v_entry.status) or v_entry.client_session_id is not null then
        raise exception 'Cette fiche est déjà suivie ou n''est plus en cours' using errcode = 'VT006';
      end if;
      if coalesce(p_options ->> 'tokenHash', '') !~ '^[0-9a-f]{64}$' then
        raise exception 'Informations invalides : jeton' using errcode = 'VT015';
      end if;
      v_ttl := coalesce((p_options ->> 'ttlMinutes')::int, 1440);
      if v_ttl not between 1 and 1440 then
        raise exception 'Informations invalides : durée du jeton (24 h au plus)' using errcode = 'VT015';
      end if;
      update public.queue_entries
         set claim_token_hash = p_options ->> 'tokenHash',
             claim_expires_at = now() + make_interval(mins => v_ttl)
       where id = v_entry.id
      returning * into v_entry;
      -- Jamais le hash dans le journal.
      perform internal.log_queue_event(
        v_entry, 'claim_issued', v_entry.status, v_entry.status,
        'staff', p_actor_user_id, p_actor_staff_id, jsonb_build_object('ttlMinutes', v_ttl)
      );

    -- Rappel d'un client appelé (next) : trois au plus. Clé d'envoi :
    -- 'recall:<recall_count>'.
    when 'recall' then
      if v_entry.status <> 'next' then
        raise exception 'Seul un client appelé peut être rappelé' using errcode = 'VT006';
      end if;
      v_count := coalesce((v_entry.notification_status ->> 'recall_count')::int, 0);
      if v_count >= 3 then
        raise exception 'Trois rappels au maximum' using errcode = 'VT006';
      end if;
      update public.queue_entries
         set notification_status = notification_status || jsonb_build_object('recall_count', v_count + 1)
       where id = v_entry.id
      returning * into v_entry;
      perform internal.log_queue_event(
        v_entry, 'recall', v_entry.status, v_entry.status,
        'staff', p_actor_user_id, p_actor_staff_id, jsonb_build_object('n', v_count + 1)
      );

    -- Message du professionnel (modèle rendu et envoyé côté serveur) :
    -- dix par ticket, trente secondes d'écart au moins. Garde-fou contre
    -- l'emballement comme contre un compte compromis. Clé d'envoi :
    -- 'custom:<custom_count>'.
    when 'message' then
      if not public.entry_is_active(v_entry.status) then
        raise exception 'Ce ticket n''est plus en cours' using errcode = 'VT006';
      end if;
      v_count := coalesce((v_entry.notification_status ->> 'custom_count')::int, 0);
      if v_count >= 10 then
        raise exception 'Trop de messages pour ce ticket (10 au plus)' using errcode = 'VT016';
      end if;
      v_last := (v_entry.notification_status ->> 'custom_last_at')::timestamptz;
      if v_last is not null and now() < v_last + interval '30 seconds' then
        raise exception 'Trop de messages : attendez 30 secondes entre deux envois' using errcode = 'VT016';
      end if;
      update public.queue_entries
         set notification_status = notification_status
           || jsonb_build_object('custom_count', v_count + 1, 'custom_last_at', to_jsonb(now()))
       where id = v_entry.id
      returning * into v_entry;
      perform internal.log_queue_event(
        v_entry, 'message', v_entry.status, v_entry.status,
        'staff', p_actor_user_id, p_actor_staff_id, jsonb_build_object('n', v_count + 1)
      );

    else
      raise exception 'Action inconnue: %', p_action using errcode = 'VT006';
  end case;

  -- L'étape suit le statut après une action générique (sans effet sur un
  -- ticket sans étape, donc en walkin).
  if v_entry.stage is not null then
    perform internal.realign_stage(v_entry.id, 'staff', p_actor_user_id, p_actor_staff_id);
  end if;

  perform public.recompute_queue_positions(v_entry.queue_id);
  select * into v_entry from public.queue_entries where id = v_entry.id;
  if v_promoted.id is not null then
    select * into v_promoted from public.queue_entries where id = v_promoted.id;
  end if;

  return jsonb_build_object(
    'entry', internal.entry_json_staff(v_entry),
    'promoted', case when v_promoted.id is null then null
                     else internal.entry_json_staff(v_promoted) end,
    'queueId', v_entry.queue_id,
    'organizationId', v_entry.organization_id,
    'locationId', v_entry.location_id
  );
end;
$$;

-- =====================================================================
-- 8. Guichet : appeler le suivant à son guichet
-- =====================================================================
-- Verrou de file ; refus si ce guichet a déjà un appelé (VT010) ; la
-- tête de file est affectée au guichet et passe « appelée ». Fonctionne
-- aussi file fermée : on appelle encore les derniers tickets du jour.
-- Renvoie la même forme que staff_queue_action ; entry est null si
-- personne n'attend.
create or replace function public.desk_call_next(
  p_queue_id      uuid,
  p_desk_staff_id uuid,
  p_actor_user_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_queue public.queues;
  v_head  public.queue_entries;
begin
  select * into v_queue from public.queues where id = p_queue_id for update;
  if not found then
    raise exception 'File introuvable' using errcode = 'VT005';
  end if;
  if v_queue.profile not in ('desk', 'retail') then
    raise exception 'Action indisponible pour ce profil' using errcode = 'VT006';
  end if;
  if p_desk_staff_id is null or not exists (
    select 1 from public.staff s
    where s.id = p_desk_staff_id and s.location_id = v_queue.location_id and s.is_active
  ) then
    raise exception 'Guichet inconnu pour cet établissement' using errcode = 'VT009';
  end if;
  if exists (
    select 1 from public.queue_entries e
    where e.queue_id = p_queue_id and e.status = 'next' and e.staff_id = p_desk_staff_id
  ) then
    raise exception 'Ce guichet a déjà appelé quelqu''un' using errcode = 'VT010';
  end if;

  select * into v_head
  from public.queue_entries e
  where e.queue_id = p_queue_id
    and e.status in ('waiting', 'notified', 'returning', 'present')
    and e.stage is null
    and (e.staff_id is null or e.staff_id = p_desk_staff_id)
  order by internal.status_rank(e.status), e.sort_order, e.joined_at, e.id
  limit 1
  for update skip locked;

  if found then
    update public.queue_entries set staff_id = p_desk_staff_id where id = v_head.id;
    v_head := internal.apply_transition(
      v_head.id, 'next', 'staff', p_actor_user_id, p_desk_staff_id, 'desk_call',
      jsonb_build_object('deskStaffId', p_desk_staff_id)
    );
    perform public.recompute_queue_positions(p_queue_id);
    select * into v_head from public.queue_entries where id = v_head.id;
  end if;

  return jsonb_build_object(
    'entry', case when v_head.id is null then null else internal.entry_json_staff(v_head) end,
    'promoted', null,
    'queueId', v_queue.id,
    'organizationId', v_queue.organization_id,
    'locationId', v_queue.location_id
  );
end;
$$;

-- =====================================================================
-- 9. Rattachement par QR de suivi (étiquette de clé)
-- =====================================================================

-- Aperçu avant rattachement : de quoi reconnaître SA fiche (« Suivre la
-- 208 ••-••3-CD chez Garage Martin ? »), jamais le prénom ni
-- l'immatriculation en clair. Null si le jeton est inconnu, expiré, déjà
-- utilisé, ou si la fiche n'est plus en cours.
create or replace function public.peek_claim(p_token_hash text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, internal, extensions
as $$
declare
  v_entry    public.queue_entries;
  v_queue    public.queues;
  v_location public.locations;
  v_org      public.organizations;
begin
  if coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' then
    return null;
  end if;
  select * into v_entry from public.queue_entries
  where claim_token_hash = p_token_hash;
  if not found
     or v_entry.claim_expires_at is null or v_entry.claim_expires_at <= now()
     or v_entry.client_session_id is not null
     or not public.entry_is_active(v_entry.status) then
    return null;
  end if;

  select * into v_queue from public.queues where id = v_entry.queue_id;
  select * into v_location from public.locations where id = v_entry.location_id;
  select * into v_org from public.organizations where id = v_entry.organization_id;
  if v_org.status <> 'active' or not v_location.is_active then
    return null;
  end if;

  return jsonb_build_object(
    'organization', jsonb_build_object('id', v_org.id, 'name', v_org.name, 'logoUrl', v_org.logo_url),
    'location', jsonb_build_object('name', v_location.name, 'slug', v_location.slug),
    'profile', v_queue.profile,
    'stage', v_entry.stage,
    'model', v_entry.details ->> 'model',
    'deviceKind', v_entry.details ->> 'deviceKind',
    'registrationMasked', internal.mask_registration(v_entry.details ->> 'registration'),
    'ticketNo', internal.format_ticket_no(v_queue.profile, v_queue.ticket_prefix, v_entry.ticket_no),
    'expiresAt', v_entry.claim_expires_at
  );
end;
$$;

-- Rattache la fiche à l'appareil qui présente le jeton : verrou de
-- ligne, jeton non expiré, fiche active et encore sans appareil, session
-- valide de la même organisation. Le jeton est effacé : usage unique.
-- Renvoie null pour tout refus (un seul message côté client : « ce lien
-- a déjà servi ou a expiré »), sans dire lequel.
create or replace function public.claim_entry(
  p_token_hash        text,
  p_client_session_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_entry   public.queue_entries;
  v_session public.client_sessions;
  v_slug    text;
begin
  if coalesce(p_token_hash, '') !~ '^[0-9a-f]{64}$' or p_client_session_id is null then
    return null;
  end if;

  select * into v_entry from public.queue_entries
  where claim_token_hash = p_token_hash
  for update;
  if not found
     or v_entry.claim_expires_at is null or v_entry.claim_expires_at <= now()
     or v_entry.client_session_id is not null
     or not public.entry_is_active(v_entry.status) then
    return null;
  end if;

  select * into v_session from public.client_sessions where id = p_client_session_id;
  if not found
     or v_session.organization_id <> v_entry.organization_id
     or v_session.revoked_at is not null
     or v_session.expires_at <= now() then
    return null;
  end if;

  begin
    update public.queue_entries
       set client_session_id = p_client_session_id,
           claim_token_hash = null,
           claim_expires_at = null
     where id = v_entry.id
    returning * into v_entry;
  exception when unique_violation then
    -- L'appareil suit déjà un ticket sans étape dans cette file.
    return null;
  end;

  update public.client_sessions set last_seen_at = now() where id = p_client_session_id;

  perform internal.log_queue_event(
    v_entry, 'claim', v_entry.status, v_entry.status, 'client', null, null, '{}'::jsonb
  );

  select slug into v_slug from public.locations where id = v_entry.location_id;

  return jsonb_build_object(
    'entry', internal.entry_json_client(v_entry),
    'queueId', v_entry.queue_id,
    'organizationId', v_entry.organization_id,
    'locationSlug', v_slug
  );
end;
$$;

-- =====================================================================
-- 10. Changement de profil d'une file
-- =====================================================================
-- Contrôlé SOUS VERROU DE FILE (for update), le même que prend
-- join_queue : une inscription concurrente ne peut pas se glisser entre
-- le contrôle « file vide » et le changement. Si l'inscription gagne, le
-- changement voit son ticket et échoue en VT017 ; si le changement
-- gagne, l'inscription suit le nouveau profil.
--
-- Ensuite : réglages par défaut du profil, prestations par défaut si
-- l'établissement n'en a aucune, et trace dans audit_logs. Retour en
-- arrière possible de la même façon, tant que la file est vide.
create or replace function internal.switch_queue_profile(
  p_queue_id      uuid,
  p_profile       public.queue_profile,
  p_actor_user_id uuid
) returns jsonb
language plpgsql
volatile
set search_path = public, internal, extensions
as $$
declare
  v_queue    public.queues;
  v_services int := 0;
begin
  if p_profile is null then
    raise exception 'Profil manquant' using errcode = 'VT015';
  end if;

  select * into v_queue from public.queues where id = p_queue_id for update;
  if not found then
    raise exception 'File introuvable' using errcode = 'VT005';
  end if;

  if exists (
    select 1 from public.queue_entries e
    where e.queue_id = p_queue_id and public.entry_is_active(e.status)
  ) then
    raise exception 'Terminez ou videz la file avant de changer de profil' using errcode = 'VT017';
  end if;

  if v_queue.profile = p_profile then
    return jsonb_build_object(
      'queueId', v_queue.id, 'profile', v_queue.profile,
      'previousProfile', v_queue.profile, 'changed', false, 'servicesCreated', 0
    );
  end if;

  perform internal.apply_profile_defaults(p_queue_id, p_profile);
  v_services := internal.seed_default_services(v_queue.location_id, p_profile);

  insert into public.audit_logs (
    organization_id, actor, actor_user_id, action, target_type, target_id, metadata
  ) values (
    v_queue.organization_id, 'staff', p_actor_user_id, 'queue.profile_changed', 'queue',
    v_queue.id::text,
    jsonb_build_object('from', v_queue.profile, 'to', p_profile, 'servicesCreated', v_services)
  );

  return jsonb_build_object(
    'queueId', v_queue.id,
    'profile', p_profile,
    'previousProfile', v_queue.profile,
    'changed', true,
    'servicesCreated', v_services
  );
end;
$$;

-- Enveloppe publique, réservée à service_role (action serveur
-- switchQueueProfile, permission queue.configure vérifiée avant).
create or replace function public.switch_queue_profile(
  p_queue_id      uuid,
  p_profile       public.queue_profile,
  p_actor_user_id uuid default null
) returns jsonb
language sql
security definer
set search_path = public, internal, extensions
as $$
  select internal.switch_queue_profile(p_queue_id, p_profile, p_actor_user_id);
$$;

-- =====================================================================
-- 11. Droits (motif de 0010) : jamais appelables depuis le navigateur
-- =====================================================================
do $$
declare
  fn text;
  fns text[] := array[
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
    'public.switch_queue_profile(uuid,public.queue_profile,uuid)'
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
