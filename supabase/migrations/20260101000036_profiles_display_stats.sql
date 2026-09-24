-- =====================================================================
-- Rangvia — 0036 : profils métier, écran de salle et statistiques
-- ---------------------------------------------------------------------
-- 1. display_snapshot (0031) est redéfinie, même signature, pour tous
--    les profils.
--
--    walkin et event : sortie STRICTEMENT identique à 0031, octet pour
--    octet une fois relue en jsonb. Les barbiers, et les téléviseurs
--    allumés qui font tourner le bundle d'hier, ne voient rien changer
--    (tests 12 et 14). Le corps de 0031 est repris tel quel.
--
--    Autres profils : les six clés de 0031 restent présentes, pour que
--    l'écran d'aujourd'hui (TVBoard, avant le lot P5) affiche une file
--    cohérente au lieu de planter sur un champ absent :
--      queue, location, counts   mêmes définitions qu'en walkin (des
--                                nombres, aucune donnée personnelle) ;
--      staff, serving, upcoming  toujours VIDES : ce sont les listes qui
--                                portent des prénoms et des noms de pros ;
--    puis la clé profile et UN bloc propre au métier :
--      vehicle, device  workshop : les quatre colonnes du planning
--                       d'atelier ; immatriculation MASQUÉE en SQL
--                       (internal.mask_registration : 3 derniers
--                       caractères visibles), numéro de dossier, type
--                       d'appareil. Jamais de prénom, de modèle, de
--                       motif, de devis ni de note ;
--      table            tables : « Table prête », numéro et couverts ;
--                       le prénom seulement quand la file ne numérote pas
--                       (c'est alors ce que l'accueil appelle) ;
--      desk             desks : « A-042 → Guichet 3 », appels en cours et
--                       derniers appels. JAMAIS de prénom, quel que soit
--                       ask_client_name : au guichet, on appelle un numéro ;
--      retail           pickup : commandes prêtes (4 derniers caractères du
--                       numéro de commande), appels numérotés au comptoir.
--
--    Ce qui ne part JAMAIS vers un téléviseur, quel que soit le profil :
--    note, notified, client_session_id, details, registration_key,
--    l'immatriculation en clair, le modèle, le motif (service ni texte
--    libre), le devis, les identifiants d'organisation et d'établissement.
--    Le téléviseur est un appareil public : tout ce qu'on lui envoie est
--    lisible par qui ouvre les outils de son navigateur.
--
-- 2. profile_stats(p_location_id, p_from, p_to) : statistiques propres
--    aux métiers ([SEC § 6.7]). Fonction DISTINCTE : location_stats
--    (0019) n'est pas modifiée, les statistiques des barbiers ne bougent
--    pas d'un chiffre.
--
-- Dépendances : 0031 (display_initials, forme walkin), 0033 (colonnes),
-- 0034 (mask_registration, format_ticket_no, événements 'stage',
-- 'quote_sent', 'quote_decision'). Rien de 0021-0030 (chantier Wallet) :
-- les deux plages doivent pouvoir s'appliquer dans n'importe quel ordre
-- (apps/web/tests/migrations-commute.test.ts, scripts/verify-db-order.sh).
--
-- Transaction explicite : migrate.sh exécute chaque fichier hors
-- transaction ; un échec au milieu ne doit rien laisser à moitié.
-- =====================================================================

begin;

-- =====================================================================
-- 1. Écran de salle
-- =====================================================================

-- ---------------------------------------------------------------------
-- Libellé public d'un guichet : desk_label, à défaut le nom de la fiche
-- ([SEC § 15] « Guichet sans desk_label : repli sur display_name »).
-- Limité à l'établissement de la file : un identifiant venu d'ailleurs ne
-- donne rien. Pas de filtre is_active : un appel déjà passé garde le
-- libellé du guichet qui l'a fait, même désactivé depuis.
-- ---------------------------------------------------------------------
create or replace function internal.display_desk_label(p_staff_id uuid, p_location_id uuid)
returns text
language sql
stable
set search_path = public, internal, extensions
as $$
  select coalesce(nullif(trim(s.desk_label), ''), nullif(trim(s.display_name), ''))
  from public.staff s
  where s.id = p_staff_id and s.location_id = p_location_id;
$$;

