-- =====================================================================
-- Rangvia — 0035 : profils métier, sérialisation
-- ---------------------------------------------------------------------
-- Clés JSON AJOUTÉES seulement : aucune clé existante n'est retirée,
-- renommée ni ne change de valeur. L'App Clip déjà installé et la
-- version précédente de l'application ignorent les clés inconnues
-- (JSONDecoder par défaut, objets TypeScript). En walkin, chaque clé
-- ajoutée porte une valeur neutre : 'walkin', null, {} ou [].
--
-- public_queue_state n'est PAS modifiée : la diffusion publique ne
-- contient toujours aucune donnée métier. Un changement d'étape est
-- signalé à l'appareil concerné par un événement de ticket, et seul lui
-- relit son ticket_state.
-- =====================================================================

begin;

-- Ce que le client voit de SES propres informations : tout ce qu'il a
-- décrit, sauf ce qui ne regarde que l'atelier (clés reçues), et le devis
-- réduit à son numéro, son montant, son libellé, sa décision et son
-- heure d'envoi. Le numéro (n) sert de version : le client le renvoie
-- avec sa décision (client_queue_action, p_options.quoteN) pour ne jamais
-- accepter un devis modifié entre-temps.
create or replace function internal.details_for_client(p_details jsonb)
returns jsonb
language sql
immutable
as $$
  select (coalesce(p_details, '{}'::jsonb) - 'keys' - 'quote')
    || case when jsonb_typeof(p_details -> 'quote') = 'object' then jsonb_build_object(
         'quote', jsonb_build_object(
           'n',           p_details -> 'quote' -> 'n',
           'amountCents', p_details -> 'quote' -> 'amountCents',
           'label',       p_details -> 'quote' -> 'label',
           'sentAt',      p_details -> 'quote' -> 'sentAt',
           'decision',    p_details -> 'quote' -> 'decision'))
       else '{}'::jsonb end;
$$;

-- Options d'une file utiles au formulaire et à l'écran du client. Les
-- réglages du poste (tailles de table, délai d'avis, écran TV) n'y sont
-- pas. {} en walkin.
create or replace function internal.public_profile_options(p_options jsonb)
returns jsonb
language sql
immutable
as $$
  select coalesce(jsonb_object_agg(o.key, o.value), '{}'::jsonb)
  from jsonb_each(coalesce(p_options, '{}'::jsonb)) o
  where o.key in ('partyMax', 'stayChoice', 'numbering', 'sensitive', 'quotes', 'registrationRequired');
$$;

-- ---------------------------------------------------------------------
-- Ticket, vu par le client (clés ajoutées : profile, stage,
-- stageChangedAt, ticketNo, details, deskLabel, readyEta)
-- ---------------------------------------------------------------------
create or replace function internal.entry_json_client(e public.queue_entries)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id',          e.public_id,
    'name',        e.client_name,
    'status',      e.status,
    'peopleAhead', e.people_ahead,
    'joinedAt',    e.joined_at,
    'calledAt',    e.called_at,
    'returningAt', e.returning_at,
    'serviceStartedAt', e.service_started_at,
    'completedAt', e.completed_at,
    'staffName',   (select s.display_name from public.staff s where s.id = e.staff_id),
    'eventId',     e.metadata ->> 'eventId',
    'eventTicketNumber', nullif(e.metadata ->> 'eventTicketNumber', '')::int,
    'profile',     coalesce(q.profile, 'walkin'),
    'stage',       e.stage,
    'stageChangedAt', e.stage_changed_at,
    'ticketNo',    internal.format_ticket_no(q.profile, q.ticket_prefix, e.ticket_no),
    'details',     internal.details_for_client(e.details),
    -- Au guichet : « Guichet 3 », ou le nom de la fiche à défaut.
    'deskLabel',   case when q.profile = 'desk' then
                     (select coalesce(s.desk_label, s.display_name) from public.staff s where s.id = e.staff_id)
                   end,
    'readyEta',    e.details -> 'readyEta'
  )
  from (select 1) as one
  left join public.queues q on q.id = e.queue_id;
$$;

