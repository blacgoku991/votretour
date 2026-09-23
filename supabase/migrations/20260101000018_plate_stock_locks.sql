-- =====================================================================
-- Stock de plaques : ordre des verrous et comptes calculés en base
-- =====================================================================
--
-- 1. Ordre des verrous. Supprimer une plaque (super-admin, libération,
--    suppression en cascade d'une société) verrouille la ligne plates,
--    puis le déclencheur plates_return_to_stock met à jour plate_stock.
--    La réattribution faisait l'inverse : plate_stock d'abord, puis la
--    suppression de la plaque. Deux opérations simultanées sur la même
--    plaque s'interbloquaient, et PostgreSQL annulait l'une d'elles.
--    Désormais, partout : plates, puis plate_stock, puis slug_registry.
--
-- 2. Comptes. PostgREST plafonne chaque réponse (max-rows, 1000 en
--    production) : compter les plaques en rapatriant les lignes donnait
--    des chiffres faux sans le moindre avertissement dès 1000 liens.
--    plate_stock_summary compte en base et renvoie un seul objet.
-- =====================================================================

create or replace function public.assign_stock_plate(
  p_code        text,
  p_location_id uuid,
  p_queue_id    uuid default null,
  p_staff_id    uuid default null,
  p_label       text default null,
  p_assigned_by uuid default null,
  p_reassign    boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_code     text := lower(trim(p_code));
  v_locked   uuid;
  v_stock    public.plate_stock;
  v_batch    public.plate_batches;
  v_location public.locations;
  v_queue    uuid := p_queue_id;
  v_plate_id uuid := extensions.gen_random_uuid();
  v_prev_org uuid;
  v_label    text;
begin
  -- La plaque en service d'abord, la ligne de stock ensuite : le même
  -- ordre qu'une suppression de plaque et son déclencheur.
  select plate_id into v_locked from public.plate_stock where code = v_code;
  if v_locked is not null then
    perform 1 from public.plates where id = v_locked for update;
  end if;

  select * into v_stock
  from public.plate_stock
  where code = v_code
  for update;

  if not found then
    raise exception 'Plaque de stock introuvable' using errcode = 'VT011';
  end if;

  -- Entre la lecture sans verrou et le verrou, une autre session a mis
  -- une AUTRE plaque en service sur ce lien : on ne la tient pas, on ne
  -- la supprime pas. (Si la plaque a été libérée entre-temps, plate_id
  -- est vide et l'attribution se poursuit normalement.)
  if v_stock.plate_id is not null and v_stock.plate_id is distinct from v_locked then
    raise exception 'La plaque vient de changer, réessayez' using errcode = 'VT013';
  end if;

  if v_stock.status = 'void' then
    raise exception 'Cette plaque est mise au rebut' using errcode = 'VT013';
  end if;

  -- Contrôles de cohérence AVANT toute suppression : une réattribution
  -- vers une cible invalide ne doit pas détacher la plaque au passage.
  select * into v_location from public.locations where id = p_location_id;
  if not found then
    raise exception 'Établissement introuvable' using errcode = 'VT005';
  end if;

  if v_queue is not null then
    perform 1 from public.queues where id = v_queue and location_id = p_location_id;
    if not found then
      raise exception 'Cette file n''appartient pas à l''établissement choisi' using errcode = 'VT005';
    end if;
  else
    select id into v_queue from public.queues
    where location_id = p_location_id
    order by is_default desc, created_at
    limit 1;
  end if;

  if p_staff_id is not null then
    perform 1 from public.staff where id = p_staff_id and location_id = p_location_id;
    if not found then
      raise exception 'Ce professionnel n''appartient pas à l''établissement choisi' using errcode = 'VT005';
    end if;
  end if;

  if v_stock.status = 'assigned' then
    if not coalesce(p_reassign, false) then
      raise exception 'Cette plaque est déjà attribuée' using errcode = 'VT013';
    end if;
    select organization_id into v_prev_org from public.plates where id = v_stock.plate_id;
    -- Le déclencheur plates_return_to_stock remet la plaque au stock et
    -- rend le lien au registre sous le genre « stock ».
    delete from public.plates where id = v_stock.plate_id;
    select * into v_stock from public.plate_stock where id = v_stock.id;
  end if;

  select * into v_batch from public.plate_batches where id = v_stock.batch_id;
  v_label := left(coalesce(nullif(trim(p_label), ''), 'Plaque n° ' || v_stock.serial), 60);

  update public.slug_registry
     set kind = 'plate',
         organization_id = v_location.organization_id,
         ref_id = v_plate_id
   where slug = v_stock.code;

  insert into public.plates (
    id, organization_id, location_id, queue_id, staff_id, code, label, kind, created_by
  ) values (
    v_plate_id, v_location.organization_id, p_location_id, v_queue, p_staff_id,
    v_stock.code, v_label, v_batch.kind, p_assigned_by
  );

  update public.plate_stock
     set status = 'assigned',
         plate_id = v_plate_id,
         assigned_at = now(),
         assigned_by = p_assigned_by
   where id = v_stock.id;

  return jsonb_build_object(
    'plateId', v_plate_id,
    'code', v_stock.code,
    'serial', v_stock.serial,
    'organizationId', v_location.organization_id,
    'locationId', p_location_id,
    'previousOrganizationId', v_prev_org
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Comptes du stock, calculés en base
-- ---------------------------------------------------------------------
-- Totaux de la plateforme, et détail pour les lots demandés (ceux que
-- la page affiche). Un seul objet jsonb : max-rows ne s'y applique pas.
create or replace function public.plate_stock_summary(p_batch_ids uuid[] default '{}')
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'totals', (
      select jsonb_build_object(
        'available', count(*) filter (where status = 'available'),
        'assigned',  count(*) filter (where status = 'assigned'),
        'void',      count(*) filter (where status = 'void')
      )
      from public.plate_stock
    ),
    'batches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'batchId',   per_batch.batch_id,
        'available', per_batch.available,
        'assigned',  per_batch.assigned,
        'void',      per_batch.voided
      ))
      from (
        select batch_id,
               count(*) filter (where status = 'available') as available,
               count(*) filter (where status = 'assigned')  as assigned,
               count(*) filter (where status = 'void')      as voided
        from public.plate_stock
        where batch_id = any (coalesce(p_batch_ids, '{}'))
        group by batch_id
      ) per_batch
    ), '[]'::jsonb)
  );
$$;

revoke all on function public.plate_stock_summary(uuid[]) from public, anon, authenticated;
grant execute on function public.plate_stock_summary(uuid[]) to service_role;