-- ---------------------------------------------------------------------
-- Fin d'un numéro de commande, pour le tableau « Commandes prêtes » :
-- les 4 derniers caractères alphanumériques, en capitales (« CMD-2026-88731 »
-- donne 8731). Un numéro de commande n'identifie personne sans le système
-- du commerçant ; la fin suffit au client pour s'y reconnaître.
-- ---------------------------------------------------------------------
create or replace function internal.display_order_tail(p_ref text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select nullif(right(upper(regexp_replace(coalesce(p_ref, ''), '[^A-Za-z0-9]', '', 'g')), 4), '');
$$;

-- ---------------------------------------------------------------------
-- Atelier (vehicle, device) : le planning d'atelier en quatre colonnes,
-- les mêmes que le poste du pro (WorkshopColumn, lib/profiles/stages.ts) :
--   intake    received                     « À prendre en charge »
--   workshop  diagnosis, in_repair         « En atelier »
--   waiting   quote_pending, waiting_parts « En attente client / pièce »
--   ready     ready                        « Prêts à récupérer »
-- La colonne « waiting » réunit volontairement le devis et la pièce : sur
-- un écran public, rien ne dit qu'un client a un devis en attente.
--
-- Ligne : id, registration (masquée, ou null), ticketNo (dossier), le type
-- d'appareil (pictogramme, pas le modèle) et since (entrée dans l'étape :
-- « prêt depuis 14:32 »).
--
-- Immatriculation : option tvRegistration de la file. 'masked' (défaut,
-- posé par apply_profile_defaults) donne ••-••3-CD ; 'none' et
-- 'model_only' ne donnent RIEN : le modèle n'est jamais envoyé à un
-- téléviseur (décision du propriétaire, plus stricte que [SEC § 4.2]).
--
-- Bornes : 6 lignes par colonne, 8 pour « Prêts » (la colonne que le
-- client cherche des yeux) ; total donne la colonne entière. « Prêts »
-- met le dernier véhicule prêt en tête (le client qu'on vient de prévenir
-- arrive) ; les autres colonnes suivent l'ordre d'arrivée.
-- ---------------------------------------------------------------------
create or replace function internal.display_workshop(p_queue public.queues, p_day_start timestamptz)
returns jsonb
language sql
stable
set search_path = public, internal, extensions
as $$
  with active as (
    select e.public_id, e.sort_order, e.joined_at, e.id, e.ticket_no,
           coalesce(e.stage_changed_at, e.joined_at) as since,
           -- Plaque : jamais registration_key ni details bruts ; seule la
           -- forme masquée quitte la fonction.
           case when p_queue.profile = 'vehicle'
                     and coalesce(p_queue.profile_options ->> 'tvRegistration', 'masked') = 'masked'
                then internal.mask_registration(coalesce(e.details ->> 'registration', e.registration_key))
           end as registration,
           case when p_queue.profile = 'device'
                     and e.details ->> 'deviceKind' in ('phone', 'tablet', 'computer', 'console', 'watch', 'other')
                then e.details ->> 'deviceKind'
           end as device_kind,
           -- L'étape décide de la colonne ; sans étape connue (cas
           -- défensif), le statut.
           coalesce(
             case e.stage
               when 'received'      then 'intake'
               when 'diagnosis'     then 'workshop'
               when 'in_repair'     then 'workshop'
               when 'quote_pending' then 'waiting'
               when 'waiting_parts' then 'waiting'
               when 'ready'         then 'ready'
             end,
             case when e.status in ('next', 'present') then 'ready'
                  when e.status = 'serving' then 'workshop'
                  else 'intake' end
           ) as col
    from public.queue_entries e
    where e.queue_id = p_queue.id and public.entry_is_active(e.status)
  )
  select jsonb_build_object(
    'columns', (
      select jsonb_agg(jsonb_build_object(
               'key',   k.key,
               'total', (select count(*) from active a where a.col = k.key),
               'items', coalesce((
                 select jsonb_agg(jsonb_build_object(
                          'id',           x.public_id,
                          'registration', x.registration,
                          'ticketNo',     internal.format_ticket_no(p_queue.profile, p_queue.ticket_prefix, x.ticket_no),
                          'deviceKind',   x.device_kind,
                          'since',        x.since
                        ) order by x.rank)
                 from (
                   select a.*,
                          row_number() over (
                            order by case when k.key = 'ready' then a.since end desc nulls last,
                                     a.sort_order, a.joined_at, a.id
                          ) as rank
                   from active a
                   where a.col = k.key
                 ) x
                 where x.rank <= k.lim
               ), '[]'::jsonb)
             ) order by k.ord)
      from (values ('intake', 1, 6), ('workshop', 2, 6), ('waiting', 3, 6), ('ready', 4, 8))
           as k(key, ord, lim)
    ),
    'today', jsonb_build_object(
      'received', (select count(*) from public.queue_entries e
                   where e.queue_id = p_queue.id and e.joined_at >= p_day_start),
      'handedOver', (select count(*) from public.queue_entries e
                     where e.queue_id = p_queue.id and e.status = 'completed'
                       and e.completed_at >= p_day_start)
    )
  );
$$;

