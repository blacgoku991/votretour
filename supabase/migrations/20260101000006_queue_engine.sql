-- =====================================================================
-- VotreTour — 0006 : le moteur de file
-- ---------------------------------------------------------------------
-- Tout ce qui fait avancer la file vit ici, dans PostgreSQL :
--   * machine à états explicite (transitions autorisées)
--   * calcul transactionnel des positions ("N personnes devant vous")
--   * verrou sur la file : deux employés qui cliquent TERMINER en même
--     temps ne peuvent pas promouvoir deux fois le même client
--   * réclamation atomique des notifications (jamais de doublon)
-- La couche TypeScript orchestre (auth, quotas, push, temps réel) mais
-- ne recalcule jamais une position elle-même.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Machine à états
-- ---------------------------------------------------------------------
create or replace function internal.allowed_transition(
  p_from public.entry_status,
  p_to   public.entry_status
) returns boolean
language sql
immutable
as $$
  select case p_from
    when 'waiting'   then p_to in ('notified','returning','present','next','serving','absent','skipped','cancelled','expired','completed')
    when 'notified'  then p_to in ('returning','present','next','serving','absent','skipped','cancelled','expired','completed','waiting')
    when 'returning' then p_to in ('present','next','serving','absent','skipped','cancelled','expired','completed','waiting','notified')
    when 'present'   then p_to in ('next','serving','absent','skipped','cancelled','completed','expired','waiting')
    when 'next'      then p_to in ('serving','present','returning','absent','skipped','cancelled','completed','waiting')
    when 'serving'   then p_to in ('completed','absent','skipped','cancelled','present','waiting')
    -- Retour en file possible : "remettre plus tard", annulation d'erreur.
    when 'absent'    then p_to in ('waiting','notified','returning','present','next','serving','skipped','cancelled','expired')
    when 'skipped'   then p_to in ('waiting','notified','returning','present','next','serving','absent','cancelled','expired')
    when 'cancelled' then p_to in ('waiting')
    when 'expired'   then p_to in ('waiting')
    when 'completed' then p_to in ('waiting')  -- annulation d'un TERMINER par erreur
    else false
  end;
$$;

-- Applique les horodatages liés à un état cible.
create or replace function internal.stamp_status(
  p_entry public.queue_entries,
  p_to    public.entry_status
) returns public.queue_entries
language plpgsql
volatile
as $$
declare
  e public.queue_entries := p_entry;
  v_now timestamptz := now();
begin
  e.status := p_to;
  case p_to
    when 'notified'  then e.called_at := coalesce(e.called_at, v_now);
    when 'returning' then e.returning_at := v_now;
    when 'present'   then e.present_at := v_now;
    when 'next'      then e.called_at := v_now;
    when 'serving'   then e.service_started_at := coalesce(e.service_started_at, v_now);
                          e.called_at := coalesce(e.called_at, v_now);
    when 'completed' then e.completed_at := v_now;
    when 'cancelled' then e.cancelled_at := v_now;
    when 'absent'    then e.absent_at := v_now;
    when 'expired'   then e.expired_at := v_now;
    when 'waiting'   then
      -- Retour en file : on repart proprement.
      e.completed_at := null;
      e.cancelled_at := null;
      e.expired_at := null;
    else null;
  end case;
  return e;
end;
$$;

-- ---------------------------------------------------------------------
-- Ordre dans la file
-- ---------------------------------------------------------------------
create or replace function internal.next_sort_order(p_queue_id uuid)
returns double precision
language sql
stable
as $$
  select coalesce(max(sort_order), 0) + 1000
  from public.queue_entries
  where queue_id = p_queue_id
    and public.entry_is_active(status);
$$;

-- Ordre d'affichage canonique : en prestation d'abord, puis appelés,
-- puis le reste par sort_order.
create or replace function internal.status_rank(p_status public.entry_status)
returns int
language sql
immutable
as $$
  select case p_status when 'serving' then 0 when 'next' then 1 else 2 end;
$$;