-- ---------------------------------------------------------------------
-- Ticket, vu par le professionnel (clés ajoutées : stage,
-- stageChangedAt, details, ticketNo, registrationKey, claimPending,
-- deskLabel). Jamais le hash du jeton de suivi : un booléen suffit.
-- ---------------------------------------------------------------------
create or replace function internal.entry_json_staff(e public.queue_entries)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id',            e.public_id,
    'name',          e.client_name,
    'status',        e.status,
    'peopleAhead',   e.people_ahead,
    'staffId',       e.staff_id,
    'serviceId',     e.service_id,
    'source',        e.source,
    'note',          e.staff_note,
    'rejoinCount',   e.rejoin_count,
    'joinedAt',      e.joined_at,
    'calledAt',      e.called_at,
    'returningAt',   e.returning_at,
    'presentAt',     e.present_at,
    'serviceStartedAt', e.service_started_at,
    'completedAt',   e.completed_at,
    'absentAt',      e.absent_at,
    'notified',      e.notification_status,
    'eventId',       e.metadata ->> 'eventId',
    'eventTicketNumber', nullif(e.metadata ->> 'eventTicketNumber', '')::int,
    'stage',         e.stage,
    'stageChangedAt', e.stage_changed_at,
    'details',       e.details,
    'ticketNo',      internal.format_ticket_no(q.profile, q.ticket_prefix, e.ticket_no),
    'registrationKey', e.registration_key,
    'claimPending',  e.claim_token_hash is not null and e.claim_expires_at > now(),
    'deskLabel',     (select s.desk_label from public.staff s where s.id = e.staff_id)
  )
  from (select 1) as one
  left join public.queues q on q.id = e.queue_id;
$$;

-- ---------------------------------------------------------------------
-- Résolution d'une URL publique /e/{slug} (clés ajoutées :
-- queue.profile, queue.publicOptions). Corps de 0007 inchangé par
-- ailleurs.
-- ---------------------------------------------------------------------
create or replace function public.resolve_entry_point(p_slug text)
returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_reg      public.slug_registry;
  v_location public.locations;
  v_plate    public.plates;
  v_queue    public.queues;
  v_org      public.organizations;
  v_settings public.organization_settings;
