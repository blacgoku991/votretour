-- =====================================================================
-- VotreTour — 0013 : programmation des tags NFC depuis le produit
-- =====================================================================
--
-- L'établissement programme lui-même ses tags NFC, depuis le navigateur,
-- via l'API Web NFC. On garde la trace de ce qui a été écrit : quand,
-- par qui, sur quel tag physique, et si le tag a été verrouillé.
--
-- Pourquoi enregistrer le numéro de série : un commerce peut avoir
-- plusieurs plaques identiques sur le comptoir. Le numéro de série lu
-- sur le tag au moment de la relecture de contrôle permet de savoir
-- lequel porte quelle URL, sans avoir à les décoller pour vérifier.

alter table public.plates
  add column programmed_at    timestamptz,
  add column programmed_by    uuid references public.profiles (id) on delete set null,
  add column programmed_count int not null default 0 check (programmed_count >= 0),
  add column nfc_serial       text check (length(nfc_serial) <= 64),
  -- Un tag verrouillé est définitivement en lecture seule. On ne
  -- l'affiche jamais comme reprogrammable.
  add column nfc_locked_at    timestamptz;

comment on column public.plates.programmed_at is
  'Dernière écriture NFC réussie, confirmée par une relecture du tag.';
comment on column public.plates.nfc_serial is
  'Numéro de série du tag physique, lu lors de la relecture de contrôle.';
comment on column public.plates.nfc_locked_at is
  'Tag passé en lecture seule définitive (makeReadOnly). Irréversible.';

-- ---------------------------------------------------------------------
-- Journal des écritures
-- ---------------------------------------------------------------------
-- Une plaque peut être reprogrammée : tag remplacé, tag abîmé, plaque
-- déplacée d'un comptoir à l'autre. Le journal garde l'historique, ce
-- que la colonne programmed_at seule ne permet pas.
create table public.plate_writes (
  id              uuid primary key default extensions.gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  plate_id        uuid not null references public.plates (id) on delete cascade,
  written_by      uuid references public.profiles (id) on delete set null,
  written_url     text not null check (length(written_url) between 1 and 2048),
  nfc_serial      text check (length(nfc_serial) <= 64),
  locked          boolean not null default false,
  -- Vrai quand la relecture de contrôle a bien retrouvé l'URL écrite.
  verified        boolean not null default false,
  -- clock_timestamp() et non now() : now() est figé sur le début de la
  -- transaction, si bien que deux écritures enregistrées coup sur coup
  -- porteraient le même horodatage et le journal n'aurait plus d'ordre.
  -- Ici on note l'instant réel de l'écriture du tag.
  created_at      timestamptz not null default clock_timestamp()
);
create index plate_writes_plate_idx on public.plate_writes (plate_id, created_at desc);
create index plate_writes_org_idx on public.plate_writes (organization_id, created_at desc);

comment on table public.plate_writes is
  'Historique des programmations NFC. Une ligne par écriture confirmée.';

-- ---------------------------------------------------------------------
-- Enregistrement d'une programmation
-- ---------------------------------------------------------------------
-- Appelée par le serveur applicatif après une écriture NFC réussie et
-- relue. La fonction refuse d'enregistrer une écriture pour une plaque
-- qui n'appartient pas à l'organisation passée : le serveur a déjà
-- vérifié les droits, ceci est la ceinture de sécurité côté base.
create or replace function public.record_plate_write(
  p_organization_id uuid,
  p_plate_id        uuid,
  p_written_by      uuid,
  p_written_url     text,
  p_nfc_serial      text default null,
  p_locked          boolean default false,
  p_verified        boolean default false
) returns public.plates
language plpgsql
security definer
set search_path = public, internal, extensions
as $$
declare
  v_plate public.plates;
begin
  select * into v_plate
  from public.plates
  where id = p_plate_id and organization_id = p_organization_id
  for update;

  if not found then
    raise exception 'Plaque introuvable dans cette organisation'
      using errcode = 'VT011';
  end if;

  if v_plate.nfc_locked_at is not null then
    raise exception 'Ce tag a été verrouillé : il ne peut plus être réécrit'
      using errcode = 'VT012';
  end if;

  insert into public.plate_writes (
    organization_id, plate_id, written_by, written_url, nfc_serial, locked, verified
  ) values (
    p_organization_id, p_plate_id, p_written_by, p_written_url,
    nullif(trim(p_nfc_serial), ''), coalesce(p_locked, false), coalesce(p_verified, false)
  );

  update public.plates set
    programmed_at    = now(),
    programmed_by    = p_written_by,
    programmed_count = programmed_count + 1,
    nfc_serial       = coalesce(nullif(trim(p_nfc_serial), ''), nfc_serial),
    nfc_locked_at    = case when coalesce(p_locked, false) then now() else nfc_locked_at end
  where id = p_plate_id
  returning * into v_plate;

  return v_plate;
end;
$$;

revoke all on function public.record_plate_write(uuid, uuid, uuid, text, text, boolean, boolean) from public;
grant execute on function public.record_plate_write(uuid, uuid, uuid, text, text, boolean, boolean) to service_role;

-- ---------------------------------------------------------------------
-- RLS : mêmes règles que le reste des tables métier
-- ---------------------------------------------------------------------
alter table public.plate_writes enable row level security;
revoke all on public.plate_writes from anon, authenticated;
grant all on public.plate_writes to service_role;
-- Une policy autorise, elle n'accorde pas : sans ce GRANT, PostgreSQL
-- refuse la lecture avant même d'évaluer la policy, et le commerçant
-- se heurterait à « permission denied » sur son propre historique.
grant select on public.plate_writes to authenticated;

create policy plate_writes_read_own on public.plate_writes
  for select to authenticated
  using (public.is_org_member(organization_id) or public.is_platform_admin());