-- ---------------------------------------------------------------------
-- Recalcul des positions
-- ---------------------------------------------------------------------
-- En mode 'per_staff' chaque professionnel a sa propre numérotation ;
-- en mode 'shared' toute la file partage un seul décompte.
create or replace function public.recompute_queue_positions(p_queue_id uuid)
returns table (
  entry_id       uuid,
  entry_public_id text,
  status         public.entry_status,
  staff_id       uuid,
  previous_ahead int,
  people_ahead   int,
  changed        boolean
)
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
begin
  return query
  with ranked as (
    select
      e.id,
      e.public_id,
      e.status,
      e.staff_id,
      e.people_ahead as previous,
      case
        when e.status = 'serving' then 0
        else (row_number() over (
                partition by case when q.mode = 'per_staff'
                                  then coalesce(e.staff_id::text, '~unassigned')
                                  else '~shared' end
                order by internal.status_rank(e.status), e.sort_order, e.joined_at, e.id
              ) - 1)::int
      end as computed
    from public.queue_entries e
    join public.queues q on q.id = e.queue_id
    where e.queue_id = p_queue_id
      and public.entry_is_active(e.status)
  ),
  updated as (
    update public.queue_entries t
       set people_ahead = r.computed,
           last_position_change_at = now()
      from ranked r
     where t.id = r.id
       and t.people_ahead is distinct from r.computed
    returning t.id
  )
  select r.id, r.public_id, r.status, r.staff_id, r.previous, r.computed,
         exists (select 1 from updated u where u.id = r.id)
  from ranked r
  order by r.computed, r.id;
end;
$$;

-- ---------------------------------------------------------------------
-- Journal des notifications déjà émises
-- ---------------------------------------------------------------------
-- Ordre d'urgence : ahead_two < ahead_one < your_turn. Quand on émet une
-- notification, on marque aussi les moins urgentes comme "dépassées" afin
-- de ne jamais envoyer "plus que 2 personnes" après "c'est votre tour".
create or replace function internal.notification_rank(p_kind text)
returns int
language sql
immutable
as $$
  select case p_kind when 'ahead_two' then 1 when 'ahead_one' then 2 when 'your_turn' then 3 else 0 end;
$$;

create or replace function internal.notification_ledger(
  p_current jsonb,
  p_kind    text,
  p_mark    text default null
) returns jsonb
language plpgsql
volatile
as $$
declare
  v_result jsonb := coalesce(p_current, '{}'::jsonb);
  v_rank   int := internal.notification_rank(p_kind);
  k        text;
begin
  foreach k in array array['ahead_two', 'ahead_one', 'your_turn'] loop
    if internal.notification_rank(k) <= v_rank and not (v_result ? k) then
      v_result := v_result || jsonb_build_object(
        k,
        case when k = p_kind then coalesce(p_mark, to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'))
             else 'superseded' end
      );
    end if;
  end loop;
  return v_result;
end;
$$;

-- Au moment où le client rejoint, il voit déjà sa position à l'écran :
-- inutile de lui pousser "plus que 2 personnes" dans la seconde. On
-- neutralise donc les paliers déjà atteints à l'inscription.
create or replace function internal.seed_notification_baseline(p_entry_id uuid)
returns void
language plpgsql
as $$
declare
  v_status public.entry_status;
  v_ahead  int;
  v_thresh int;
  v_kind   text;
begin
  select e.status, e.people_ahead, q.notify_ahead_threshold
    into v_status, v_ahead, v_thresh
  from public.queue_entries e
  join public.queues q on q.id = e.queue_id
  where e.id = p_entry_id;

  if not found then return; end if;

  v_kind := case
    when v_status in ('serving', 'next') or v_ahead = 0 then 'your_turn'
    when v_ahead = 1 then 'ahead_one'
    when v_ahead <= v_thresh then 'ahead_two'
    else null
  end;

  if v_kind is not null then
    update public.queue_entries
       set notification_status = internal.notification_ledger(notification_status, v_kind, 'at_join')
     where id = p_entry_id;
  end if;
end;
$$;

-- Réclame, de façon atomique, les notifications qui restent à envoyer.
-- Chaque ligne retournée est garantie unique : deux appels concurrents ne
-- peuvent pas produire deux fois la même notification.
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
      case
        when e.status in ('serving', 'next') or e.people_ahead = 0 then 'your_turn'
        when e.people_ahead = 1 then 'ahead_one'
        when e.people_ahead <= q.notify_ahead_threshold then 'ahead_two'
        else null
      end as kind_text
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

-- Réclame une notification ponctuelle sur un ticket donné (fin de
-- passage, retrait…). Retourne false si elle a déjà été émise.
create or replace function public.claim_entry_notification(
  p_entry_id uuid,
  p_kind     public.notification_kind
) returns boolean
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_updated int;
begin
  update public.queue_entries
     set notification_status = notification_status
       || jsonb_build_object(p_kind::text, to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSOF'))
   where id = p_entry_id
     and not (notification_status ? p_kind::text);
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;