begin
  select * into v_reg from public.slug_registry where slug = lower(trim(p_slug));
  if not found then
    return null;
  end if;

  if v_reg.kind = 'plate' then
    select * into v_plate from public.plates where id = v_reg.ref_id;
    if not found or not v_plate.is_active then return null; end if;
    select * into v_location from public.locations where id = v_plate.location_id;
    if v_plate.queue_id is not null then
      select * into v_queue from public.queues where id = v_plate.queue_id;
    end if;
  else
    select * into v_location from public.locations where id = v_reg.ref_id;
  end if;

  if not found or v_location.id is null or not v_location.is_active then
    return null;
  end if;

  select * into v_org from public.organizations where id = v_location.organization_id;
  if v_org.status <> 'active' then
    return jsonb_build_object('status', 'suspended');
  end if;

  if v_queue.id is null then
    select * into v_queue from public.queues
    where location_id = v_location.id
    order by is_default desc, created_at
    limit 1;
  end if;

  select * into v_settings from public.organization_settings where organization_id = v_org.id;

  return jsonb_build_object(
    'status', 'ok',
    'slug', v_reg.slug,
    'organization', jsonb_build_object(
      'id', v_org.id,
      'name', v_org.name,
      'activity', v_org.activity,
      'logoUrl', v_org.logo_url
    ),
    'location', jsonb_build_object(
      'id', v_location.id,
      'name', v_location.name,
      'slug', v_location.slug,
      'city', v_location.city,
      'addressLine1', v_location.address_line1,
      'postalCode', v_location.postal_code,
      'latitude', v_location.latitude,
      'longitude', v_location.longitude,
      'mapsUrl', v_location.maps_url,
      'phone', v_location.phone,
      'logoUrl', coalesce(v_location.logo_url, v_org.logo_url),
      'coverUrl', v_location.cover_url,
      'timezone', v_location.timezone,
      'hasReviewLink', v_location.google_review_url is not null
    ),
    'plate', case when v_plate.id is null then null else jsonb_build_object(
      'id', v_plate.id,
      'code', v_plate.code,
      'label', v_plate.label,
      'kind', v_plate.kind,
      'staffId', v_plate.staff_id
    ) end,
    'queue', case when v_queue.id is null then null else jsonb_build_object(
      'id', v_queue.id,
      'name', v_queue.name,
      'mode', v_queue.mode,
      'status', v_queue.status,
      'askClientName', v_queue.ask_client_name,
      'clientNameRequired', v_queue.client_name_required,
      'allowStaffChoice', v_queue.allow_staff_choice,
      'allowServiceChoice', v_queue.allow_service_choice,
      'pauseReason', v_queue.pause_reason,
      'waitingCount', (
        select count(*) from public.queue_entries e
        where e.queue_id = v_queue.id and public.entry_is_active(e.status)
      ),
      'profile', v_queue.profile,
      'publicOptions', internal.public_profile_options(v_queue.profile_options)
    ) end,
    'settings', jsonb_build_object(
      'showPeopleAhead', coalesce(v_settings.show_people_ahead, true),
      'allowClientLeave', coalesce(v_settings.allow_client_leave, true),
      'brandAccent', coalesce(v_settings.brand_accent, 'signal'),
      'locale', coalesce(v_settings.default_locale, 'fr')
    ),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.display_name, 'roleTitle', s.role_title,
               'avatarUrl', s.avatar_url, 'accent', s.accent,
               'onBreak', s.is_on_break,
               'waiting', (select count(*) from public.queue_entries e
                           where e.staff_id = s.id and e.queue_id = v_queue.id
                             and public.entry_is_active(e.status))
             ) order by s.sort_order, s.display_name)
      from public.staff s
      where s.location_id = v_location.id and s.is_active and s.accepts_queue
    ), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', sv.id, 'name', sv.name, 'durationMinutes', sv.duration_minutes,
               'priceCents', sv.price_cents
             ) order by sv.sort_order, sv.name)
      from public.services sv
      where sv.location_id = v_location.id and sv.is_active
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- État d'un ticket, pour le client (clés ajoutées : queue.profile,
-- queue.ticketPrefix, queue.publicOptions, location.todayHours, stages,
-- otherTickets). Corps de 0009 inchangé par ailleurs.
-- ---------------------------------------------------------------------
create or replace function public.ticket_state(
  p_entry_public_id   text,
  p_client_session_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_entry    public.queue_entries;
  v_queue    public.queues;
  v_location public.locations;
  v_org      public.organizations;
  v_profiled boolean;
begin
  select * into v_entry from public.queue_entries where public_id = p_entry_public_id;
  if not found then return null; end if;
  if v_entry.client_session_id is distinct from p_client_session_id then
    raise exception 'Ce ticket n''appartient pas à cette session' using errcode = 'VT009';
  end if;

  select * into v_queue from public.queues where id = v_entry.queue_id;
  select * into v_location from public.locations where id = v_entry.location_id;
  select * into v_org from public.organizations where id = v_entry.organization_id;

  -- Les ajouts propres aux profils restent neutres en walkin et en event.
  v_profiled := v_queue.profile not in ('walkin', 'event');

  return jsonb_build_object(
    'entry', internal.entry_json_client(v_entry),
    'queue', jsonb_build_object(
      'id', v_queue.id, 'status', v_queue.status, 'mode', v_queue.mode,
      'name', v_queue.name, 'pauseReason', v_queue.pause_reason,
      'waiting', (select count(*) from public.queue_entries e
                  where e.queue_id = v_queue.id and public.entry_is_active(e.status)),
      'profile', v_queue.profile,
      'ticketPrefix', v_queue.ticket_prefix,
      'publicOptions', internal.public_profile_options(v_queue.profile_options)
    ),
    'location', jsonb_build_object(
      'id', v_location.id, 'name', v_location.name, 'slug', v_location.slug,
      'city', v_location.city, 'addressLine1', v_location.address_line1,
      'postalCode', v_location.postal_code, 'phone', v_location.phone,
      'latitude', v_location.latitude, 'longitude', v_location.longitude,
      'mapsUrl', v_location.maps_url, 'logoUrl', coalesce(v_location.logo_url, v_org.logo_url),
      -- Le lien d'avis n'est révélé qu'une fois la prestation terminée, et
      -- jamais dans une file où l'avis est désactivé (review = false :
      -- service administratif, santé). {} en walkin : inchangé.
      'googleReviewUrl', case when v_entry.status = 'completed'
                               and v_queue.profile_options -> 'review' is distinct from 'false'::jsonb
                              then v_location.google_review_url else null end,
      -- « Ouvert jusqu'à 19 h 00 » : horaires réels du jour, ou null.
      'todayHours', case when v_profiled then internal.today_hours(v_location.id) end
    ),
    'organization', jsonb_build_object('name', v_org.name, 'logoUrl', v_org.logo_url),
    -- Rail des étapes de CE ticket : codes d'étape et heures, rien d'autre.
    'stages', coalesce((
      select jsonb_agg(jsonb_build_object('stage', ev.payload ->> 'to', 'at', ev.created_at)
                       order by ev.created_at, ev.id)
      from public.queue_events ev
      where ev.entry_id = v_entry.id and ev.event_type = 'stage'
        and ev.payload ->> 'to' is not null
    ), '[]'::jsonb),
    -- Un téléphone qui suit plusieurs véhicules ou appareils : de quoi
    -- basculer de l'un à l'autre (identifiant public, modèle, étape).
    'otherTickets', case when v_profiled then coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.public_id, 'model', o.details ->> 'model', 'stage', o.stage,
               'ticketNo', internal.format_ticket_no(oq.profile, oq.ticket_prefix, o.ticket_no))
             order by o.joined_at desc)
      from public.queue_entries o
      join public.queues oq on oq.id = o.queue_id
      where o.client_session_id = p_client_session_id
        and o.id <> v_entry.id
        and o.organization_id = v_entry.organization_id
        and public.entry_is_active(o.status)
    ), '[]'::jsonb) else '[]'::jsonb end,
    'at', now()
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Instantané professionnel (clés ajoutées : queue.profile,
-- queue.profileOptions, queue.ticketPrefix, staff[].deskLabel,
-- counts.byStage, counts.coversWaiting, counts.coversSeatedToday).
-- Corps de 0009 inchangé par ailleurs.
--
-- Informations métier sur DEMANDE EXPLICITE (p_include_details) : sans
-- elle, chaque ticket porte details = {} et registrationKey = null — les
-- mêmes clés, des valeurs neutres. Pourquoi : jusqu'au lot T0, le kiosque
-- /api/tv/snapshot envoie tout queue_snapshot au téléviseur, appareil
-- public. Avec les profils, l'immatriculation en clair, le modèle et le
-- motif saisi partiraient donc vers la TV d'un garage, contre la règle
-- « immatriculation masquée à l'écran ». Le défaut sûr protège tous les
-- appelants d'aujourd'hui (TV, écran /ecran, poste walkin) quel que soit
-- l'ordre de mise en production de T0 et de ce lot ; seul le poste du
-- professionnel (lots P2 à P4) demande les informations métier, en
-- passant p_include_details => true.
--
-- Nouvelle signature (un paramètre en dernier, avec valeur par défaut) :
-- l'ancienne est supprimée pour que PostgREST n'ait jamais à choisir
-- entre deux surcharges ; rpc('queue_snapshot', { p_queue_id }) et les
-- appels positionnels des tests restent valides.
-- ---------------------------------------------------------------------
drop function if exists public.queue_snapshot(uuid);