-- ---------------------------------------------------------------------
-- Restaurant (table) : « Tables prêtes » et la salle d'attente en chiffres.
--
-- Un groupe est « prêt » quand l'accueil l'a appelé (next), ou quand il a
-- répondu « J'arrive » après l'appel (present avec called_at). Ligne : id,
-- ticketNo, name, partySize (le chiffre qui compte), calledAt (compte à
-- rebours de présentation). L'appel le plus ancien d'abord : c'est le
-- groupe qu'on attend depuis le plus longtemps. 6 lignes au plus.
--
-- Prénom : seulement quand la file ne numérote pas. L'accueil appelle
-- alors les noms à voix haute, et le groupe doit se reconnaître à l'écran
-- (« KARIM · 4 », comme le prénom au comptoir d'un barbier). Dès qu'un
-- numéro existe, il suffit : le prénom ne part plus. En file sensible, les
-- initiales seulement ([SEC § 6.6]).
--
-- counts : groupes et couverts qui attendent, groupes appelés, groupes et
-- couverts installés aujourd'hui. Un groupe sans taille compte pour un
-- couvert, le minimum certain.
-- ---------------------------------------------------------------------
create or replace function internal.display_tables(p_queue public.queues, p_day_start timestamptz)
returns jsonb
language sql
stable
set search_path = public, internal, extensions
as $$
  with e as (
    select x.public_id, x.status, x.called_at, x.completed_at, x.ticket_no, x.client_name,
           -- Lecture défensive : une valeur inattendue ne doit pas faire
           -- échouer l'instantané (un téléviseur resterait figé).
           case when x.details ->> 'partySize' ~ '^[0-9]{1,3}$'
                then (x.details ->> 'partySize')::int end as party_size,
           (x.status = 'next' or (x.status = 'present' and x.called_at is not null)) as is_ready
    from public.queue_entries x
    where x.queue_id = p_queue.id
      and (public.entry_is_active(x.status)
           or (x.status = 'completed' and x.completed_at >= p_day_start))
  ),
  waiting as (
    select * from e
    where e.status in ('waiting', 'notified', 'returning')
       or (e.status = 'present' and e.called_at is null)
  ),
  seated as (
    select * from e where e.status = 'completed'
  )
  select jsonb_build_object(
    'counts', jsonb_build_object(
      'groupsWaiting',     (select count(*) from waiting),
      'coversWaiting',     (select coalesce(sum(coalesce(party_size, 1)), 0) from waiting),
      'groupsCalled',      (select count(*) from e where e.is_ready),
      'groupsSeatedToday', (select count(*) from seated),
      'coversSeatedToday', (select coalesce(sum(coalesce(party_size, 1)), 0) from seated)
    ),
    'ready', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',        r.public_id,
               'ticketNo',  internal.format_ticket_no(p_queue.profile, p_queue.ticket_prefix, r.ticket_no),
               'name',      case
                              when r.ticket_no is not null or coalesce(trim(r.client_name), '') = '' then null
                              when p_queue.profile_options ->> 'sensitive' = 'true'
                                then internal.display_initials(r.client_name)
                              else trim(r.client_name)
                            end,
               'partySize', r.party_size,
               'calledAt',  r.called_at
             ) order by r.rank)
      from (
        select e.*, row_number() over (order by e.called_at nulls last, e.public_id) as rank
        from e where e.is_ready
      ) r
      where r.rank <= 6
    ), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------
-- Guichet (desk) : le tableau d'appel.
--   current  appels en cours (next, ou present après l'appel) : le plus
--            récent d'abord, c'est lui que l'écran met en grand. 6 au plus.
--   recent   derniers appels du jour déjà pris en charge (au guichet ou
--            terminés), le plus récent d'abord. 5 au plus.
-- Ligne : id, ticketNo, deskLabel, calledAt. Aucune clé de nom : ni le
-- prénom du client (même si la file le demande), ni le motif (en santé, il
-- peut révéler une information médicale).
-- ---------------------------------------------------------------------
create or replace function internal.display_desks(p_queue public.queues, p_day_start timestamptz)
returns jsonb
language sql
stable
set search_path = public, internal, extensions
as $$
  with e as (
    select x.public_id, x.status, x.called_at, x.completed_at, x.ticket_no, x.staff_id,
           (x.status = 'next' or (x.status = 'present' and x.called_at is not null)) as is_call
    from public.queue_entries x
    where x.queue_id = p_queue.id
      and (public.entry_is_active(x.status)
           or (x.status = 'completed' and x.completed_at >= p_day_start))
  )
  select jsonb_build_object(
    'counts', jsonb_build_object(
      'waiting', (select count(*) from e
                  where e.status in ('waiting', 'notified', 'returning')
                     or (e.status = 'present' and e.called_at is null)),
      'called',  (select count(*) from e where e.is_call),
      'servedToday', (select count(*) from e where e.status = 'completed')
    ),
    'current', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',        c.public_id,
               'ticketNo',  internal.format_ticket_no(p_queue.profile, p_queue.ticket_prefix, c.ticket_no),
               'deskLabel', internal.display_desk_label(c.staff_id, p_queue.location_id),
               'calledAt',  c.called_at
             ) order by c.rank)
      from (
        select e.*, row_number() over (order by e.called_at desc nulls last, e.public_id) as rank
        from e where e.is_call
      ) c
      where c.rank <= 6
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',        c.public_id,
               'ticketNo',  internal.format_ticket_no(p_queue.profile, p_queue.ticket_prefix, c.ticket_no),
               'deskLabel', internal.display_desk_label(c.staff_id, p_queue.location_id),
               'calledAt',  c.called_at
             ) order by c.rank)
      from (
        select e.*, row_number() over (order by e.called_at desc, e.public_id) as rank
        from e
        where e.status in ('serving', 'completed') and e.called_at >= p_day_start
      ) c
      where c.rank <= 5
    ), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------
