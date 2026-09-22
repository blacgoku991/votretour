-- =====================================================================
-- VotreTour — rôles et schémas attendus par les services Supabase
-- ---------------------------------------------------------------------
-- L'image officielle supabase/postgres crée ces rôles d'elle-même. Nous
-- partons d'un PostgreSQL standard, plus léger et déjà celui contre
-- lequel les migrations et les 104 assertions SQL ont été vérifiées :
-- il faut donc les créer ici.
--
-- Exécuté une seule fois, à la création du volume de données.
-- =====================================================================

\set pgpass `echo "$POSTGRES_PASSWORD"`

-- ---------------------------------------------------------------------
-- Les trois rôles applicatifs
-- ---------------------------------------------------------------------
-- noinherit : ces rôles ne doivent RIEN hériter. PostgREST les endosse
-- avec SET ROLE en fonction du claim « role » du jeton, et c'est tout
-- le modèle de sécurité qui repose là-dessus.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  -- bypassrls : le serveur applicatif contourne les policies, parce
  -- qu'il a déjà vérifié les droits lui-même. Jamais le navigateur.
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- authenticator : le seul rôle avec lequel PostgREST se connecte
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
end
$$;
alter user authenticator with password :'pgpass';
grant anon, authenticated, service_role to authenticator;

-- ---------------------------------------------------------------------
-- supabase_auth_admin : le rôle de GoTrue
-- ---------------------------------------------------------------------
-- createrole lui est nécessaire : GoTrue pose ses propres droits sur le
-- schéma auth pendant ses migrations.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin login noinherit createrole;
  end if;
end
$$;
alter user supabase_auth_admin with password :'pgpass';

create schema if not exists auth authorization supabase_auth_admin;
grant usage on schema auth to anon, authenticated, service_role, postgres;
alter role supabase_auth_admin set search_path = auth, extensions, public;

-- ---------------------------------------------------------------------
-- supabase_admin : le rôle de Realtime
-- ---------------------------------------------------------------------
-- replication : Realtime lit le flux de réplication logique pour savoir
-- qu'une ligne de la file vient de changer. Sans ce droit, la file
-- n'avance pas toute seule à l'écran.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_admin') then
    create role supabase_admin login noinherit createrole createdb replication bypassrls;
  end if;
end
$$;
alter user supabase_admin with password :'pgpass';
grant all privileges on database :"POSTGRES_DB" to supabase_admin;

create schema if not exists _realtime authorization supabase_admin;

-- ---------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------
-- Regroupées dans un schéma dédié, comme chez Supabase : elles ne
-- polluent pas public et restent trouvables par search_path.
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role, postgres;

create extension if not exists "pgcrypto"  with schema extensions;
create extension if not exists "citext"    with schema extensions;
create extension if not exists "pg_trgm"   with schema extensions;
create extension if not exists "uuid-ossp" with schema extensions;

-- ---------------------------------------------------------------------
-- Fonctions auth.* attendues par les policies RLS
-- ---------------------------------------------------------------------
-- Elles lisent les GUC que PostgREST positionne à partir du jeton. Ce
-- sont les mêmes définitions que chez Supabase ; nos policies s'en
-- servent partout.
create or replace function auth.jwt()
returns jsonb
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), '')::jsonb,
    '{}'::jsonb
  );
$$;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(auth.jwt() ->> 'sub', '')::uuid;
$$;

create or replace function auth.role()
returns text
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'role', current_setting('role', true));
$$;

create or replace function auth.email()
returns text
language sql
stable
as $$
  select auth.jwt() ->> 'email';
$$;

grant execute on function auth.jwt(), auth.uid(), auth.role(), auth.email()
  to anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- Publication de réplication lue par Realtime
-- ---------------------------------------------------------------------
-- Les migrations y ajouteront les tables concernées. On ne publie pas
-- toute la base : seules les tables dont le professionnel doit voir les
-- changements en direct.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime with (publish = 'insert, update, delete');
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- PostgREST recharge son cache de schéma sur notification
-- ---------------------------------------------------------------------
-- Sans cela, une migration appliquée à chaud reste invisible de l'API
-- jusqu'au redémarrage du conteneur.
create or replace function extensions.pgrst_ddl_watch()
returns event_trigger
language plpgsql
as $$
begin
  perform pg_notify('pgrst', 'reload schema');
end;
$$;

do $$
begin
  if not exists (select 1 from pg_event_trigger where evtname = 'pgrst_ddl_watch') then
    create event trigger pgrst_ddl_watch on ddl_command_end
      execute function extensions.pgrst_ddl_watch();
  end if;
end
$$;
