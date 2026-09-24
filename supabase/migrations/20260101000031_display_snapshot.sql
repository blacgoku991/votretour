-- =====================================================================
-- Rangvia — 0031 : ce que reçoit un écran de salle (display_snapshot)
-- =====================================================================
-- Le téléviseur est un appareil PUBLIC : posé en salle, sans compte,
-- authentifié par un simple cookie d'appairage, et visible de tous. Jusqu'ici
-- /api/tv/snapshot, /tv et /ecran/[org] lui envoyaient queue_snapshot, c'est-
-- à-dire l'instantané complet du poste du pro : notes privées (« Rappeler au
-- 06… »), journal des notifications, prénoms complets de toute la file,
-- réglages de la file. Rien de cela n'est affiché, mais tout partait dans la
-- réponse, lisible par quiconque ouvre les outils du navigateur de la TV.
--
-- display_snapshot renvoie EXACTEMENT ce que TVBoard.tsx et tvSlats.ts
-- lisent, ni plus ni moins. Inventaire (lot T0) :
--
--   queue.id, queue.status        clé du rafraîchissement ; pastille d'état
--   location.name                 « Paris 11 » sous l'enseigne
--   counts.active                 « 12 dans la file »
--   counts.waiting                le grand volet « 9 personnes en attente »
--   counts.serving                « + 2 en prestation » au-delà de 3 volets
--   counts.completedToday         « 3 clients servis aujourd'hui »
--   counts.upcoming               « Les 7 premiers sur 10 », libellé de scène
--   staff[] (6 au plus)           pastilles d'équipe : id, name, isOnBreak,
--                                 isServing (l'identifiant du ticket servi
--                                 n'est pas nécessaire : seul « occupé » compte)
--   serving[] (3 au plus)         volets « Au comptoir » : id, name (le prénom
--                                 que le client a saisi, pour qu'il se
--                                 reconnaisse), staffName (« avec Karim »)
--   upcoming[] (7 au plus)        lattes « À suivre » : id, called, initials
--
-- Les bornes 3, 6 et 7 sont celles de l'écran (serving.slice(0, 3),
-- staff.slice(0, 6), TV_MAX_SLATS) : au-delà, rien n'est affiché, donc rien
-- n'est envoyé. En particulier, les prénoms des personnes qui attendent ne
-- quittent plus le serveur : l'écran n'en montre que les initiales, calculées
-- ici (internal.display_initials) comme le faisait initials() côté navigateur.
--
-- Jamais : note, notified, client_session_id, details, réglages de la file,
-- identifiants d'organisation ou d'établissement.
--
-- Version walkin/event. La migration 0036 (profils) la redéfinit avec la même
-- signature ; en walkin, sa sortie doit rester identique (test 12 rejoué).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- Initiales d'un prénom, à l'identique de initials() (lib/format.ts) :
--   « Zoé Dupont — Paris » -> « ZD » : on garde le nom avant le tiret isolé ;
--   seuls les mots qui commencent par une lettre comptent (« Studio 92 » -> S) ;
--   deux mots au plus ; « ? » si rien d'exploitable.
-- Les blancs sont ceux de \s en JavaScript (espace insécable, espaces fines,
-- séparateurs Unicode), écrits en clair : la classe [[:space:]] de PostgreSQL
-- dépend de la locale du serveur et ignore l'espace insécable en C.UTF-8.
-- Deux écarts assumés, sans effet sur un prénom réel : upper() suit la casse
-- simple (« ß » reste « ß », JavaScript donnerait « SS ») et un caractère hors
-- du plan de base est gardé entier (JavaScript en coupait la moitié).
-- La parité suppose un lc_ctype Unicode (fr_FR.UTF-8 en production, C.UTF-8
-- sur le banc) : sous un ctype C ou POSIX, [[:alpha:]] et upper() ne voient
-- que l'ASCII, et « 92 Émilie » donnerait « 9É » au lieu de « É » (test 12).
-- ---------------------------------------------------------------------
create or replace function internal.display_initials(p_name text)
returns text
language plpgsql
immutable
strict
parallel safe
set search_path = pg_catalog
as $$
declare
  -- \s de JavaScript : WhiteSpace + LineTerminator (ECMA-262).
  c_ws    constant text := '[\t\n\v\f\r    -     　﻿]';
  v_base  text;
  v_words text[];
  v_pick  text[];
  v_out   text := '';
  v_word  text;
begin
  -- « Garage 92 — Nanterre » : le nom avant le premier tiret entouré de blancs.
  v_base := (regexp_split_to_array(p_name, c_ws || '[—–-]' || c_ws))[1];
  v_base := regexp_replace(v_base, '^' || c_ws || '+|' || c_ws || '+$', '', 'g');

  select coalesce(array_agg(w order by n), '{}')
    into v_words
    from regexp_split_to_table(v_base, c_ws || '+') with ordinality as t(w, n)
   where w <> '';

  select coalesce(array_agg(w order by n), '{}')
    into v_pick
    from unnest(v_words) with ordinality as t(w, n)
   where w ~ '^[[:alpha:]]';

  if cardinality(v_pick) = 0 then
    v_pick := v_words;
  end if;

  foreach v_word in array v_pick[1:2] loop
    v_out := v_out || upper(left(v_word, 1));
  end loop;

  return coalesce(nullif(v_out, ''), '?');
