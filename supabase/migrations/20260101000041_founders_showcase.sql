-- =====================================================================
-- Rangvia — 0041 : les dix premiers commerces, au pied du site public
-- =====================================================================
-- Le pied de page du site public est une file : un rail, des places, et
-- la tête de file en vermillon. On y montre les dix premiers commerces
-- inscrits sur Rangvia, du 1er au 10e, comme des tickets numérotés.
--
-- Trois règles, tenues ICI plutôt que dans l'application, parce que c'est
-- la base qui décide de ce qui sort :
--
--   1. ACCORD EXPLICITE. Un commerce n'apparaît que s'il l'a demandé,
--      depuis ses réglages (organization_settings.founders_opt_in, faux par
--      défaut). L'accord est horodaté par la base elle-même (déclencheur
--      ci-dessous) : l'heure ne vient pas du navigateur ni du serveur web,
--      et un retrait efface l'heure. Le journal d'audit garde l'historique
--      (founders.opt_in / founders.opt_out, écrits par l'action serveur).
--
--   2. RIEN QUE LE NÉCESSAIRE. public.founders_showcase() ne renvoie que
--      la place, le NOM du commerce et sa VILLE. Jamais d'identifiant, de
--      slug, de logo, d'adresse, de prénom, de nombre de clients. La ville
--      est celle du premier établissement actif qui en a une ; sans ville,
--      le ticket n'en montre pas (null, jamais une ville devinée).
--
--   3. DE VRAIS COMMERCES, EN ACTIVITÉ. Statut 'active' seulement : un
--      commerce suspendu ou en cours de suppression quitte la file du site
--      tout de suite, sans que personne ait à y penser. L'ordre est celui
--      de la création de l'organisation (puis l'identifiant, pour départager
--      deux créations dans la même microseconde) : se retirer puis revenir
--      ne fait ni gagner ni perdre de place, et personne ne peut « doubler ».
--
-- Moins de dix volontaires : le site affiche les places restantes comme
-- libres. Aucune donnée n'est inventée pour remplir la file.
--
-- Accès : les deux fonctions sont réservées à service_role (motif de 0010).
-- Le site les lit côté serveur, avec un cache étiqueté « founders » que
-- l'action d'accord invalide (server/founders.ts, server/actions/founders.ts).
-- La colonne d'accord suit organization_settings : lisible par les membres
-- de l'organisation (0010), modifiable par service_role seulement.
--
-- Hors des plages Wallet (0021-0030) et profils (0031-0038) : cette
-- migration ne touche à aucun de leurs objets. scripts/verify-db-order.sh
-- la range avec les migrations appliquées en dernier (0039 et au-delà).
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- L'accord, horodaté.
-- ---------------------------------------------------------------------
alter table public.organization_settings
  add column if not exists founders_opt_in boolean not null default false,
  add column if not exists founders_opt_in_at timestamptz;

comment on column public.organization_settings.founders_opt_in is
  'Le commerce accepte d’apparaître parmi les dix premiers commerces du site public (nom et ville). Faux par défaut.';
comment on column public.organization_settings.founders_opt_in_at is
  'Heure de l’accord en cours, posée par la base ; nulle sans accord.';

-- Un accord a toujours son heure, un refus n'en a jamais.
alter table public.organization_settings
  drop constraint if exists organization_settings_founders_consent_check;
alter table public.organization_settings
  add constraint organization_settings_founders_consent_check
  check ((founders_opt_in and founders_opt_in_at is not null)
      or (not founders_opt_in and founders_opt_in_at is null));

-- L'heure de l'accord est celle de la base, jamais une valeur fournie :
-- une écriture qui ne change pas l'accord garde l'heure d'avant, même si
-- elle en propose une autre.
create or replace function internal.stamp_founders_consent()
returns trigger
language plpgsql
set search_path = public, internal, extensions
as $$
begin
  if tg_op = 'INSERT' or new.founders_opt_in is distinct from old.founders_opt_in then
    new.founders_opt_in_at := case when new.founders_opt_in then now() end;
  else
    new.founders_opt_in_at := old.founders_opt_in_at;
  end if;
  return new;
end;
$$;

revoke all on function internal.stamp_founders_consent() from public, anon, authenticated;

drop trigger if exists organization_settings_founders_stamp on public.organization_settings;
create trigger organization_settings_founders_stamp
  before insert or update of founders_opt_in, founders_opt_in_at on public.organization_settings
  for each row execute function internal.stamp_founders_consent();

-- Les volontaires sont une poignée parmi toutes les organisations : un
-- index partiel les trouve sans parcourir les réglages de tout le monde.
create index if not exists organization_settings_founders_idx
  on public.organization_settings (organization_id)
  where founders_opt_in;

-- ---------------------------------------------------------------------
-- La file des volontaires, dans l'ordre d'inscription.
-- Vue interne partagée par les deux fonctions : une seule définition de
-- « qui est volontaire » et de « dans quel ordre ».
-- ---------------------------------------------------------------------
create or replace function internal.founders_queue()
returns table (organization_id uuid, place int, name text, city text)
language sql
stable
security definer
set search_path = public, internal, extensions
as $$
  select o.id,
         (row_number() over (order by o.created_at, o.id))::int,
         btrim(o.name),
         loc.city
  from public.organizations o
  join public.organization_settings s on s.organization_id = o.id
  left join lateral (
    select btrim(l.city) as city
    from public.locations l
    where l.organization_id = o.id
      and l.is_active
      and nullif(btrim(l.city), '') is not null
    order by l.created_at, l.id
    limit 1
  ) loc on true
  where s.founders_opt_in
    and o.status = 'active';
$$;

revoke all on function internal.founders_queue() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Ce que montre le site : les dix premiers, place, nom et ville.
-- ---------------------------------------------------------------------
create or replace function public.founders_showcase()
returns table (place int, name text, city text)
language sql
stable
security definer
set search_path = public, internal, extensions
as $$
  select q.place, q.name, q.city
  from internal.founders_queue() q
  where q.place <= 10
  order by q.place;
$$;

comment on function public.founders_showcase() is
  'Les dix premiers commerces volontaires et actifs, par date de création : place, nom, ville. Réservée à service_role.';

-- ---------------------------------------------------------------------
-- Ce que voit le commerce dans ses réglages : sa place dans la file des
-- volontaires (au-delà de 10, il attend qu'une place se libère), ou null
-- s'il n'est pas volontaire ou pas actif.
-- ---------------------------------------------------------------------
create or replace function public.founders_showcase_place(p_organization_id uuid)
returns int
language sql
stable
security definer
set search_path = public, internal, extensions
as $$
  select q.place
  from internal.founders_queue() q
  where q.organization_id = p_organization_id;
$$;

comment on function public.founders_showcase_place(uuid) is
  'Place d’un commerce dans la file des volontaires (null sans accord). Réservée à service_role.';

-- Motif de 0010 : jamais appelables depuis le navigateur.
revoke all on function public.founders_showcase() from public, anon, authenticated;
revoke all on function public.founders_showcase_place(uuid) from public, anon, authenticated;
grant execute on function public.founders_showcase() to service_role;
grant execute on function public.founders_showcase_place(uuid) to service_role;

commit;

notify pgrst, 'reload schema';