-- Boutique (retail) : « Commandes prêtes ».
--   ready  commandes suivies arrivées à l'étape « prête » : fin du numéro
--          de commande (orderTail) ou numéro de ticket, depuis quand. La
--          dernière prête en tête. 8 au plus.
--   calls  clients « conseil » appelés au comptoir, s'ils ont un numéro
--          (sans numéro, il n'y a rien à afficher). 4 au plus.
-- ---------------------------------------------------------------------
create or replace function internal.display_pickup(p_queue public.queues, p_day_start timestamptz)
returns jsonb
language sql
stable
set search_path = public, internal, extensions
as $$
  with e as (
    select x.public_id, x.status, x.stage, x.called_at, x.ticket_no,
           coalesce(x.stage_changed_at, x.joined_at) as since,
           internal.display_order_tail(x.details ->> 'orderRef') as order_tail
    from public.queue_entries x
    where x.queue_id = p_queue.id and public.entry_is_active(x.status)
  )
  select jsonb_build_object(
    'counts', jsonb_build_object(
      'waiting',   (select count(*) from e
                    where e.stage is null
                      and (e.status in ('waiting', 'notified', 'returning')
                           or (e.status = 'present' and e.called_at is null))),
      'preparing', (select count(*) from e where e.stage = 'preparing'),
      'ready',     (select count(*) from e where e.stage = 'ready')
    ),
    'ready', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',        r.public_id,
               'orderTail', r.order_tail,
               'ticketNo',  internal.format_ticket_no(p_queue.profile, p_queue.ticket_prefix, r.ticket_no),
               'since',     r.since
             ) order by r.rank)
      from (
        select e.*, row_number() over (order by e.since desc, e.public_id) as rank
        from e where e.stage = 'ready'
      ) r
      where r.rank <= 8
    ), '[]'::jsonb),
    'calls', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',       c.public_id,
               'ticketNo', internal.format_ticket_no(p_queue.profile, p_queue.ticket_prefix, c.ticket_no),
               'calledAt', c.called_at
             ) order by c.rank)
      from (
        select e.*, row_number() over (order by e.called_at desc nulls last, e.public_id) as rank
        from e
        where e.stage is null and e.ticket_no is not null
          and (e.status = 'next' or (e.status = 'present' and e.called_at is not null))
      ) c
      where c.rank <= 4
    ), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------
-- L'instantané de l'écran de salle, tous profils.
-- ---------------------------------------------------------------------
create or replace function public.display_snapshot(p_queue_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, internal, extensions
as $$
declare
  v_queue     public.queues;
  v_location  public.locations;
  v_head      jsonb;
  v_day_start timestamptz;
begin
  select * into v_queue from public.queues where id = p_queue_id;
  if not found then return null; end if;
  select * into v_location from public.locations where id = v_queue.location_id;

  -- queue, location, counts : repris de 0031 sans changer une virgule.
  v_head := jsonb_build_object(
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
    )
  );

  -- -------------------------------------------------------------------
  -- walkin, event : la forme de 0031, à l'identique (aucune clé profile).
  -- -------------------------------------------------------------------
  if v_queue.profile in ('walkin', 'event') then
    return v_head || jsonb_build_object(
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
          -- s.id départage deux homonymes au même rang (voir 0031).
          select * from public.staff
          where location_id = v_queue.location_id and is_active
          order by sort_order, display_name, id
          limit 6
        ) s
      ), '[]'::jsonb),

      -- Au comptoir : trois volets au plus ; le pro est résolu parmi
      -- l'équipe active (sinon : « En prestation »).
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

      -- À suivre : les appelés d'abord, puis l'attente, dans l'ordre exact
      -- de queue_snapshot. Sept lattes au plus, initiales seulement.
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
  end if;

  -- -------------------------------------------------------------------
  -- Profils métier : listes nominatives vides, clé profile, bloc propre.
  -- -------------------------------------------------------------------
  v_day_start := date_trunc('day', now() at time zone coalesce(v_location.timezone, 'UTC'))
                 at time zone coalesce(v_location.timezone, 'UTC');

  return v_head
    || jsonb_build_object(
         'staff',    '[]'::jsonb,
         'serving',  '[]'::jsonb,
         'upcoming', '[]'::jsonb,
         'profile',  v_queue.profile
       )
    || case v_queue.profile
         when 'vehicle' then jsonb_build_object('workshop', internal.display_workshop(v_queue, v_day_start))
         when 'device'  then jsonb_build_object('workshop', internal.display_workshop(v_queue, v_day_start))
         when 'table'   then jsonb_build_object('tables',   internal.display_tables(v_queue, v_day_start))
         when 'desk'    then jsonb_build_object('desks',    internal.display_desks(v_queue, v_day_start))
         when 'retail'  then jsonb_build_object('pickup',   internal.display_pickup(v_queue, v_day_start))
         else '{}'::jsonb
       end;