end;
$$;

comment on function internal.display_initials(text) is
  'Initiales affichées par l''écran de salle ; parité avec initials() de lib/format.ts.';

-- ---------------------------------------------------------------------
-- L'instantané de l'écran de salle.
-- ---------------------------------------------------------------------
create or replace function public.display_snapshot(p_queue_id uuid)
returns jsonb
language plpgsql
stable
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
      'id',     v_queue.id,
      'status', v_queue.status
    ),
    'location', jsonb_build_object(
      'name', v_location.name
    ),

    -- Mêmes définitions que queue_snapshot (0009) : les chiffres de la TV
    -- et ceux du poste du pro ne peuvent pas diverger.
    'counts', jsonb_build_object(
      'active', (select count(*) from public.queue_entries e
                 where e.queue_id = p_queue_id and public.entry_is_active(e.status)),
      'waiting', (select count(*) from public.queue_entries e
                  where e.queue_id = p_queue_id
                    and e.status in ('waiting', 'notified', 'returning', 'present')),
      'serving', (select count(*) from public.queue_entries e
                  where e.queue_id = p_queue_id and e.status = 'serving'),
      'upcoming', (select count(*) from public.queue_entries e
                   where e.queue_id = p_queue_id
                     and e.status in ('next', 'waiting', 'notified', 'returning', 'present')),
      'completedToday', (select count(*) from public.queue_entries e
                         where e.queue_id = p_queue_id and e.status = 'completed'
                           and e.completed_at >= date_trunc('day', now() at time zone coalesce(v_location.timezone, 'UTC')) at time zone coalesce(v_location.timezone, 'UTC'))
    ),

    -- Pastilles d'équipe : les six premiers, dans l'ordre du poste du pro.
    'staff', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',        s.id,
               'name',      s.display_name,
               'isOnBreak', s.is_on_break,
               'isServing', exists (
                 select 1 from public.queue_entries e
                 where e.queue_id = p_queue_id and e.status = 'serving' and e.staff_id = s.id
               )
             ) order by s.sort_order, s.display_name, s.id)
      from (
        -- s.id départage deux homonymes au même rang : sans lui, le sixième
        -- pro affiché pourrait changer d'un rafraîchissement à l'autre.
        -- (queue_snapshot n'a pas ce départage ; il ne compte qu'en cas
        -- d'égalité parfaite, où son propre ordre n'est pas défini.)
        select * from public.staff
        where location_id = v_queue.location_id and is_active
        order by sort_order, display_name, id
        limit 6
      ) s
    ), '[]'::jsonb),

    -- Au comptoir : trois volets au plus. Le nom du pro est résolu ici parmi
    -- l'équipe active de l'établissement, comme le faisait l'écran avec la
    -- liste staff de queue_snapshot (sinon : « En prestation »).
    'serving', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',        x.public_id,
               'name',      x.client_name,
               'staffName', (
                 select nullif(s.display_name, '') from public.staff s
                 where s.id = x.staff_id and s.location_id = v_queue.location_id and s.is_active
               )
             ) order by x.rank)
      from (
        select e.public_id, e.client_name, e.staff_id,
               row_number() over (order by e.service_started_at nulls last, e.sort_order) as rank
        from public.queue_entries e
        where e.queue_id = p_queue_id and e.status = 'serving'
        order by e.service_started_at nulls last, e.sort_order
        limit 3
      ) x
    ), '[]'::jsonb),

    -- À suivre : les appelés d'abord, puis l'attente, dans l'ordre exact de
    -- queue_snapshot (called puis waiting). Sept lattes au plus.
    'upcoming', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',       x.public_id,
               'called',   x.called,
               'initials', case when coalesce(x.client_name, '') = '' then null
                                else internal.display_initials(x.client_name) end
             ) order by x.rank)
      from (
        select e.public_id, e.client_name, (e.status = 'next') as called,
               row_number() over (
                 order by (e.status <> 'next'),
                          case when e.status = 'next' then 0 else internal.status_rank(e.status) end,
                          e.sort_order, e.joined_at
               ) as rank
        from public.queue_entries e
        where e.queue_id = p_queue_id
          and e.status in ('next', 'waiting', 'notified', 'returning', 'present')
        order by rank
        limit 7
      ) x
    ), '[]'::jsonb)
  );
end;
$$;

comment on function public.display_snapshot(uuid) is
  'Écran de salle (TV) : uniquement les champs affichés. Réservée à service_role.';

-- Motif de 0010 : jamais appelable depuis le navigateur, ni par la TV.
revoke all on function public.display_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.display_snapshot(uuid) to service_role;
revoke all on function internal.display_initials(text) from public, anon, authenticated;

commit;

notify pgrst, 'reload schema';
