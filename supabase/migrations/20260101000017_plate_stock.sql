-- =====================================================================
-- Rangvia — 0017 : stock de plaques fournisseur
-- =====================================================================
--
-- Le besoin : générer d'un coup N liens (100 par exemple), les envoyer
-- au fabricant qui grave les puces NFC et imprime les QR, puis — une
-- fois les plaques livrées — attribuer chacune à une société depuis le
-- super-admin. Plus tard, une plaque peut changer de société : le lien
-- imprimé, lui, ne change jamais.
--
-- D'où trois règles, qui dictent tout ce fichier :
--
--   1. Un lien de stock est RÉSERVÉ dès sa génération dans le registre
--      des liens publics. Aucun établissement créé plus tard ne peut
--      prendre ce nom par hasard : il appartient déjà à une plaque
--      physique en cours de fabrication.
--
--   2. Un lien de stock n'est JAMAIS libéré. Supprimer ou réattribuer
--      la plaque le renvoie au stock ; il ne disparaît pas du registre.
--      Sans cela, la plaque vissée sur un comptoir tomberait en 404, et
--      son lien pourrait être repris par quelqu'un d'autre.
--
--   3. Un lien de stock n'est pas devinable : 10 caractères tirés au
--      hasard (50 bits). Personne ne peut énumérer les plaques d'un lot.

-- ---------------------------------------------------------------------
-- Registre des liens : un troisième genre, « stock », sans société
-- ---------------------------------------------------------------------
alter table public.slug_registry
  drop constraint slug_registry_kind_check;
alter table public.slug_registry
  add constraint slug_registry_kind_check
  check (kind in ('location', 'plate', 'stock'));

alter table public.slug_registry
  alter column organization_id drop not null;

-- Un lien de stock n'appartient à personne ; tout autre lien appartient
-- à une société. Les deux cas ne se mélangent jamais.
alter table public.slug_registry
  add constraint slug_registry_owner_check
  check ((kind = 'stock') = (organization_id is null));

-- ---------------------------------------------------------------------
-- Lots commandés au fournisseur
-- ---------------------------------------------------------------------
create table public.plate_batches (
  id            uuid primary key default extensions.gen_random_uuid(),
  label         text not null check (length(trim(label)) between 1 and 80),
  quantity      int  not null check (quantity between 1 and 1000),
  kind          public.plate_kind not null default 'both',
  supplier_note text check (supplier_note is null or length(supplier_note) <= 500),
  created_by    uuid references public.profiles (id) on delete set null,
  created_at    timestamptz not null default now()
);

comment on table public.plate_batches is
  'Lot de liens de plaques générés pour un fabricant, avant toute attribution.';

-- ---------------------------------------------------------------------
-- Plaques en stock
-- ---------------------------------------------------------------------
create table public.plate_stock (
  id          uuid primary key default extensions.gen_random_uuid(),
  -- Numéro lisible, croissant sur toute la plateforme : « plaque n° 42 »
  -- se dit au téléphone et s'imprime en petit au dos de la plaque.
  serial      bigint generated always as identity unique,
  code        text not null unique
              references public.slug_registry (slug) on delete restrict
              deferrable initially deferred,
  batch_id    uuid not null references public.plate_batches (id) on delete restrict,
  status      text not null default 'available'
              check (status in ('available', 'assigned', 'void')),
  plate_id    uuid unique references public.plates (id) on delete set null,
  assigned_at timestamptz,
  assigned_by uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  -- Attribuée si et seulement si une plaque réelle la porte.
  constraint plate_stock_assignment_check
    check ((status = 'assigned') = (plate_id is not null))
);

create index plate_stock_batch_idx on public.plate_stock (batch_id, serial);
create index plate_stock_status_idx on public.plate_stock (status);

comment on table public.plate_stock is
  'Liens de plaques pré-générés. Le code est réservé dans slug_registry dès la génération et ne l''est jamais plus libéré.';

-- ---------------------------------------------------------------------
-- Génération d'un code : rv-xxxxx-xxxxx
-- ---------------------------------------------------------------------
-- Alphabet de Crockford en minuscules : ni i, ni l, ni o, ni u — les
-- lettres qu'on confond avec 1, 0 ou V quand on recopie un code gravé.
-- 256 est un multiple de 32 : le modulo ne biaise aucun caractère.
create or replace function internal.generate_stock_code()
returns text
language plpgsql
volatile
set search_path = public, internal, extensions
as $$
declare
  v_alphabet constant text := '0123456789abcdefghjkmnpqrstvwxyz';
  v_bytes bytea := extensions.gen_random_bytes(10);
  v_out   text := '';
  i       int;
begin
  for i in 0..9 loop
    v_out := v_out || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    if i = 4 then
      v_out := v_out || '-';
    end if;
  end loop;
  return 'rv-' || v_out;
end;
$$;