end;
$$;

comment on function public.display_snapshot(uuid) is
  'Écran de salle (TV) : uniquement les champs affichés. walkin/event : forme de 0031 à l''identique ; autres profils : clé profile et un bloc (workshop, tables, desks, pickup), immatriculation masquée, jamais de prénom au guichet. Réservée à service_role.';

-- =====================================================================
-- 2. Statistiques par profil
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tickets d'une période qui relèvent d'un profil, pour un établissement.
--
-- Le profil vit sur la file, pas sur le ticket. Une file peut changer de
-- profil (switch_queue_profile, une fois vide) : ses tickets d'avant
-- restent en base. On ne compte donc que les tickets inscrits depuis la
-- dernière entrée de la file dans son profil actuel (audit
-- 'queue.profile_changed') : les passages d'un barbier qui a essayé le
-- poste garage ne deviennent pas des « véhicules déposés ». Une file créée
-- directement dans son profil n'a pas d'entrée d'audit : tout compte.
-- ---------------------------------------------------------------------
create or replace function internal.profile_stats_entries(
  p_location_id uuid,
  p_profile     public.queue_profile,
  p_from        timestamptz,
  p_to          timestamptz
) returns setof public.queue_entries
language sql
stable
set search_path = public, internal, extensions
as $$
  select e.*
  from public.queues q
  cross join lateral (
    select coalesce(max(a.created_at), '-infinity'::timestamptz) as since
    from public.audit_logs a
    where a.action = 'queue.profile_changed'
      and a.organization_id = q.organization_id
      and a.target_type = 'queue' and a.target_id = q.id::text
      and a.metadata ->> 'to' = q.profile::text
  ) s
  join public.queue_entries e on e.queue_id = q.id
  where q.location_id = p_location_id
    and q.profile = p_profile
    and e.location_id = p_location_id
    and e.joined_at >= p_from and e.joined_at < p_to
    and e.joined_at >= s.since;
$$;

-- Pourcentage arrondi au dixième, null sans dénominateur (même forme que
-- completionRate et noShowRate de location_stats).
create or replace function internal.stats_rate(p_part bigint, p_total bigint)
returns numeric
language sql
immutable
set search_path = pg_catalog
as $$
  select case when coalesce(p_total, 0) = 0 then null
              else round(100.0 * coalesce(p_part, 0) / p_total, 1) end;
$$;

