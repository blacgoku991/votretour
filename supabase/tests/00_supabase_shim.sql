-- =====================================================================
-- Shim Supabase pour PostgreSQL nu.
-- ---------------------------------------------------------------------
-- Recrée le minimum de l'environnement Supabase (rôles, schéma auth,
-- auth.uid()/auth.jwt(), realtime.messages) afin de pouvoir exécuter les
-- migrations et la suite de tests sur un PostgreSQL local ou en CI, sans
-- Docker ni projet Supabase.
--
-- Ce fichier n'est JAMAIS appliqué sur un vrai projet Supabase : il vit
-- dans supabase/tests/ et non dans supabase/migrations/.
-- =====================================================================

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin noinherit;
  end if;
end
$$;

grant anon, authenticated, service_role to authenticator;
grant anon, authenticated, service_role to postgres;

create schema if not exists extensions;
create schema if not exists auth;
create schema if not exists realtime;

grant usage on schema extensions to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;

create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "citext"   with schema extensions;
create extension if not exists "pg_trgm"  with schema extensions;

-- Table utilisateurs gérée par GoTrue en production.
create table if not exists auth.users (
  id uuid primary key default extensions.gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- auth.uid() / auth.role() / auth.jwt() lisent les GUC request.* comme
-- PostgREST les positionne.
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

-- Publication utilisée par Supabase Realtime (postgres_changes).
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime with (publish = 'insert, update, delete');
  end if;
end
$$;