-- ---------------------------------------------------------------------
-- Création d'un lot
-- ---------------------------------------------------------------------
create or replace function public.create_plate_batch(
  p_label      text,
  p_quantity   int,
  p_kind       public.plate_kind default 'both',
  p_note       text default null,
  p_created_by uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_batch    public.plate_batches;
  v_id       uuid;
  v_code     text;
  v_made     int := 0;
  v_attempts int := 0;
begin
  if p_quantity is null or p_quantity < 1 or p_quantity > 1000 then
    raise exception 'Quantité hors limites (1 à 1000)' using errcode = 'VT014';
  end if;

  insert into public.plate_batches (label, quantity, kind, supplier_note, created_by)
  values (trim(p_label), p_quantity, p_kind, nullif(trim(p_note), ''), p_created_by)
  returning * into v_batch;

  while v_made < p_quantity loop
    v_attempts := v_attempts + 1;
    -- Filet de sécurité : 50 bits d'entropie rendent une collision
    -- quasi impossible, mais une boucle sans borne n'est jamais permise.
    if v_attempts > p_quantity * 5 + 20 then
      raise exception 'Génération des codes impossible';
    end if;

    v_id := extensions.gen_random_uuid();
    v_code := internal.generate_stock_code();

    begin
      insert into public.slug_registry (slug, kind, organization_id, ref_id)
      values (v_code, 'stock', null, v_id);
    exception when unique_violation then
      continue;
    end;

    insert into public.plate_stock (id, code, batch_id)
    values (v_id, v_code, v_batch.id);
    v_made := v_made + 1;
  end loop;

  return jsonb_build_object(
    'id', v_batch.id,
    'label', v_batch.label,
    'quantity', v_made
  );
end;
$$;

-- ---------------------------------------------------------------------
-- Attribution (et réattribution) d'une plaque de stock
-- ---------------------------------------------------------------------
-- Tout se passe dans une seule transaction, verrou pris sur la ligne de
-- stock : deux administrateurs qui attribuent la même plaque au même
-- moment ne peuvent pas créer deux plaques.
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
  v_stock    public.plate_stock;
  v_batch    public.plate_batches;
  v_location public.locations;
  v_queue    uuid := p_queue_id;
  v_plate_id uuid := extensions.gen_random_uuid();
  v_prev_org uuid;
  v_label    text;
begin
  select * into v_stock
  from public.plate_stock
  where code = lower(trim(p_code))
  for update;

  if not found then
    raise exception 'Plaque de stock introuvable' using errcode = 'VT011';
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
-- Mise au rebut d'une plaque perdue ou défectueuse (et l'inverse)
-- ---------------------------------------------------------------------
-- Seule une plaque disponible peut partir au rebut : une plaque en
-- service se libère d'abord. Le lien reste réservé, pour toujours.
create or replace function public.set_stock_plate_void(
  p_code text,
  p_void boolean
) returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_stock public.plate_stock;
begin
  update public.plate_stock
     set status = case when p_void then 'void' else 'available' end
   where code = lower(trim(p_code))
     and status = case when p_void then 'available' else 'void' end
  returning * into v_stock;

  if not found then
    raise exception 'Cette plaque ne peut pas changer d''état' using errcode = 'VT013';
  end if;

  return jsonb_build_object('code', v_stock.code, 'serial', v_stock.serial, 'status', v_stock.status);
end;
$$;

-- ---------------------------------------------------------------------
-- Une plaque de stock supprimée retourne au stock
-- ---------------------------------------------------------------------
-- C'est la règle 2. Le déclencheur s'exécute AVANT la suppression : il
-- rend le lien au registre sous le genre « stock » avant que quiconque
-- — l'action de suppression du super-admin, ou la suppression en
-- cascade d'une société — ne puisse effacer l'entrée « plate » du
-- registre. Pour une plaque qui ne vient pas du stock, il ne fait rien.
create or replace function internal.return_plate_to_stock()
returns trigger
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_stock_id uuid;
begin
  update public.plate_stock
     set status = 'available',
         plate_id = null,
         assigned_at = null,
         assigned_by = null
   where plate_id = old.id
  returning id into v_stock_id;

  if v_stock_id is not null then
    update public.slug_registry
       set kind = 'stock',
           organization_id = null,
           ref_id = v_stock_id
     where slug = old.code;
  end if;

  return old;
end;
$$;

create trigger plates_return_to_stock
  before delete on public.plates
  for each row execute function internal.return_plate_to_stock();

-- ---------------------------------------------------------------------
-- Droits : réservé au serveur applicatif
-- ---------------------------------------------------------------------
-- Le super-admin lit et écrit ces tables par le serveur, après
-- assertPlatformAdmin(). Aucun navigateur n'y accède directement.
alter table public.plate_batches enable row level security;
alter table public.plate_stock enable row level security;

revoke all on public.plate_batches from anon, authenticated;
revoke all on public.plate_stock from anon, authenticated;
grant all on public.plate_batches to service_role;
grant all on public.plate_stock to service_role;

revoke all on function internal.generate_stock_code() from public, anon, authenticated;
revoke all on function public.create_plate_batch(text, int, public.plate_kind, text, uuid)
  from public, anon, authenticated;
revoke all on function public.assign_stock_plate(text, uuid, uuid, uuid, text, uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.set_stock_plate_void(text, boolean)
  from public, anon, authenticated;

grant execute on function public.create_plate_batch(text, int, public.plate_kind, text, uuid)
  to service_role;
grant execute on function public.assign_stock_plate(text, uuid, uuid, uuid, text, uuid, boolean)
  to service_role;
grant execute on function public.set_stock_plate_void(text, boolean)
  to service_role;