-- ---------------------------------------------------------------------
-- Atelier (vehicle, device) : l'argument de vente d'un garage.
--   dropped, handedOver               déposés, rendus au client
--   medianDropToReadySeconds          du dépôt au PREMIER « prêt »
--   medianReadyToPickupSeconds        du DERNIER « prêt » au rendu (le
--                                     véhicule qui encombre le parking)
--   quote.sent/accepted/declined      devis envoyés, décisions du client
--   quote.acceptanceRate              accords / décisions
--   quote.medianDecisionSeconds       du devis à la décision qui y répond
--   medianSecondsByStage              temps passé dans chaque étape
--                                     (intervalles fermés seulement)
--   readyNotCollected24h              prêts depuis plus de 24 h, MAINTENANT
--                                     (indépendant de la période)
--   reachableRate                     tickets avec au moins une livraison
--                                     acceptée par le fournisseur
--   byReason                          motifs (prestations), 10 au plus
--   byDeviceKind                      (device) répartition par appareil
-- ---------------------------------------------------------------------
create or replace function internal.profile_stats_workshop(
  p_location_id uuid,
  p_profile     public.queue_profile,
  p_from        timestamptz,
  p_to          timestamptz
) returns jsonb
language sql
stable
set search_path = public, internal, extensions
as $$
  with base as (
    select * from internal.profile_stats_entries(p_location_id, p_profile, p_from, p_to)
  ),
  ev as (
    select qe.id, qe.entry_id, qe.event_type, qe.payload, qe.created_at
    from public.queue_events qe
    where qe.entry_id in (select id from base)
      and qe.event_type in ('stage', 'quote_sent', 'quote_decision')
  ),
  stages as (
    select ev.entry_id, ev.payload ->> 'to' as stage, ev.created_at,
           lead(ev.created_at) over (partition by ev.entry_id order by ev.created_at, ev.id) as next_at
    from ev
    where ev.event_type = 'stage' and ev.payload ->> 'to' is not null
  ),
  stage_spans as (
    select s.stage,
           extract(epoch from (coalesce(
             s.next_at,
             case when not public.entry_is_active(b.status)
                  then coalesce(b.completed_at, b.cancelled_at, b.expired_at, b.absent_at) end
           ) - s.created_at)) as seconds
    from stages s
    join base b on b.id = s.entry_id
  ),
  ready_times as (
    select s.entry_id, min(s.created_at) as first_ready, max(s.created_at) as last_ready
    from stages s where s.stage = 'ready'
    group by s.entry_id
  ),
  decisions as (
    select d.entry_id, d.payload ->> 'decision' as decision,
           extract(epoch from (d.created_at - (
             select max(q.created_at) from ev q
             where q.entry_id = d.entry_id and q.event_type = 'quote_sent'
               and (q.created_at, q.id) <= (d.created_at, d.id)
           ))) as seconds
    from ev d
    where d.event_type = 'quote_decision'
  )
  select jsonb_build_object(
    'dropped',    (select count(*) from base),
    'handedOver', (select count(*) from base where status = 'completed'),
    'medianDropToReadySeconds', (
      select round(percentile_cont(0.5) within group (order by extract(epoch from (r.first_ready - b.joined_at))))
      from ready_times r join base b on b.id = r.entry_id
      where r.first_ready >= b.joined_at),
    'medianReadyToPickupSeconds', (
      select round(percentile_cont(0.5) within group (order by extract(epoch from (b.completed_at - r.last_ready))))
      from ready_times r join base b on b.id = r.entry_id
      where b.status = 'completed' and b.completed_at >= r.last_ready),
    'quote', jsonb_build_object(
      'sent',     (select count(*) from ev where event_type = 'quote_sent'),
      'accepted', (select count(*) from decisions where decision = 'accepted'),
      'declined', (select count(*) from decisions where decision = 'declined'),
      'acceptanceRate', internal.stats_rate(
        (select count(*) from decisions where decision = 'accepted'),
        (select count(*) from decisions where decision in ('accepted', 'declined'))),
      'medianDecisionSeconds', (
        select round(percentile_cont(0.5) within group (order by seconds))
        from decisions where seconds >= 0)
    ),
    'medianSecondsByStage', coalesce((
      select jsonb_object_agg(t.stage, t.median)
      from (
        select stage, round(percentile_cont(0.5) within group (order by seconds)) as median
        from stage_spans where seconds >= 0
        group by stage
      ) t
    ), '{}'::jsonb),
    'readyNotCollected24h', (
      select count(*)
      from public.queue_entries e
      join public.queues q on q.id = e.queue_id
      where q.location_id = p_location_id and q.profile = p_profile
        and e.stage = 'ready' and e.status in ('next', 'present')
        and e.stage_changed_at < now() - interval '24 hours'),
    'reachableRate', internal.stats_rate(
      (select count(*) from base b
       where exists (select 1 from public.notification_deliveries d
                     where d.queue_entry_id = b.id and d.status = 'sent')),
      (select count(*) from base)),
    'byReason', coalesce((
      select jsonb_agg(jsonb_build_object('serviceId', t.service_id, 'name', t.name, 'count', t.n)
                       order by t.n desc, t.name)
      from (
        select b.service_id, sv.name, count(*) as n
        from base b join public.services sv on sv.id = b.service_id
        group by b.service_id, sv.name
        order by count(*) desc, sv.name
        limit 10
      ) t
    ), '[]'::jsonb)
  )
  || case when p_profile = 'device' then jsonb_build_object(
       'byDeviceKind', coalesce((
         select jsonb_object_agg(k, n)
         from (
           select b.details ->> 'deviceKind' as k, count(*) as n
           from base b
           where b.details ->> 'deviceKind' in ('phone', 'tablet', 'computer', 'console', 'watch', 'other')
           group by 1
         ) t
       ), '{}'::jsonb))
     else '{}'::jsonb end;
$$;

