-- =====================================================================
-- VotreTour — 0010 : Row Level Security
-- ---------------------------------------------------------------------
-- Modèle de sécurité :
--
--   anon           : AUCUN accès direct aux tables. Toute l'expérience
--                    client passe par les routes serveur (/api/client/*)
--                    qui valident le jeton de session, limitent le débit
--                    et n'utilisent la clé service_role que côté serveur.
--                    Le temps réel client passe par un canal Broadcast
--                    ne contenant aucune donnée personnelle.
--
--   authenticated  : LECTURE des données de SES organisations
--                    uniquement (nécessaire au temps réel Postgres
--                    Changes du tableau de bord). Les écritures passent
--                    par les server actions, jamais par PostgREST.
--
--   service_role   : contourne RLS (rôle BYPASSRLS). Réservé au serveur.
--
--   super-admin    : profiles.is_platform_admin, vérifié par fonction.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Fonctions d'autorisation
-- ---------------------------------------------------------------------
-- SECURITY DEFINER : indispensable pour interroger organization_members
-- depuis une policy DE organization_members sans récursion infinie.
create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select p.is_platform_admin from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

create or replace function public.is_org_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.organization_members m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function public.org_role(p_organization_id uuid)
returns public.member_role
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select m.role
  from public.organization_members m
  where m.organization_id = p_organization_id
    and m.user_id = auth.uid()
    and m.status = 'active'
  limit 1;
$$;

create or replace function public.has_org_role(
  p_organization_id uuid,
  p_roles public.member_role[]
) returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.org_role(p_organization_id) = any (p_roles);
$$;

-- Liste des organisations de l'utilisateur courant (pratique côté app).
create or replace function public.my_organizations()
returns table (
  organization_id uuid,
  name            text,
  slug            text,
  activity        public.activity_type,
  logo_url        text,
  status          public.org_status,
  role            public.member_role,
  onboarding_done boolean,
  location_count  int
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select o.id, o.name, o.slug, o.activity, o.logo_url, o.status, m.role,
         o.onboarding_done_at is not null,
         (select count(*)::int from public.locations l where l.organization_id = o.id)
  from public.organization_members m
  join public.organizations o on o.id = m.organization_id
  where m.user_id = auth.uid() and m.status = 'active'
  order by o.created_at;
$$;

grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.org_role(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.member_role[]) to authenticated;
grant execute on function public.my_organizations() to authenticated;

-- ---------------------------------------------------------------------
-- Verrouillage général
-- ---------------------------------------------------------------------
do $$
declare
  t text;
  tables text[] := array[
    'slug_registry','profiles','organizations','organization_members','locations',
    'staff','services','opening_hours','opening_hours_overrides','organization_settings',
    'queues','client_sessions','queue_entries','queue_events','plates','plate_scans',
    'notification_subscriptions','app_clip_sessions','notification_deliveries',
    'plans','subscriptions','billing_events','audit_logs','system_errors',
    'rate_limits','support_tickets','support_messages'
  ];
begin
  foreach t in array tables loop
    execute format('alter table public.%I enable row level security', t);
    -- Pas de FORCE ROW LEVEL SECURITY : il soumettrait aussi le
    -- propriétaire des tables aux policies, ce qui casse les fonctions
    -- SECURITY DEFINER d'autorisation (récursion infinie sur profiles)
    -- sans rien apporter, puisque service_role possède déjà BYPASSRLS.
    -- On repart d'une ardoise vide : aucun privilège implicite.
    execute format('revoke all on public.%I from anon, authenticated', t);
    -- BYPASSRLS contourne les POLICIES, pas les GRANTS : sans cette
    -- ligne, le serveur applicatif se heurterait à « permission denied ».
    -- On l'écrit explicitement au lieu de dépendre des privilèges par
    -- défaut de Supabase : le schéma reste ainsi valable tel quel en CI,
    -- sur une instance auto-hébergée ou sur un PostgreSQL nu.
    execute format('grant all on public.%I to service_role', t);
  end loop;
end
$$;

grant usage on schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

-- Les tables créées par de futures migrations héritent des mêmes règles.
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant all on sequences to service_role;

-- Les fonctions métier ne sont jamais appelables depuis le navigateur.
do $$
declare
  fn text;
  fns text[] := array[
    'public.resolve_entry_point(text)',
    'public.upsert_client_session(uuid,text,public.client_platform,text,text,text,text)',
    'public.join_queue(uuid,uuid,text,uuid,uuid,public.entry_source,uuid)',
    'public.client_queue_action(text,uuid,text)',
    'public.staff_queue_action(text,text,uuid,uuid,jsonb)',
    'public.add_walkin(uuid,text,uuid,uuid,uuid,uuid)',
    'public.set_queue_status(uuid,public.queue_status,uuid,text)',
    'public.queue_snapshot(uuid)',
    'public.public_queue_state(uuid)',
    'public.ticket_state(text,uuid)',
    'public.find_active_ticket(uuid)',
    'public.recompute_queue_positions(uuid)',
    'public.claim_pending_notifications(uuid)',
    'public.claim_entry_notification(uuid,public.notification_kind)',
    'public.expire_stale_entries()',
    'public.purge_expired_data()',
    'public.location_stats(uuid,timestamptz,timestamptz)',
    'public.platform_stats()'
  ];
begin
  foreach fn in array fns loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;
end
$$;

-- ---------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------
grant select, update on public.profiles to authenticated;

create policy profiles_self_select on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.is_platform_admin());

-- Un utilisateur voit aussi les profils de ses collègues (annuaire équipe).
create policy profiles_colleagues_select on public.profiles
  for select to authenticated
  using (exists (
    select 1
    from public.organization_members mine
    join public.organization_members theirs
      on theirs.organization_id = mine.organization_id
    where mine.user_id = auth.uid() and mine.status = 'active'
      and theirs.user_id = public.profiles.id and theirs.status = 'active'
  ));

-- On peut modifier son profil, mais JAMAIS s'auto-promouvoir super-admin.
create policy profiles_self_update on public.profiles
  for update to authenticated
  using (id = auth.uid())
  -- public.is_platform_admin() est SECURITY DEFINER : elle lit profiles
  -- sans repasser par cette policy (pas de récursion).
  with check (id = auth.uid() and is_platform_admin = public.is_platform_admin());

-- ---------------------------------------------------------------------
-- organizations / membres / réglages
-- ---------------------------------------------------------------------
grant select on public.organizations, public.organization_members,
                public.organization_settings to authenticated;

create policy organizations_member_select on public.organizations
  for select to authenticated
  using (public.is_org_member(id) or public.is_platform_admin());

create policy organization_members_select on public.organization_members
  for select to authenticated
  using (public.is_org_member(organization_id) or public.is_platform_admin());

create policy organization_settings_select on public.organization_settings
  for select to authenticated
  using (public.is_org_member(organization_id) or public.is_platform_admin());

-- ---------------------------------------------------------------------
-- Données d'établissement en lecture seule pour les membres
-- ---------------------------------------------------------------------
do $$
declare
  t text;
  tables text[] := array[
    'locations','staff','services','opening_hours','opening_hours_overrides',
    'queues','queue_entries','queue_events','plates','plate_scans',
    'notification_deliveries','subscriptions','support_tickets','support_messages',
    'audit_logs'
  ];
begin
  foreach t in array tables loop
    execute format('grant select on public.%I to authenticated', t);
    execute format($p$
      create policy %1$s_org_select on public.%1$I
        for select to authenticated
        using (public.is_org_member(organization_id) or public.is_platform_admin())
    $p$, t);
  end loop;
end
$$;

-- ---------------------------------------------------------------------
-- Données sensibles : membres du tenant exclus, super-admin seulement
-- ---------------------------------------------------------------------
-- client_sessions, notification_subscriptions et app_clip_sessions
-- contiennent des secrets d'appareil (jetons push, empreintes). Aucun
-- rôle navigateur n'y accède : seul le serveur, via service_role.
create policy client_sessions_admin_select on public.client_sessions
  for select to authenticated
  using (public.is_platform_admin());

create policy notification_subscriptions_admin_select on public.notification_subscriptions
  for select to authenticated
  using (public.is_platform_admin());

create policy app_clip_sessions_admin_select on public.app_clip_sessions
  for select to authenticated
  using (public.is_platform_admin());

grant select on public.client_sessions, public.notification_subscriptions,
                public.app_clip_sessions to authenticated;

-- ---------------------------------------------------------------------
-- Catalogue d'offres : lisible par tout compte connecté
-- ---------------------------------------------------------------------
grant select on public.plans to authenticated, anon;
create policy plans_public_select on public.plans
  for select to authenticated, anon
  using (is_active and is_public);
create policy plans_admin_select on public.plans
  for select to authenticated
  using (public.is_platform_admin());

-- ---------------------------------------------------------------------
-- Réservé au super-admin
-- ---------------------------------------------------------------------
grant select on public.system_errors, public.billing_events, public.slug_registry to authenticated;

create policy system_errors_admin_select on public.system_errors
  for select to authenticated using (public.is_platform_admin());
create policy billing_events_admin_select on public.billing_events
  for select to authenticated using (public.is_platform_admin());
create policy slug_registry_admin_select on public.slug_registry
  for select to authenticated using (public.is_platform_admin());

-- rate_limits n'est jamais lisible : aucune policy, aucun grant.

-- ---------------------------------------------------------------------
-- Temps réel : publication Postgres Changes pour le tableau de bord
-- ---------------------------------------------------------------------
-- Seule queue_entries est publiée. Supabase Realtime applique les
-- policies ci-dessus : un professionnel ne reçoit donc QUE les
-- changements de ses propres files.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin
      alter publication supabase_realtime add table public.queue_entries;
    exception when duplicate_object then null;
    end;
    begin
      alter publication supabase_realtime add table public.queues;
    exception when duplicate_object then null;
    end;
  end if;
end
$$;

-- REPLICA IDENTITY FULL : nécessaire pour que Realtime puisse évaluer
-- les policies RLS sur l'ancienne version d'une ligne modifiée.
alter table public.queue_entries replica identity full;
alter table public.queues replica identity full;