-- Ticket de l'instantané : entry_json_staff complet, ou sans les
-- informations métier (mêmes clés, valeurs neutres).
create or replace function internal.snapshot_entry_json(e public.queue_entries, p_include_details boolean)
returns jsonb
language sql
stable
as $$
  select case when coalesce(p_include_details, false) then internal.entry_json_staff(e)
              else internal.entry_json_staff(e)
                   || jsonb_build_object('details', '{}'::jsonb, 'registrationKey', null)
         end;
$$;

create function public.queue_snapshot(
  p_queue_id        uuid,
  p_include_details boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_queue    public.queues;
  v_location public.locations;
begin
  select * into v_queue from public.queues where id = p_queue_id;
  if not found then return null; end if;
  select * into v_location from public.locations where id = v_queue.location_id;

  return jsonb_build_object(
    'queue', jsonb_build_object(
      'id', v_queue.id,
      'name', v_queue.name,
      'mode', v_queue.mode,
      'status', v_queue.status,
      'advanceMode', v_queue.advance_mode,
      'absentPolicy', v_queue.absent_policy,
      'absentMoveBackBy', v_queue.absent_move_back_by,
      'notifyAheadThreshold', v_queue.notify_ahead_threshold,
      'askClientName', v_queue.ask_client_name,
      'clientNameRequired', v_queue.client_name_required,
      'allowStaffChoice', v_queue.allow_staff_choice,
      'allowServiceChoice', v_queue.allow_service_choice,
      'pauseReason', v_queue.pause_reason,
      'maxActiveEntries', v_queue.max_active_entries,
      'locationId', v_queue.location_id,
      'organizationId', v_queue.organization_id,
      'profile', v_queue.profile,
      'profileOptions', v_queue.profile_options,
      'ticketPrefix', v_queue.ticket_prefix
    ),
    'location', jsonb_build_object(
      'id', v_location.id,
      'name', v_location.name,
      'slug', v_location.slug,
      'timezone', v_location.timezone,
      'googleReviewUrl', v_location.google_review_url
    ),
    'serving', coalesce((
      select jsonb_agg(internal.snapshot_entry_json(e, p_include_details)
             order by e.service_started_at nulls last, e.sort_order)
      from public.queue_entries e
      where e.queue_id = p_queue_id and e.status = 'serving'
    ), '[]'::jsonb),
    'called', coalesce((
      select jsonb_agg(internal.snapshot_entry_json(e, p_include_details) order by e.sort_order, e.joined_at)
      from public.queue_entries e
      where e.queue_id = p_queue_id and e.status = 'next'
    ), '[]'::jsonb),
    'waiting', coalesce((
      select jsonb_agg(internal.snapshot_entry_json(e, p_include_details)
             order by internal.status_rank(e.status), e.sort_order, e.joined_at)
      from public.queue_entries e
      where e.queue_id = p_queue_id
        and e.status in ('waiting', 'notified', 'returning', 'present')
    ), '[]'::jsonb),
    -- Absents et retirés récents : permettent le "remettre plus tard".
    'parked', coalesce((
      select jsonb_agg(internal.snapshot_entry_json(e, p_include_details) order by coalesce(e.absent_at, e.updated_at) desc)
      from public.queue_entries e
      where e.queue_id = p_queue_id
        and e.status in ('absent', 'skipped')
        and e.updated_at > now() - interval '6 hours'
    ), '[]'::jsonb),
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', s.id, 'name', s.display_name, 'roleTitle', s.role_title,
               'avatarUrl', s.avatar_url, 'accent', s.accent,
               'isOnBreak', s.is_on_break, 'acceptsQueue', s.accepts_queue,
               'userId', s.user_id,
               'servingEntryId', (
                 select e.public_id from public.queue_entries e
                 where e.queue_id = p_queue_id and e.status = 'serving' and e.staff_id = s.id
                 limit 1
               ),
               'waitingCount', (
                 select count(*) from public.queue_entries e
                 where e.queue_id = p_queue_id and e.staff_id = s.id
                   and public.entry_is_active(e.status) and e.status <> 'serving'
               ),
               'deskLabel', s.desk_label
             ) order by s.sort_order, s.display_name)
      from public.staff s
      where s.location_id = v_queue.location_id and s.is_active
    ), '[]'::jsonb),
    'services', coalesce((
      select jsonb_agg(jsonb_build_object('id', sv.id, 'name', sv.name,
                                          'durationMinutes', sv.duration_minutes)
             order by sv.sort_order, sv.name)
      from public.services sv
      where sv.location_id = v_queue.location_id and sv.is_active
    ), '[]'::jsonb),
    'counts', jsonb_build_object(
      'active', (select count(*) from public.queue_entries e
                 where e.queue_id = p_queue_id and public.entry_is_active(e.status)),
      'waiting', (select count(*) from public.queue_entries e
                  where e.queue_id = p_queue_id
                    and e.status in ('waiting','notified','returning','present')),
      'serving', (select count(*) from public.queue_entries e
                  where e.queue_id = p_queue_id and e.status = 'serving'),
      'completedToday', (select count(*) from public.queue_entries e
                         where e.queue_id = p_queue_id and e.status = 'completed'
                           and e.completed_at >= date_trunc('day', now() at time zone coalesce(v_location.timezone,'UTC')) at time zone coalesce(v_location.timezone,'UTC')),
      -- Colonnes du poste d'atelier : tickets actifs par étape ({} sans étape).
      'byStage', coalesce((
        select jsonb_object_agg(t.stage, t.n)
        from (
          select e.stage, count(*) as n
          from public.queue_entries e
          where e.queue_id = p_queue_id and e.stage is not null
            and public.entry_is_active(e.status)
          group by e.stage
        ) t
      ), '{}'::jsonb),
      -- Restaurant : couverts en attente (appelés compris) et installés
      -- aujourd'hui. null hors profil table.
      'coversWaiting', case when v_queue.profile = 'table' then (
        select coalesce(sum((e.details ->> 'partySize')::int), 0)
        from public.queue_entries e
        where e.queue_id = p_queue_id
          and e.status in ('waiting','notified','returning','present','next')
      ) end,
      'coversSeatedToday', case when v_queue.profile = 'table' then (
        select coalesce(sum((e.details ->> 'partySize')::int), 0)
        from public.queue_entries e
        where e.queue_id = p_queue_id and e.status = 'completed'
          and e.completed_at >= date_trunc('day', now() at time zone coalesce(v_location.timezone,'UTC')) at time zone coalesce(v_location.timezone,'UTC')
      ) end
    ),
    'generatedAt', now()
  );
end;
$$;

-- Droits : resolve_entry_point et ticket_state gardent leur signature
-- (droits conservés par « create or replace ») ; queue_snapshot est
-- recréée. On les pose tous ici pour que ce fichier se suffise.
do $$
declare
  fn text;
  fns text[] := array[
    'public.resolve_entry_point(text)',
    'public.ticket_state(text,uuid)',
    'public.queue_snapshot(uuid,boolean)'
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