-- ---------------------------------------------------------------------
-- Restaurant (table).
--   groupsSeated, coversSeated     groupes installés et leurs couverts
--   medianWaitByPartySize          attente médiane jusqu'à l'appel, par
--                                  taille (1-2, 3-4, 5-6, 7+), groupes
--                                  installés seulement
--   noShowAfterCallRate            appelés qui ne se sont pas présentés
--                                  (absents ou expirés)
--   byHour                         groupes et couverts inscrits, par heure
--                                  locale
--   reachableRate                  comme en atelier
-- ---------------------------------------------------------------------
create or replace function internal.profile_stats_table(
  p_location_id uuid,
  p_from        timestamptz,
  p_to          timestamptz,
  p_tz          text
) returns jsonb
language sql
stable
set search_path = public, internal, extensions
as $$
  with base as (
    select b.*,
           case when b.details ->> 'partySize' ~ '^[0-9]{1,3}$'
                then (b.details ->> 'partySize')::int end as party_size
    from internal.profile_stats_entries(p_location_id, 'table', p_from, p_to) b
  ),
  seated as (
    select *,
           extract(epoch from (coalesce(called_at, present_at, completed_at) - joined_at)) as wait_seconds,
           case when coalesce(party_size, 1) <= 2 then '1-2'
                when party_size <= 4 then '3-4'
                when party_size <= 6 then '5-6'
                else '7+' end as bucket
    from base where status = 'completed'
  )
  select jsonb_build_object(
    'groupsSeated', (select count(*) from seated),
    'coversSeated', (select coalesce(sum(coalesce(party_size, 1)), 0) from seated),
    'medianWaitByPartySize', (
      select jsonb_agg(jsonb_build_object(
               'size', k.bucket,
               'groups', (select count(*) from seated s where s.bucket = k.bucket),
               'medianWaitSeconds', (
                 select round(percentile_cont(0.5) within group (order by s.wait_seconds))
                 from seated s where s.bucket = k.bucket and s.wait_seconds >= 0)
             ) order by k.ord)
      from (values ('1-2', 1), ('3-4', 2), ('5-6', 3), ('7+', 4)) as k(bucket, ord)
    ),
    'noShowAfterCallRate', internal.stats_rate(
      (select count(*) from base where called_at is not null and status in ('absent', 'expired')),
      (select count(*) from base where called_at is not null)),
    'byHour', coalesce((
      select jsonb_agg(jsonb_build_object('hour', h, 'groups', g, 'covers', c) order by h)
      from (
        select extract(hour from joined_at at time zone p_tz)::int as h,
               count(*) as g,
               sum(coalesce(party_size, 1)) as c
        from base group by 1
      ) t
    ), '[]'::jsonb),
    'reachableRate', internal.stats_rate(
      (select count(*) from base b
       where exists (select 1 from public.notification_deliveries d
                     where d.queue_entry_id = b.id and d.status = 'sent')),
      (select count(*) from base))
  );
$$;

-- ---------------------------------------------------------------------
-- Guichet (desk).
--   medianWaitSeconds    de l'inscription à l'appel
--   medianDeskSeconds    temps au guichet, de la prise en charge (ou de
--                        l'appel) à la fin
--   byDesk               débit par guichet (libellé public du guichet)
--   recalls              rappels envoyés (compteur du journal)
--   absentRate           absents ou expirés, sur tous les tickets
--   reachableRate        comme en atelier
-- ---------------------------------------------------------------------
create or replace function internal.profile_stats_desk(
  p_location_id uuid,
  p_from        timestamptz,
  p_to          timestamptz
) returns jsonb
language sql
stable
set search_path = public, internal, extensions
as $$
  with base as (
    select * from internal.profile_stats_entries(p_location_id, 'desk', p_from, p_to)
  ),
  served as (
    select *,
           coalesce(served_by_staff_id, staff_id) as desk_id,
           extract(epoch from (completed_at - coalesce(service_started_at, called_at, joined_at))) as desk_seconds
    from base where status = 'completed' and completed_at is not null
  )
  select jsonb_build_object(
    'joined',    (select count(*) from base),
    'completed', (select count(*) from served),
    'medianWaitSeconds', (
      select round(percentile_cont(0.5) within group (order by extract(epoch from (called_at - joined_at))))
      from base where called_at is not null and called_at >= joined_at),
    'medianDeskSeconds', (
      select round(percentile_cont(0.5) within group (order by desk_seconds))
      from served where desk_seconds >= 0),
    'byDesk', coalesce((
      select jsonb_agg(jsonb_build_object(
               'staffId', t.desk_id,
               'label', internal.display_desk_label(t.desk_id, p_location_id),
               'served', t.n,
               'medianDeskSeconds', t.median
             ) order by t.n desc, t.desk_id)
      from (
        select desk_id, count(*) as n,
               round(percentile_cont(0.5) within group (order by desk_seconds)
                       filter (where desk_seconds >= 0)) as median
        from served where desk_id is not null
        group by desk_id
      ) t
    ), '[]'::jsonb),
    'recalls', (
      select coalesce(sum(case when notification_status ->> 'recall_count' ~ '^[0-9]+$'
                               then (notification_status ->> 'recall_count')::int else 0 end), 0)
      from base),
    'absentRate', internal.stats_rate(
      (select count(*) from base where status in ('absent', 'expired')),
      (select count(*) from base)),
    'reachableRate', internal.stats_rate(
      (select count(*) from base b
       where exists (select 1 from public.notification_deliveries d
                     where d.queue_entry_id = b.id and d.status = 'sent')),
      (select count(*) from base))
  );
$$;

-- ---------------------------------------------------------------------
-- Boutique (retail).
--   pickups                 commandes suivies (ticket à étape) remises
--   advice                  passages « conseil » (sans étape) terminés
--   medianPreparingSeconds  de l'inscription au premier « commande prête »
--   reachableRate           comme en atelier
-- ---------------------------------------------------------------------
create or replace function internal.profile_stats_retail(
  p_location_id uuid,
  p_from        timestamptz,
  p_to          timestamptz
) returns jsonb
language sql
stable
set search_path = public, internal, extensions
as $$
  with base as (
    select * from internal.profile_stats_entries(p_location_id, 'retail', p_from, p_to)
  ),
  first_ready as (
    select qe.entry_id, min(qe.created_at) as at
    from public.queue_events qe
    where qe.entry_id in (select id from base)
      and qe.event_type = 'stage' and qe.payload ->> 'to' = 'ready'
    group by qe.entry_id
  )
  select jsonb_build_object(
    'pickups', (select count(*) from base where status = 'completed' and stage is not null),
    'advice',  (select count(*) from base where status = 'completed' and stage is null),
    'medianPreparingSeconds', (
      select round(percentile_cont(0.5) within group (order by extract(epoch from (r.at - b.joined_at))))
      from first_ready r join base b on b.id = r.entry_id
      where r.at >= b.joined_at),
    'reachableRate', internal.stats_rate(
      (select count(*) from base b
       where exists (select 1 from public.notification_deliveries d
                     where d.queue_entry_id = b.id and d.status = 'sent')),
      (select count(*) from base))
  );
$$;

-- ---------------------------------------------------------------------
-- Point d'entrée : un bloc par profil métier présent dans
-- l'établissement (walkin et event exclus : location_stats les couvre
-- déjà). Même période par défaut que location_stats.
--
--   { range: {from, to}, byProfile: { vehicle: {...}, table: {...} } }
--
-- Aucune donnée personnelle : des comptes, des durées, des libellés de
-- prestation et de guichet. Réservée à service_role : l'action serveur
-- vérifie l'appartenance à l'organisation avant de l'appeler.
-- ---------------------------------------------------------------------
create or replace function public.profile_stats(
  p_location_id uuid,
  p_from        timestamptz default (now() - interval '30 days'),
  p_to          timestamptz default now()
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, internal, extensions
as $$
declare
  v_tz      text;
  v_profile public.queue_profile;
  v_out     jsonb := '{}'::jsonb;
begin
  select coalesce(l.timezone, 'Europe/Paris') into v_tz
  from public.locations l where l.id = p_location_id;
  if not found then
    return null;
  end if;

  for v_profile in
    select distinct q.profile from public.queues q
    where q.location_id = p_location_id and q.profile not in ('walkin', 'event')
    order by q.profile
  loop
    v_out := v_out || jsonb_build_object(v_profile::text, case v_profile
      when 'vehicle' then internal.profile_stats_workshop(p_location_id, v_profile, p_from, p_to)
      when 'device'  then internal.profile_stats_workshop(p_location_id, v_profile, p_from, p_to)
      when 'table'   then internal.profile_stats_table(p_location_id, p_from, p_to, v_tz)
      when 'desk'    then internal.profile_stats_desk(p_location_id, p_from, p_to)
      when 'retail'  then internal.profile_stats_retail(p_location_id, p_from, p_to)
    end);
  end loop;

  return jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to),
    'byProfile', v_out
  );
end;
$$;

comment on function public.profile_stats(uuid, timestamptz, timestamptz) is
  'Statistiques propres aux profils métier (atelier, table, guichet, boutique) d''un établissement. location_stats reste celle des barbiers, inchangée. Réservée à service_role.';

-- =====================================================================
-- 3. Droits (motif de 0010)
-- =====================================================================
-- Les deux points d'entrée : service_role seulement. Le téléviseur passe
-- par /api/tv/snapshot (cookie d'appairage vérifié côté serveur), le poste
-- par une action serveur qui revérifie l'accès. Les fonctions internes ne
-- sont exécutables par personne d'autre que leur propriétaire (appelées
-- depuis les fonctions security definer ci-dessus).
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.display_snapshot(uuid)',
    'public.profile_stats(uuid,timestamptz,timestamptz)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;

  foreach fn in array array[
    'internal.display_desk_label(uuid,uuid)',
    'internal.display_order_tail(text)',
    'internal.display_workshop(public.queues,timestamptz)',
    'internal.display_tables(public.queues,timestamptz)',
    'internal.display_desks(public.queues,timestamptz)',
    'internal.display_pickup(public.queues,timestamptz)',
    'internal.profile_stats_entries(uuid,public.queue_profile,timestamptz,timestamptz)',
    'internal.stats_rate(bigint,bigint)',
    'internal.profile_stats_workshop(uuid,public.queue_profile,timestamptz,timestamptz)',
    'internal.profile_stats_table(uuid,timestamptz,timestamptz,text)',
    'internal.profile_stats_desk(uuid,timestamptz,timestamptz)',
    'internal.profile_stats_retail(uuid,timestamptz,timestamptz)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
  end loop;
end
$$;

notify pgrst, 'reload schema';

commit;
