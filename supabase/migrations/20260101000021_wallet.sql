-- =====================================================================
-- Rangvia — 0021 : passes Apple Wallet et Google Wallet (socle SQL)
-- ---------------------------------------------------------------------
-- Un client peut garder son ticket dans Apple Wallet ou Google Wallet :
-- le pass se met à jour tout seul, écran verrouillé, page fermée. Ce
-- fichier porte tout ce que les deux fournisseurs partagent :
--
--   * wallet_passes : UN registre, une ligne par ticket et par
--     fournisseur. `live` = « le fournisseur détient une copie à tenir à
--     jour » (Apple : au moins un appareil inscrit ; Google : objet créé
--     chez Google). Rien n'est mis en file tant que `live` est faux.
--   * wallet_outbox : UNE file d'envoi, alimentée UNIQUEMENT par des
--     déclencheurs. Au plus une ligne en attente par pass : dix
--     changements de position en deux secondes donnent un seul envoi.
--     La ligne est un drapeau de travail, pas un contenu : le serveur
--     relit l'état courant (wallet_pass_snapshot) au moment d'envoyer.
--   * les inscriptions d'appareils Apple et les classes Google ;
--   * purge_wallet_data : effacement 24 h après la fin du passage,
--     suppression 7 jours plus tard.
--
-- Aucun chemin applicatif ne peut « oublier » de prévenir le Wallet :
-- toutes les transitions du moteur passent par UPDATE queue_entries, que
-- les déclencheurs voient. Et une panne du Wallet ne fait JAMAIS échouer
-- une action de file : chaque mise en file est isolée dans un bloc
-- d'exception, ouvert seulement quand un pass est concerné, et une seule
-- fois par instruction (voir § 7 : cache de sous-transactions).
--
-- Verrous : toute lecture verrouillante d'un pass est `for no key update`.
-- La clé étrangère wallet_outbox → wallet_passes prend un FOR KEY SHARE à
-- chaque mise en file ; un FOR UPDATE le bloquerait et, face au déclencheur
-- du moteur qui a déjà inséré sa ligne en attente, provoquerait un
-- interblocage (la mise en file du moteur serait sacrifiée). Aucune
-- fonction ci-dessous ne modifie une colonne de clé d'un pass.
--
-- Sécurité : tables sous RLS sans aucune politique ; fonctions réservées
-- à service_role ; rien pour anon ni authenticated. Aucun prénom n'entre
-- dans un pass, ni dans l'instantané qui sert à le dessiner.
--
-- Codes d'erreur propres au Wallet (VT011 à VT014 : plaques ; VT015 à
-- VT017 : profils métier) :
--   VT020 ticket plus éligible (terminé depuis plus de 30 min, pass effacé)
--   VT021 Wallet désactivé pour cette organisation
--   VT022 paramètre de nommage ou fournisseur invalide
--
-- Commutativité avec les migrations 0031 à 0037 (écran TV, profils
-- métier) : ce fichier ne lit, ne modifie ni ne redéfinit aucun objet
-- qu'elles créent, et ne redéfinit aucune fonction existante. Les
-- déclencheurs ne portent que sur des colonnes créées par les migrations
-- 0002 à 0016, ou par ce fichier.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Énumérations et colonnes existantes
-- ---------------------------------------------------------------------
-- Une valeur ajoutée à une énumération n'est pas utilisable dans la
-- transaction qui l'ajoute : rien, ci-dessous, ne l'emploie littéralement.
-- Les fonctions qui écrivent ces canaux sont en plpgsql et ne les
-- convertissent qu'à l'exécution, bien après la validation de ce fichier.
alter type public.notification_channel add value if not exists 'apple_wallet';
alter type public.notification_channel add value if not exists 'google_wallet';

alter table public.event_campaigns
  add column if not exists wallet_qr_enabled boolean not null default true;
comment on column public.event_campaigns.wallet_qr_enabled is
  'Accepte au contrôle le QR des billets Wallet (statique signé ou TOTP Google), à usage unique. Désactivé : seul le QR tournant de /pass est accepté.';

-- Le lien d'avis présent au dos du pass « Merci » est compté à part.
alter table public.review_clicks drop constraint if exists review_clicks_source_check;
alter table public.review_clicks add constraint review_clicks_source_check
  check (source in ('notification', 'appclip_done', 'web_done', 'wallet', 'unknown'));

-- ---------------------------------------------------------------------
-- 2. Registre des passes
-- ---------------------------------------------------------------------
-- Horloge de version Apple : `lastUpdated` de la liste des passes à
-- rafraîchir. Globale et strictement croissante.
create sequence if not exists public.wallet_version_seq;

create table public.wallet_passes (
  id                uuid primary key default extensions.gen_random_uuid(),
  provider          text not null check (provider in ('apple', 'google')),
  kind              text not null check (kind in ('queue', 'event')),
  organization_id   uuid not null references public.organizations (id) on delete cascade,
  location_id       uuid not null references public.locations (id) on delete cascade,
  queue_id          uuid not null references public.queues (id) on delete cascade,
  queue_entry_id    uuid not null references public.queue_entries (id) on delete cascade,
  event_id          uuid references public.event_campaigns (id) on delete set null,
  client_session_id uuid references public.client_sessions (id) on delete set null,
  -- Apple : serialNumber (22 caractères) ; Google : identifiant d'objet complet.
  external_id       text not null,
  -- Apple : passTypeIdentifier ; Google : identifiant de classe.
  class_ref         text not null check (length(class_ref) between 3 and 200),
  -- active → final (réversible 2 h) → scrubbed (contenu effacé) ;
  -- revoked : coupé à la main, ne se met plus à jour.
  state             text not null default 'active'
                    check (state in ('active', 'final', 'revoked', 'scrubbed')),
  live              boolean not null default false,
  holder_state      text not null default 'unknown'
                    check (holder_state in ('unknown', 'saved', 'removed')),
  version_seq       bigint not null default nextval('public.wallet_version_seq'),
  -- À la seconde : c'est le Last-Modified du service web Apple.
  version_at        timestamptz not null default date_trunc('second', now()),
  content_hash      text,            -- empreinte du rendu de la version courante (Apple)
  synced_hash       text,            -- dernier rendu livré (push Apple accepté / PATCH Google réussi)
  last_synced_at    timestamptz,
  alerts            jsonb not null default '{}'::jsonb,   -- { "your_turn": "2026-…" }
  notify_log        timestamptz[] not null default '{}',  -- budget Google : 3 alertes par 24 h
  download_count    int not null default 0 check (download_count >= 0),
  final_at          timestamptz,
  revoked_at        timestamptz,
  scrubbed_at       timestamptz,
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (provider, external_id),
  unique (provider, queue_entry_id),
  check (provider <> 'apple'  or external_id ~ '^[0-9A-Za-z]{22}$'),
  check (provider <> 'google' or external_id ~ '^[0-9]+\.[A-Za-z0-9._-]+$'),
  check (jsonb_typeof(alerts) = 'object')
);

-- Chemin chaud du déclencheur de ticket : « ce ticket a-t-il un pass à
-- tenir à jour ? ». Sans pass, une lecture d'index partiel, vide.
create index wallet_passes_entry_live on public.wallet_passes (queue_entry_id)
  where live and state in ('active', 'final');
create index wallet_passes_queue_live on public.wallet_passes (queue_id)
  where live and state = 'active';
create index wallet_passes_event_live on public.wallet_passes (event_id)
  where live and state = 'active';
create index wallet_passes_final_idx on public.wallet_passes (final_at)
  where state = 'final';
-- Changements de marque (établissement, organisation) : le « Merci »
-- (final) porte aussi le logo et le lien d'avis, il est redessiné.
create index wallet_passes_org_live on public.wallet_passes (organization_id, location_id)
  where live and state in ('active', 'final');
-- purge_expired_data supprime les sessions clients : sans cet index,
-- chaque suppression parcourrait la table (on delete set null).
create index wallet_passes_session on public.wallet_passes (client_session_id)
  where client_session_id is not null;

create trigger wallet_passes_touch
  before update on public.wallet_passes
  for each row execute function internal.touch_updated_at();

comment on table public.wallet_passes is
  'Un pass Apple Wallet ou Google Wallet par ticket et par fournisseur. Jamais de prénom : le contenu est relu à chaque envoi par wallet_pass_snapshot.';
comment on column public.wallet_passes.live is
  'Le fournisseur détient une copie à tenir à jour (Apple : au moins un appareil inscrit ; Google : objet créé). Faux : rien n''est mis en file.';

-- Garde-fou multi-tenant : même service_role ne peut pas relier un pass
-- à un ticket, une file, un événement ou une session d'un autre tenant.
create or replace function internal.assert_wallet_pass_consistency()
returns trigger
language plpgsql
security definer
set search_path = public, internal, extensions, pg_temp
as $$
declare
  v_entry public.queue_entries;
  v_event public.event_campaigns;
begin
  select * into v_entry from public.queue_entries where id = new.queue_entry_id;
  if not found then
    raise exception 'Ticket introuvable pour pass Wallet';
  end if;

  if v_entry.organization_id <> new.organization_id
     or v_entry.location_id <> new.location_id
     or v_entry.queue_id <> new.queue_id then
    raise exception 'Incohérence multi-tenant pass Wallet';
  end if;

  if new.event_id is not null then
    select * into v_event from public.event_campaigns where id = new.event_id;
    if not found
       or v_event.organization_id <> new.organization_id
       or v_event.queue_id <> new.queue_id then
      raise exception 'Incohérence multi-tenant pass Wallet (événement)';
    end if;
  end if;

  if new.client_session_id is not null and not exists (
    select 1 from public.client_sessions cs
    where cs.id = new.client_session_id and cs.organization_id = new.organization_id
  ) then
    raise exception 'Incohérence multi-tenant pass Wallet (session)';
  end if;

  return new;
end;
$$;

create trigger wallet_passes_tenant_guard
  before insert or update of organization_id, location_id, queue_id, queue_entry_id,
                             event_id, client_session_id
  on public.wallet_passes
  for each row execute function internal.assert_wallet_pass_consistency();

-- ---------------------------------------------------------------------
-- 3. File d'envoi commune
-- ---------------------------------------------------------------------
create table public.wallet_outbox (
  id              bigint generated always as identity primary key,
  wallet_pass_id  uuid not null references public.wallet_passes (id) on delete cascade,
  provider        text not null check (provider in ('apple', 'google')),
  queue_id        uuid not null,
  job             text not null default 'sync' check (job in ('sync', 'scrub')),
  -- position, status, staff, event_pass, event, queue, branding, archive,
  -- register, reopen… : pour les journaux, jamais pour le rendu.
  reasons         text[] not null default '{}',
  priority        smallint not null default 0 check (priority in (0, 1)),  -- 1 = moment clé
  status          text not null default 'pending'
                  check (status in ('pending', 'processing', 'done', 'dead')),
  attempts        int not null default 0 check (attempts >= 0),
  run_after       timestamptz not null default now(),
  locked_until    timestamptz,
  last_error      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- La fusion repose sur cet index : au plus UNE ligne en attente par pass.
create unique index wallet_outbox_one_pending on public.wallet_outbox (wallet_pass_id)
  where status = 'pending';
create index wallet_outbox_due on public.wallet_outbox (provider, priority desc, run_after)
  where status = 'pending';
create index wallet_outbox_queue on public.wallet_outbox (queue_id, run_after)
  where status = 'pending';
-- Exclusion par pass (« pas deux traitements simultanés ») et suppression
-- en cascade d'un pass.
create index wallet_outbox_pass on public.wallet_outbox (wallet_pass_id, status);
create index wallet_outbox_processing on public.wallet_outbox (locked_until)
  where status = 'processing';

create trigger wallet_outbox_touch
  before update on public.wallet_outbox
  for each row execute function internal.touch_updated_at();

comment on table public.wallet_outbox is
  'Travaux Wallet en attente. Alimentée seulement par déclencheurs ; une ligne est un drapeau, l''état envoyé est relu au traitement.';

-- ---------------------------------------------------------------------
-- 4. Apple : appareils et inscriptions
-- ---------------------------------------------------------------------
-- L'identifiant de bibliothèque est fourni par iOS, propre à l'appareil
-- et au Pass Type ID, partagé entre commerces : pas d'organization_id
-- ici, l'isolation passe par registrations → wallet_passes.
create table public.wallet_apple_devices (
  device_library_identifier text primary key
    check (device_library_identifier ~ '^[A-Za-z0-9._-]{8,128}$'),
  push_token  text not null check (push_token ~ '^[0-9a-fA-F]{32,200}$'),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger wallet_apple_devices_touch
  before update on public.wallet_apple_devices
  for each row execute function internal.touch_updated_at();

create table public.wallet_apple_registrations (
  device_library_identifier text not null
    references public.wallet_apple_devices (device_library_identifier) on delete cascade,
  wallet_pass_id uuid not null references public.wallet_passes (id) on delete cascade,
  created_at     timestamptz not null default now(),
  primary key (device_library_identifier, wallet_pass_id)
);
create index wallet_apple_registrations_pass on public.wallet_apple_registrations (wallet_pass_id);

-- ---------------------------------------------------------------------
-- 5. Google : classes (une pour la file, une par événement)
-- ---------------------------------------------------------------------
create table public.wallet_google_classes (
  class_id      text primary key check (class_id ~ '^[0-9]+\.[A-Za-z0-9._-]+$'),
  kind          text not null check (kind in ('queue', 'event')),
  event_id      uuid unique references public.event_campaigns (id) on delete cascade,
  review_status text,              -- valeur renvoyée par Google (UNDER_REVIEW, APPROVED, REJECTED…)
  synced_hash   text,
  dirty         boolean not null default true,
  -- Étiquette de la dernière salissure : permet à wallet_google_class_synced
  -- de ne pas effacer un changement survenu PENDANT la synchronisation
  -- (sinon la marque modifiée à ce moment-là ne partirait jamais chez
  -- Google). Strictement croissante (internal.wallet_class_dirty_stamp) et
  -- comparée à égalité. À la milliseconde : elle fait l'aller-retour par un
  -- Date JavaScript sans perte, donc sans resynchronisation sans fin.
  dirty_at      timestamptz not null default date_trunc('milliseconds', clock_timestamp()),
  synced_at     timestamptz,
  last_error    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check ((kind = 'event') = (event_id is not null))
);

create trigger wallet_google_classes_touch
  before update on public.wallet_google_classes
  for each row execute function internal.touch_updated_at();

-- ---------------------------------------------------------------------
-- 6. Mise en file
-- ---------------------------------------------------------------------
-- Union de raisons sans doublon, dans l'ordre d'apparition.
create or replace function internal.wallet_merge_reasons(p_a text[], p_b text[])
returns text[]
language sql
immutable
set search_path = public, internal, extensions, pg_temp
as $$
  select coalesce(array_agg(r order by first_seen), '{}')
  from (
    select r, min(i) as first_seen
    from unnest(coalesce(p_a, '{}') || coalesce(p_b, '{}')) with ordinality as t (r, i)
    where r is not null
    group by r
  ) u;
$$;

-- Version ensembliste : UNE instruction pour tous les passes concernés.
-- Un déclencheur ouvre ainsi une seule sous-transaction, même quand la
-- fermeture d'un drop touche deux cents passes.
--   * rien pour un pass non `live`, ou effacé ; un pass révoqué n'accepte
--     plus qu'un effacement ;
--   * moment clé → dû tout de suite ; changement mineur → au plus un
--     envoi toutes les 20 s par pass ;
--   * fusion avec la ligne en attente : raisons unies, priorité et
--     échéance les plus urgentes, effacement prioritaire sur la synchro.
create or replace function internal.enqueue_wallet_updates(
  p_pass_ids  uuid[],
  p_reason    text,
  p_key       boolean,
  p_job       text default 'sync',
  p_run_after timestamptz default null
) returns int
language plpgsql
security definer
set search_path = public, internal, extensions, pg_temp
as $$
declare
  v_count int;
begin
  if p_job is null or p_job not in ('sync', 'scrub') then
    raise exception 'Travail Wallet inconnu : %', p_job using errcode = '22023';
  end if;
  if p_reason is null or p_reason !~ '^[a-z_]{1,32}$' then
    raise exception 'Raison Wallet invalide : %', p_reason using errcode = '22023';
  end if;
  if p_pass_ids is null or cardinality(p_pass_ids) = 0 then
    return 0;
  end if;

  insert into public.wallet_outbox as o (
    wallet_pass_id, provider, queue_id, job, reasons, priority, run_after
  )
  select p.id, p.provider, p.queue_id, p_job, array[p_reason],
         case when coalesce(p_key, false) then 1 else 0 end,
         coalesce(
           p_run_after,
           case
             when coalesce(p_key, false) or p_job = 'scrub' then now()
             -- greatest() ignore un last_synced_at nul : dû tout de suite.
             else greatest(now(), p.last_synced_at + interval '20 seconds')
           end
         )
  from public.wallet_passes p
  where p.id = any (p_pass_ids)
    and p.live
    and p.state <> 'scrubbed'
    and (p.state <> 'revoked' or p_job = 'scrub')
  on conflict (wallet_pass_id) where status = 'pending' do update
     set reasons   = internal.wallet_merge_reasons(o.reasons, excluded.reasons),
         priority  = greatest(o.priority, excluded.priority),
         run_after = least(o.run_after, excluded.run_after),
         job       = case when o.job = 'scrub' or excluded.job = 'scrub' then 'scrub' else 'sync' end;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Forme unitaire du contrat (§ 6.3 du plan Wallet).
create or replace function internal.enqueue_wallet_update(
  p_pass_id   uuid,
  p_reason    text,
  p_key       boolean,
  p_job       text default 'sync',
  p_run_after timestamptz default null
) returns boolean
language plpgsql
security definer
set search_path = public, internal, extensions, pg_temp
as $$
begin
  return internal.enqueue_wallet_updates(array[p_pass_id], p_reason, p_key, p_job, p_run_after) > 0;
end;
$$;

-- ---------------------------------------------------------------------
-- 7. Déclencheurs du moteur
-- ---------------------------------------------------------------------
-- Tous SECURITY DEFINER : quand le serveur modifie une ligne directement
-- (service_role, sans droit sur le schéma internal), le déclencheur doit
-- pouvoir appeler internal.enqueue_wallet_updates.
--
-- Chacun lit d'abord les passes concernés HORS de tout bloc d'exception :
-- sans pass (le cas de presque toutes les actions), aucune sous-transaction
-- n'est ouverte. Sinon, UN bloc d'exception pour tous les passes de
-- l'instruction.
--
-- Pourquoi compter les sous-transactions : chacune qui écrit reçoit un
-- identifiant, gardé jusqu'à la fin de la transaction. Au-delà de 64 dans
-- la même transaction, le cache déborde et TOUTES les images instantanées
-- du cluster passent par pg_subtrans tant qu'elle dure. Mesuré avec un
-- déclencheur par ligne : dans une file de 120 passes tenus à jour, un
-- retrait par le pro (le recalcul des positions décale chaque ticket en
-- une instruction) ouvrait 64+ sous-transactions et passait de 14 à 41 ms.
--
-- Les actions courantes du pro restent à 2 au plus, quelle que soit la
-- taille de la file (test 20, § 17) : une pour le ticket dont le statut
-- change, une pour le recalcul des positions.
--
-- Limite connue, chiffrée, à trancher hors de ce lot : les boucles du
-- moteur qui modifient UN ticket par instruction (issue_event_wave,
-- close_event_campaign, expire_event_passes, migration 0015) ouvrent
-- encore une sous-transaction par ticket porteur d'un billet Wallet tenu à
-- jour : 2 par billet pour une vague (accès émis, puis ticket appelé),
-- 1 par billet pour une clôture. Mesuré (PostgreSQL 16) : vague de 50
-- billets 27 → 60 ms, clôture de 200 billets 50 → 148 ms, cache débordé
-- pendant ces seules transactions (une par vague, une par drop). Le
-- remède propre est ensembliste côté moteur (une instruction par vague),
-- pas un contournement ici : ces fonctions ne sont pas redéfinies par
-- cette migration.

-- Ticket : statut, position, professionnel assigné. Déclencheur PAR
-- INSTRUCTION avec tables de transition : recompute_queue_positions décale
-- tous les tickets d'une file en UNE instruction, après chaque action.
-- PostgreSQL refuse une liste de colonnes (`of status, …`) avec des tables
-- de transition : le filtre sur les colonnes changées est dans la jointure.
-- Sans pass, le coût est une jointure vide sur l'index partiel
-- wallet_passes_entry_live.
create or replace function internal.wallet_entry_touch()
returns trigger
language plpgsql
security definer
set search_path = public, internal, extensions, pg_temp
as $$
declare
  v_ids     uuid[];
  v_reasons text[];
  v_keys    boolean[];
  r         record;
begin
  select array_agg(c.pass_id), array_agg(c.reason), array_agg(c.is_key)
    into v_ids, v_reasons, v_keys
  from (
    select p.id as pass_id,
           case
             when o.status is distinct from n.status then 'status'
             when o.people_ahead is distinct from n.people_ahead then 'position'
             else 'staff'
           end as reason,
           -- Moment clé : même logique que les notifications existantes
           -- (claim_pending_notifications) — changement de statut, ou
           -- franchissement du seuil, puis 1, puis 0.
           coalesce(
             o.status is distinct from n.status
             or (o.people_ahead is distinct from n.people_ahead
                 and (n.people_ahead in (0, 1)
                      or (o.people_ahead > coalesce(q.notify_ahead_threshold, 2)
                          and n.people_ahead <= coalesce(q.notify_ahead_threshold, 2)))),
             false) as is_key
    from wallet_entries_new n
    join wallet_entries_old o on o.id = n.id
    join public.wallet_passes p
      on p.queue_entry_id = n.id and p.live and p.state in ('active', 'final')
    left join public.queues q on q.id = n.queue_id
    where o.status is distinct from n.status
       or o.people_ahead is distinct from n.people_ahead
       or o.staff_id is distinct from n.staff_id
  ) c;

  if v_ids is null then
    return null;
  end if;

  begin
    -- Au plus six groupes (trois raisons, deux urgences), une seule
    -- sous-transaction pour tous.
    for r in
      select t.reason, t.is_key, array_agg(t.id) as ids
      from unnest(v_ids, v_reasons, v_keys) as t (id, reason, is_key)
      group by t.reason, t.is_key
    loop
      perform internal.enqueue_wallet_updates(r.ids, r.reason, r.is_key);
    end loop;
  exception when others then
    -- Une panne du Wallet ne doit jamais faire échouer une action de file.
    raise warning 'Wallet : mise en file impossible pour % pass : %', cardinality(v_ids), sqlerrm;
  end;

  return null;
end;
$$;

create trigger queue_entries_wallet_touch
  after update on public.queue_entries
  referencing old table as wallet_entries_old new table as wallet_entries_new
  for each statement
  execute function internal.wallet_entry_touch();

-- Laisser-passer d'un drop : émission, validation, expiration, révocation.
-- Par instruction, comme les tickets : close_event_campaign révoque tous
-- les accès d'un événement en une instruction.
create or replace function internal.wallet_event_pass_touch()
returns trigger
language plpgsql
security definer
set search_path = public, internal, extensions, pg_temp
as $$
declare
  v_ids uuid[];
begin
  if tg_op = 'INSERT' then
    select array_agg(distinct p.id) into v_ids
    from wallet_access_new n
    join public.wallet_passes p
      on p.queue_entry_id = n.queue_entry_id and p.live and p.state in ('active', 'final');
  else
    select array_agg(distinct p.id) into v_ids
    from wallet_access_new n
    join wallet_access_old o on o.id = n.id
    join public.wallet_passes p
      on p.queue_entry_id = n.queue_entry_id and p.live and p.state in ('active', 'final')
    where o.status is distinct from n.status
       or o.valid_until is distinct from n.valid_until
       or o.grace_until is distinct from n.grace_until;
  end if;

  if v_ids is null then
    return null;
  end if;

  begin
    perform internal.enqueue_wallet_updates(v_ids, 'event_pass', true);
  exception when others then
    raise warning 'Wallet : mise en file impossible pour % pass (laisser-passer) : %', cardinality(v_ids), sqlerrm;
  end;

  return null;
end;
$$;

create trigger event_access_passes_wallet_insert
  after insert on public.event_access_passes
  referencing new table as wallet_access_new
  for each statement
  execute function internal.wallet_event_pass_touch();

create trigger event_access_passes_wallet_touch
  after update on public.event_access_passes
  referencing old table as wallet_access_old new table as wallet_access_new
  for each statement
  execute function internal.wallet_event_pass_touch();

-- File : pause, fermeture, réouverture, mode, seuil d'alerte, durée de vie
-- des tickets (tous lus par l'instantané). Fermer une file n'annule pas
-- les tickets : le pass reste actif, seul son texte change.
create or replace function internal.wallet_queue_touch()
returns trigger
language plpgsql
security definer
set search_path = public, internal, extensions, pg_temp
as $$
declare
  v_ids uuid[];
begin
  select array_agg(p.id) into v_ids
  from public.wallet_passes p
  where p.queue_id = new.id and p.live and p.state = 'active';

  if v_ids is null then
    return null;
  end if;

  begin
    perform internal.enqueue_wallet_updates(v_ids, 'queue', false);
  exception when others then
    raise warning 'Wallet : mise en file impossible pour la file % : %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger queues_wallet_touch
  after update of status, mode, notify_ahead_threshold, entry_ttl_minutes on public.queues
  for each row
  when (old.status is distinct from new.status
        or old.mode is distinct from new.mode
        or old.notify_ahead_threshold is distinct from new.notify_ahead_threshold
        or old.entry_ttl_minutes is distinct from new.entry_ttl_minutes)
  execute function internal.wallet_queue_touch();

-- Étiquette de salissure d'une classe Google : strictement croissante,
-- à la milliseconde. Pas now() : c'est l'heure de DÉBUT de la transaction,
-- et une transaction commencée avant une autre mais validée après ferait
-- reculer l'étiquette. Le verrou de ligne sérialise les écritures d'une
-- même classe ; l'étiquette précédente + 1 ms garantit la croissance même
-- si deux écritures tombent dans la même milliseconde.
create or replace function internal.wallet_class_dirty_stamp(p_prev timestamptz)
returns timestamptz
language sql
volatile
security definer
set search_path = public, internal, extensions, pg_temp
as $$
  select greatest(date_trunc('milliseconds', clock_timestamp()),
                  coalesce(p_prev, '-infinity'::timestamptz) + interval '1 millisecond');
$$;

-- Événement : marque, règles, statut, dates, acceptation du QR Wallet
-- (tout ce que lit l'instantané). La classe Google de l'événement est
-- salie ; le déclencheur ne la CRÉE pas (son identifiant dépend de
-- l'émetteur, que seule l'application connaît) : wallet_google_classes_due
-- signale les événements encore sans classe.
create or replace function internal.wallet_event_touch()
returns trigger
language plpgsql
security definer
set search_path = public, internal, extensions, pg_temp
as $$
declare
  v_ids uuid[];
begin
  select array_agg(p.id) into v_ids
  from public.wallet_passes p
  where p.event_id = new.id and p.live and p.state = 'active';

  if v_ids is null
     and not exists (select 1 from public.wallet_google_classes c where c.event_id = new.id) then
    return null;
  end if;

  begin
    update public.wallet_google_classes c
       set dirty = true, dirty_at = internal.wallet_class_dirty_stamp(c.dirty_at)
     where c.event_id = new.id;

    perform internal.enqueue_wallet_updates(v_ids, 'event', old.status is distinct from new.status);
  exception when others then
    raise warning 'Wallet : mise en file impossible pour l''événement % : %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

create trigger event_campaigns_wallet_touch
  after update of name, hero_title, logo_url, cover_url, accent_hex, rules_text, status,
                  started_at, ended_at, wallet_qr_enabled
  on public.event_campaigns
  for each row
  when (old.name is distinct from new.name
        or old.hero_title is distinct from new.hero_title
        or old.logo_url is distinct from new.logo_url
        or old.cover_url is distinct from new.cover_url
        or old.accent_hex is distinct from new.accent_hex
        or old.rules_text is distinct from new.rules_text
        or old.status is distinct from new.status
        or old.started_at is distinct from new.started_at
        or old.ended_at is distinct from new.ended_at
        or old.wallet_qr_enabled is distinct from new.wallet_qr_enabled)
  execute function internal.wallet_event_touch();

-- Marque : établissement, organisation, réglages lus par l'instantané.
-- Rare, jamais urgent : même rythme que les changements de position. Le
-- « Merci » (final) est redessiné aussi : il porte le logo et le lien
-- d'avis. Le nom d'un professionnel renommé, lui, part au prochain envoi.
create or replace function internal.wallet_branding_touch()
returns trigger
language plpgsql
security definer
set search_path = public, internal, extensions, pg_temp
as $$
declare
  v_ids uuid[];
begin
  if tg_table_name = 'locations' then
    select array_agg(p.id) into v_ids from public.wallet_passes p
     where p.organization_id = new.organization_id and p.location_id = new.id
       and p.live and p.state in ('active', 'final');
  elsif tg_table_name = 'organization_settings' then
    select array_agg(p.id) into v_ids from public.wallet_passes p
     where p.organization_id = new.organization_id and p.live and p.state in ('active', 'final');
  else
    select array_agg(p.id) into v_ids from public.wallet_passes p
     where p.organization_id = new.id and p.live and p.state in ('active', 'final');
  end if;

  if v_ids is null then
    return null;
  end if;

  begin
    perform internal.enqueue_wallet_updates(v_ids, 'branding', false);
  exception when others then
    raise warning 'Wallet : mise en file impossible (marque, %) : %', tg_table_name, sqlerrm;
  end;
  return null;
end;
$$;

-- Le lien d'avis n'est lu que par sa présence (hasReviewUrl) : changer
-- d'adresse d'avis ne redessine rien, en ajouter ou en retirer une, si.
create trigger locations_wallet_touch
  after update of name, slug, logo_url, cover_url, address_line1, address_line2, postal_code,
                  city, country_code, latitude, longitude, timezone, google_review_url
  on public.locations
  for each row
  when (old.name is distinct from new.name
        or old.slug is distinct from new.slug
        or old.logo_url is distinct from new.logo_url
        or old.cover_url is distinct from new.cover_url
        or old.address_line1 is distinct from new.address_line1
        or old.address_line2 is distinct from new.address_line2
        or old.postal_code is distinct from new.postal_code
        or old.city is distinct from new.city
        or old.country_code is distinct from new.country_code
        or old.latitude is distinct from new.latitude
        or old.longitude is distinct from new.longitude
        or old.timezone is distinct from new.timezone
        or (old.google_review_url is null) <> (new.google_review_url is null))
  execute function internal.wallet_branding_touch();

create trigger organization_settings_wallet_touch
  after update of brand_accent, features, send_completion_review on public.organization_settings
  for each row
  when (old.brand_accent is distinct from new.brand_accent
        or old.features -> 'wallet' is distinct from new.features -> 'wallet'
        or old.send_completion_review is distinct from new.send_completion_review)
  execute function internal.wallet_branding_touch();

create trigger organizations_wallet_touch
  after update of name, logo_url on public.organizations
  for each row
  when (old.name is distinct from new.name
        or old.logo_url is distinct from new.logo_url)
  execute function internal.wallet_branding_touch();

-- ---------------------------------------------------------------------
-- 8. Émission d'un pass (clic sur le badge)
-- ---------------------------------------------------------------------
-- Idempotente : un pass par fournisseur et par ticket ; un second clic
-- renvoie le même pass (download_count compte les téléchargements).
-- Le serveur a déjà vérifié le cookie ; la fonction revérifie en SQL :
-- le ticket appartient à la session, OU le laisser-passer encore valable
-- (émis ou utilisé ; cookie rv_event_pass signé) pointe ce ticket. Un
-- public_id seul ne suffit pas.
--
-- VT005 (ticket introuvable) et VT009 (autre session) disent si un
-- public_id existe : la route de distribution les traduit par UNE seule
-- et même réponse (404), pour ne rien révéler.
--
-- p_naming (fourni par la configuration du fournisseur) :
--   Apple  : { "passTypeId": "pass.fr.rangvia.ticket" }
--   Google : { "objectPrefix": "3388….rangvia_", "queueClass": "3388….rangvia_file_v1",
--              "eventClassPrefix": "3388….rangvia_evt_" }
create or replace function public.wallet_issue_pass(
  p_provider             text,
  p_entry_public_id      text,
  p_client_session_id    uuid,
  p_event_pass_public_id text,
  p_naming               jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions, pg_temp
as $$
declare
  v_entry      public.queue_entries;
  v_org_status public.org_status;
  v_features   jsonb;
  v_event_id   uuid;
  v_kind       text;
  v_naming     jsonb := coalesce(p_naming, '{}'::jsonb);
  v_external   text;
  v_class      text;
  v_pass       public.wallet_passes;
  v_created    boolean := false;
begin
  if p_provider is null or p_provider not in ('apple', 'google') then
    raise exception 'Fournisseur Wallet inconnu' using errcode = 'VT022';
  end if;

  select * into v_entry from public.queue_entries where public_id = p_entry_public_id;
  if not found then
    raise exception 'Ticket introuvable' using errcode = 'VT005';
  end if;

  if not (
    (p_client_session_id is not null and v_entry.client_session_id = p_client_session_id)
    or (p_event_pass_public_id is not null and exists (
          select 1 from public.event_access_passes a
          where a.public_id = p_event_pass_public_id and a.queue_entry_id = v_entry.id
            and a.status in ('issued', 'redeemed')))
  ) then
    raise exception 'Ce ticket n''appartient pas à cette session' using errcode = 'VT009';
  end if;

  -- Un ticket actif, ou le « Merci » tout juste affiché (lien d'avis).
  if not (public.entry_is_active(v_entry.status)
          or (v_entry.status = 'completed' and v_entry.completed_at > now() - interval '30 minutes')) then
    raise exception 'Ce ticket ne peut plus être ajouté au Wallet' using errcode = 'VT020';
  end if;

  select o.status, coalesce(s.features, '{}'::jsonb)
    into v_org_status, v_features
  from public.organizations o
  left join public.organization_settings s on s.organization_id = o.id
  where o.id = v_entry.organization_id;

  if v_org_status is distinct from 'active' then
    raise exception 'Organisation suspendue' using errcode = 'VT007';
  end if;
  if v_features ->> 'wallet' = 'false' then
    raise exception 'Wallet désactivé pour cet établissement' using errcode = 'VT021';
  end if;

  -- Pass existant : même pass, un téléchargement de plus. `for no key
  -- update` : voir l'en-tête (verrous).
  select * into v_pass
  from public.wallet_passes
  where provider = p_provider and queue_entry_id = v_entry.id
  for no key update;

  if not found then
    select ev.id into v_event_id
    from public.event_campaigns ev
    where ev.queue_id = v_entry.queue_id and ev.status in ('live', 'paused')
    limit 1;
    v_kind := case when v_event_id is null then 'queue' else 'event' end;

    if p_provider = 'apple' then
      v_class := v_naming ->> 'passTypeId';
      if v_class is null or v_class !~ '^pass\.[A-Za-z0-9][A-Za-z0-9.-]{0,150}$' then
        raise exception 'Identifiant de type de pass Apple invalide' using errcode = 'VT022';
      end if;
      v_external := internal.generate_public_id(22);
    else
      if coalesce(v_naming ->> 'objectPrefix', '') !~ '^[0-9]+\.[A-Za-z0-9._-]*$' then
        raise exception 'Préfixe d''objet Google invalide' using errcode = 'VT022';
      end if;
      v_external := (v_naming ->> 'objectPrefix')
        || case when v_kind = 'queue' then 'q_' else 'e_' end
        || encode(extensions.gen_random_bytes(16), 'hex');
      v_class := case
        when v_kind = 'queue' then v_naming ->> 'queueClass'
        else (v_naming ->> 'eventClassPrefix') || replace(v_event_id::text, '-', '')
      end;
      if v_class is null or v_class !~ '^[0-9]+\.[A-Za-z0-9._-]+$' then
        raise exception 'Identifiant de classe Google invalide' using errcode = 'VT022';
      end if;
    end if;

    insert into public.wallet_passes (
      provider, kind, organization_id, location_id, queue_id, queue_entry_id,
      event_id, client_session_id, external_id, class_ref, download_count
    ) values (
      p_provider, v_kind, v_entry.organization_id, v_entry.location_id, v_entry.queue_id,
      v_entry.id, v_event_id, v_entry.client_session_id, v_external, v_class, 1
    )
    on conflict (provider, queue_entry_id) do nothing
    returning * into v_pass;

    if found then
      v_created := true;
    else
      -- Double clic simultané : l'autre requête vient de le créer.
      select * into v_pass
      from public.wallet_passes
      where provider = p_provider and queue_entry_id = v_entry.id
      for no key update;
    end if;
  end if;

  if v_pass.state in ('revoked', 'scrubbed') then
    raise exception 'Ce ticket ne peut plus être ajouté au Wallet' using errcode = 'VT020';
  end if;

  if not v_created then
    update public.wallet_passes
       set download_count = download_count + 1
     where id = v_pass.id
    returning * into v_pass;
  end if;

  return jsonb_build_object(
    'id',         v_pass.id,
    'provider',   v_pass.provider,
    'externalId', v_pass.external_id,
    'classRef',   v_pass.class_ref,
    'kind',       v_pass.kind,
    'state',      v_pass.state,
    'created',    v_created,
    'live',       v_pass.live
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 9. Instantané de rendu
-- ---------------------------------------------------------------------
-- UNE requête : tout ce qu'il faut pour dessiner le pass sur les deux
-- plateformes. JAMAIS client_name, ni note du pro, ni jeton de session.
-- token_hash du laisser-passer : seulement pour dériver, côté serveur, le
-- QR Wallet signé (il ne quitte jamais le serveur).
--
-- Forme :
-- { pass:  { id, provider, kind, externalId, classRef, state, live, holderState,
--            versionSeq, versionAt, contentHash, syncedHash, lastSyncedAt,
--            alerts, notifyLog, downloadCount, finalAt, revokedAt, scrubbedAt, createdAt },
--   entry: { publicId, status, peopleAhead, joinedAt, calledAt, serviceStartedAt,
--            completedAt, cancelledAt, expiredAt, absentAt, eventTicketNumber,
--            staffName, statusActor, statusEvent, statusChangedAt },
--   queue: { id, status, mode, notifyAheadThreshold, entryTtlMinutes },
--   location: { id, name, slug, addressLine1, addressLine2, postalCode, city,
--               countryCode, latitude, longitude, timezone, logoUrl, coverUrl, hasReviewUrl },
--   organization: { id, name, logoUrl, brandAccent, walletEnabled, sendCompletionReview },
--   event:  null | { id, name, heroTitle, logoUrl, coverUrl, accentHex, rulesText,
--                    status, startedAt, endedAt, walletQrEnabled },
--   access: null | { publicId, tokenHash, status, issuedAt, validUntil, graceUntil,
--                    redeemedAt, revokedAt, wave },
--   deliveredKinds: { "<canal>": ["your_turn", …] },   -- notification_deliveries 'sent'
--   at: now }
-- statusActor / statusEvent : acteur et type du dernier événement de file
-- qui a mené au statut courant (« quitté » par le client ou « retiré » par
-- le pro ; event_sold_out / event_ended à la fermeture d'un drop).
create or replace function public.wallet_pass_snapshot(p_pass_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public, internal, extensions, pg_temp
as $$
  select jsonb_build_object(
    'pass', jsonb_build_object(
      'id',            p.id,
      'provider',      p.provider,
      'kind',          p.kind,
      'externalId',    p.external_id,
      'classRef',      p.class_ref,
      'state',         p.state,
      'live',          p.live,
      'holderState',   p.holder_state,
      'versionSeq',    p.version_seq,
      'versionAt',     p.version_at,
      'contentHash',   p.content_hash,
      'syncedHash',    p.synced_hash,
      'lastSyncedAt',  p.last_synced_at,
      'alerts',        p.alerts,
      'notifyLog',     to_jsonb(p.notify_log),
      'downloadCount', p.download_count,
      'finalAt',       p.final_at,
      'revokedAt',     p.revoked_at,
      'scrubbedAt',    p.scrubbed_at,
      'createdAt',     p.created_at
    ),
    'entry', jsonb_build_object(
      'publicId',          e.public_id,
      'status',            e.status,
      'peopleAhead',       e.people_ahead,
      'joinedAt',          e.joined_at,
      'calledAt',          e.called_at,
      'serviceStartedAt',  e.service_started_at,
      'completedAt',       e.completed_at,
      'cancelledAt',       e.cancelled_at,
      'expiredAt',         e.expired_at,
      'absentAt',          e.absent_at,
      'eventTicketNumber', case when (e.metadata ->> 'eventTicketNumber') ~ '^[0-9]{1,9}$'
                                then (e.metadata ->> 'eventTicketNumber')::int end,
      'staffName',         st.display_name,
      'statusActor',       le.actor,
      'statusEvent',       le.event_type,
      'statusChangedAt',   le.created_at
    ),
    'queue', jsonb_build_object(
      'id',                   q.id,
      'status',               q.status,
      'mode',                 q.mode,
      'notifyAheadThreshold', q.notify_ahead_threshold,
      'entryTtlMinutes',      q.entry_ttl_minutes
    ),
    'location', jsonb_build_object(
      'id',           l.id,
      'name',         l.name,
      'slug',         l.slug,
      'addressLine1', l.address_line1,
      'addressLine2', l.address_line2,
      'postalCode',   l.postal_code,
      'city',         l.city,
      'countryCode',  l.country_code,
      'latitude',     l.latitude,
      'longitude',    l.longitude,
      'timezone',     l.timezone,
      'logoUrl',      l.logo_url,
      'coverUrl',     l.cover_url,
      'hasReviewUrl', l.google_review_url is not null
    ),
    'organization', jsonb_build_object(
      'id',                   o.id,
      'name',                 o.name,
      'logoUrl',              o.logo_url,
      'brandAccent',          coalesce(s.brand_accent, 'signal'),
      'walletEnabled',        coalesce(s.features ->> 'wallet', 'true') <> 'false',
      'sendCompletionReview', coalesce(s.send_completion_review, true)
    ),
    'event', case when ev.id is null then null else jsonb_build_object(
      'id',              ev.id,
      'name',            ev.name,
      'heroTitle',       ev.hero_title,
      'logoUrl',         ev.logo_url,
      'coverUrl',        ev.cover_url,
      'accentHex',       ev.accent_hex,
      'rulesText',       ev.rules_text,
      'status',          ev.status,
      'startedAt',       ev.started_at,
      'endedAt',         ev.ended_at,
      'walletQrEnabled', ev.wallet_qr_enabled
    ) end,
    'access', case when a.id is null then null else jsonb_build_object(
      'publicId',   a.public_id,
      'tokenHash',  a.token_hash,
      'status',     a.status,
      'issuedAt',   a.issued_at,
      'validUntil', a.valid_until,
      'graceUntil', a.grace_until,
      'redeemedAt', a.redeemed_at,
      'revokedAt',  a.revoked_at,
      'wave',       public.event_pass_wave(a.event_id, a.issued_at)
    ) end,
    'deliveredKinds', coalesce((
      select jsonb_object_agg(d.channel, d.kinds)
      from (
        select nd.channel::text as channel,
               jsonb_agg(distinct nd.kind::text) as kinds
        from public.notification_deliveries nd
        where nd.queue_entry_id = e.id
          and nd.status = 'sent'
          and nd.channel is not null
        group by nd.channel
      ) d
    ), '{}'::jsonb),
    'at', now()
  )
  from public.wallet_passes p
  join public.queue_entries e on e.id = p.queue_entry_id
  join public.queues q on q.id = p.queue_id
  join public.locations l on l.id = p.location_id
  join public.organizations o on o.id = p.organization_id
  left join public.organization_settings s on s.organization_id = p.organization_id
  left join public.staff st on st.id = e.staff_id
  left join public.event_campaigns ev on ev.id = p.event_id
  left join lateral (
    select ap.*
    from public.event_access_passes ap
    where ap.queue_entry_id = e.id
      and (p.event_id is null or ap.event_id = p.event_id)
    order by ap.issued_at desc, ap.created_at desc
    limit 1
  ) a on true
  left join lateral (
    select qe.actor, qe.event_type, qe.created_at
    from public.queue_events qe
    where qe.entry_id = e.id and qe.to_status = e.status
    order by qe.created_at desc, qe.id desc
    limit 1
  ) le on true
  where p.id = p_pass_id;
$$;

-- ---------------------------------------------------------------------
-- 10. Version Apple (au rendu, pas au déclencheur)
-- ---------------------------------------------------------------------
-- Appelée par le vidage ET par GET /v1/passes : la version n'avance que
-- si le contenu change. Avancer au déclencheur provoquerait des pushes
-- sans changement, et un appareil qui interroge avant le push recevrait
-- un 304 sur un contenu périmé. version_at avance d'au moins une seconde :
-- deux changements dans la même seconde donneraient sinon le même
-- Last-Modified, donc un 304 à tort.
create or replace function public.wallet_record_render(p_pass_id uuid, p_hash text)
returns table (version_seq bigint, version_at timestamptz)
language plpgsql
security definer
set search_path = public, internal, extensions, pg_temp
as $$
#variable_conflict use_column
begin
  if p_hash is null or length(p_hash) not between 8 and 128 then
    raise exception 'Empreinte de rendu invalide' using errcode = '22023';
  end if;

  return query
  update public.wallet_passes p
     set version_seq  = nextval('public.wallet_version_seq'),
         version_at   = greatest(date_trunc('second', now()), p.version_at + interval '1 second'),
         content_hash = p_hash
   where p.id = p_pass_id
     and p.state in ('active', 'final')
     and p.content_hash is distinct from p_hash
  returning p.version_seq, p.version_at;

  if not found then
    return query
    select p.version_seq, p.version_at from public.wallet_passes p where p.id = p_pass_id;
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- 11. Traitement de la file d'envoi
-- ---------------------------------------------------------------------
-- Réclamation atomique (même garantie que claim_pending_notifications) :
--   1. une ligne dont le bail a expiré (processus tué en cours de route)
--      redevient `pending`, sauf si une autre ligne attend déjà pour ce
--      pass (elle relira l'état courant) : elle passe alors `done` ;
--   2. lignes dues, sans autre traitement vivant du même pass, les
--      moments clés d'abord, `for update skip locked` : deux vidages
--      concurrents ne réclament jamais la même ligne.
create or replace function public.claim_wallet_outbox(
  p_provider      text,
  p_queue_id      uuid default null,
  p_limit         int default 100,
  p_lease_seconds int default 60
) returns table (
  id             bigint,
  wallet_pass_id uuid,
  provider       text,
  queue_id       uuid,
  job            text,
  reasons        text[],
  priority       smallint,
  attempts       int,
  run_after      timestamptz,
  created_at     timestamptz
)
language plpgsql
security definer
set search_path = public, internal, extensions, pg_temp
as $$
#variable_conflict use_column
declare
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 1000);
  v_lease int := least(greatest(coalesce(p_lease_seconds, 60), 5), 600);
  r       record;
begin
  if p_provider is null or p_provider not in ('apple', 'google') then
    raise exception 'Fournisseur Wallet inconnu' using errcode = 'VT022';
  end if;

  for r in
    select o.id, o.wallet_pass_id, o.attempts
    from public.wallet_outbox o
    where o.status = 'processing'
      and o.provider = p_provider
      and o.locked_until < now()
    order by o.id
    for update skip locked
  loop
    if r.attempts >= 10 then
      update public.wallet_outbox
         set status = 'dead', locked_until = null,
             last_error = 'Bail expiré à chaque tentative'
       where id = r.id;
    elsif exists (select 1 from public.wallet_outbox x
                  where x.wallet_pass_id = r.wallet_pass_id and x.status = 'pending') then
      update public.wallet_outbox
         set status = 'done', locked_until = null,
             last_error = 'Bail expiré : remplacé par la ligne en attente'
       where id = r.id;
    else
      begin
        update public.wallet_outbox
           set status = 'pending', locked_until = null, last_error = 'Bail expiré'
         where id = r.id;
      exception when unique_violation then
        -- Une mise en file concurrente vient de créer la ligne en attente.
        update public.wallet_outbox
           set status = 'done', locked_until = null,
               last_error = 'Bail expiré : remplacé par la ligne en attente'
         where id = r.id;
      end;
    end if;
  end loop;

  return query
  with due as (
    select o.id
    from public.wallet_outbox o
    where o.status = 'pending'
      and o.provider = p_provider
      and o.run_after <= now()
      and (p_queue_id is null or o.queue_id = p_queue_id)
      and not exists (
        select 1 from public.wallet_outbox x
        where x.wallet_pass_id = o.wallet_pass_id
          and x.status = 'processing'
          and x.locked_until >= now()
      )
    order by o.priority desc, o.run_after, o.id
    limit v_limit
    for update of o skip locked
  ),
  claimed as (
    update public.wallet_outbox t
       set status = 'processing',
           attempts = t.attempts + 1,
           locked_until = now() + make_interval(secs => v_lease)
      from due
     where t.id = due.id
    returning t.id, t.wallet_pass_id, t.provider, t.queue_id, t.job, t.reasons,
              t.priority, t.attempts, t.run_after, t.created_at
  )
  select c.id, c.wallet_pass_id, c.provider, c.queue_id, c.job, c.reasons,
         c.priority, c.attempts, c.run_after, c.created_at
  from claimed c
  order by c.priority desc, c.run_after, c.id;
end;
$$;

-- Fin de traitement réussie. p_result :
--   { syncedHash?, live?, holderState?, alertKind?, alertNotified?,
--     final?, reopen?, nextRunAfter?, error? }
-- * alertKind : moment porté par cet envoi, inscrit au registre du pass ;
-- * alertNotified : le fournisseur a accepté une alerte qui sonne. On
--   écrit alors LA ligne notification_deliveries (canal apple_wallet /
--   google_wallet, « envoyée » = acceptée par le fournisseur, comme Web
--   Push) : le serveur n'a pas à l'écrire lui-même ;
-- * reopen n'est accepté que si le ticket est de nouveau actif moins de
--   2 h après final_at (règle de réversibilité du plan) ;
-- * nextRunAfter : transition différée (« Merci » archivé à +2 h).
-- Une ligne qui n'est plus `processing` (bail expiré puis repris) est
-- ignorée : rien n'est écrit, le prochain envoi remettra tout d'aplomb.
-- Une alerte déjà acceptée par le fournisseur n'est alors pas inscrite :
-- le prochain envoi pourrait la refaire sonner. Le vidage doit donc finir
-- bien avant le bail (budget de 20 s pour un bail de 60 s) ; un fournisseur
-- plus lent se règle en allongeant p_lease_seconds, pas ici.
--
-- Registre `alerts` : { "<moment>": "2026-09-24T10:00:00.000Z" }, ISO 8601
-- en UTC à la milliseconde, lisible par new Date() et indépendant du
-- fuseau de la session (contrat relu par les lots Apple et Google).
create or replace function public.complete_wallet_outbox(p_id bigint, p_result jsonb)
returns boolean
language plpgsql
security definer
set search_path = public, internal, extensions, pg_temp
as $$
declare
  v_row      public.wallet_outbox;
  v_pass     public.wallet_passes;
  v_entry    public.queue_entries;
  v_res      jsonb := coalesce(p_result, '{}'::jsonb);
  v_kind     text := nullif(v_res ->> 'alertKind', '');
  v_notified boolean;
  v_final    boolean;
  v_reopen   boolean;
  v_holder   text := nullif(v_res ->> 'holderState', '');
  v_next     timestamptz;
  v_hash     text := nullif(v_res ->> 'syncedHash', '');
  v_devices  text[];
begin
  if jsonb_typeof(v_res) <> 'object' then
    raise exception 'Résultat Wallet invalide' using errcode = '22023';
  end if;
  if v_kind is not null and v_kind not in (
    'ahead_two', 'ahead_one', 'your_turn', 'visit_completed', 'removed',
    'event_access', 'event_sold_out', 'event_ended'
  ) then
    raise exception 'Moment d''alerte Wallet inconnu : %', v_kind using errcode = '22023';
  end if;
  if v_holder is not null and v_holder not in ('unknown', 'saved', 'removed') then
    raise exception 'État de détention Wallet inconnu : %', v_holder using errcode = '22023';
  end if;
  v_notified := coalesce((v_res ->> 'alertNotified')::boolean, false) and v_kind is not null;
  v_final    := coalesce((v_res ->> 'final')::boolean, false);
  v_reopen   := coalesce((v_res ->> 'reopen')::boolean, false);
  v_next     := nullif(v_res ->> 'nextRunAfter', '')::timestamptz;

  select * into v_row from public.wallet_outbox where id = p_id for update;
  if not found or v_row.status <> 'processing' then
    return false;
  end if;

  select * into v_pass from public.wallet_passes where id = v_row.wallet_pass_id for no key update;
  select * into v_entry from public.queue_entries where id = v_pass.queue_entry_id;

  update public.wallet_outbox
     set status = 'done', locked_until = null, last_error = nullif(v_res ->> 'error', '')
   where id = p_id;

  if v_row.job = 'scrub' then
    -- Effacement : plus aucune copie tenue à jour, plus aucun identifiant
    -- d'appareil. Le service web Apple répond 401 ; l'iPhone garde la
    -- dernière version, déjà annulée ou expirée.
    with gone as (
      delete from public.wallet_apple_registrations
       where wallet_pass_id = v_pass.id
      returning device_library_identifier
    )
    select array_agg(device_library_identifier) into v_devices from gone;

    perform internal.wallet_apple_forget_devices(v_devices);

    update public.wallet_passes
       set state = 'scrubbed',
           scrubbed_at = now(),
           live = false,
           alerts = '{}'::jsonb,
           notify_log = '{}',
           synced_hash = coalesce(v_hash, synced_hash),
           last_synced_at = now(),
           last_error = nullif(v_res ->> 'error', '')
     where id = v_pass.id;

    -- Une synchronisation arrivée pendant l'effacement n'a plus d'objet.
    update public.wallet_outbox
       set status = 'done', last_error = 'Pass effacé'
     where wallet_pass_id = v_pass.id and status = 'pending';

    return true;
  end if;

  v_reopen := v_reopen
    and v_pass.state = 'final'
    and v_pass.final_at > now() - interval '2 hours'
    and public.entry_is_active(v_entry.status);

  update public.wallet_passes p
     set synced_hash    = coalesce(v_hash, p.synced_hash),
         last_synced_at = case when v_hash is not null and v_hash is distinct from p.synced_hash
                               then now() else p.last_synced_at end,
         live           = coalesce((v_res ->> 'live')::boolean, p.live),
         holder_state   = coalesce(v_holder, p.holder_state),
         state          = case
                            when v_reopen then 'active'
                            when v_final and p.state = 'active' then 'final'
                            else p.state
                          end,
         final_at       = case
                            when v_reopen then null
                            when v_final and p.state = 'active' then now()
                            else p.final_at
                          end,
         -- Réouverture : registre remis à zéro, comme le moteur le fait
         -- avec notification_status quand un ticket revient en file.
         alerts         = (case when v_reopen then '{}'::jsonb else p.alerts end)
                          || case when v_kind is null then '{}'::jsonb
                                  else jsonb_build_object(v_kind,
                                         to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) end,
         notify_log     = array(
                            select t
                            from unnest(p.notify_log || case when v_notified then array[now()]
                                                              else '{}'::timestamptz[] end) as t
                            where t > now() - interval '24 hours'
                            order by t
                          ),
         last_error     = nullif(v_res ->> 'error', '')
   where p.id = v_pass.id
  returning * into v_pass;

  if v_notified then
    insert into public.notification_deliveries (
      organization_id, location_id, queue_entry_id, entry_public_id,
      channel, kind, status, attempts, sent_at, payload
    ) values (
      v_pass.organization_id, v_pass.location_id, v_pass.queue_entry_id, v_entry.public_id,
      (v_pass.provider || '_wallet')::public.notification_channel,
      v_kind::public.notification_kind, 'sent', 1, now(),
      jsonb_build_object('walletPassId', v_pass.id, 'outboxId', p_id)
    );
  end if;

  if v_next is not null then
    perform internal.enqueue_wallet_updates(array[v_pass.id], 'archive', false, 'sync', v_next);
  end if;

  return true;
end;
$$;

-- Échec : nouvel essai après p_retry_after_seconds, ou abandon (`dead`).
-- Si une autre ligne attend déjà pour ce pass, elle remplace celle-ci.
create or replace function public.fail_wallet_outbox(
  p_id                  bigint,
  p_error               text,
  p_retry_after_seconds int,
  p_dead                boolean
) returns text
language plpgsql
security definer
set search_path = public, internal, extensions, pg_temp
as $$
declare
  v_row    public.wallet_outbox;
  v_error  text := left(coalesce(nullif(p_error, ''), 'Erreur inconnue'), 1000);
  v_status text;
begin
  select * into v_row from public.wallet_outbox where id = p_id for update;
  if not found then
    return null;
  end if;
  if v_row.status <> 'processing' then
    return v_row.status;
  end if;

  if coalesce(p_dead, false) then
    v_status := 'dead';
    update public.wallet_outbox
       set status = 'dead', locked_until = null, last_error = v_error
     where id = p_id;
  elsif exists (select 1 from public.wallet_outbox x
                where x.wallet_pass_id = v_row.wallet_pass_id and x.status = 'pending') then
    v_status := 'done';
    update public.wallet_outbox
       set status = 'done', locked_until = null, last_error = v_error
     where id = p_id;
  else
    v_status := 'pending';
    begin
      update public.wallet_outbox
         set status = 'pending',
             locked_until = null,
             last_error = v_error,
             run_after = now() + make_interval(
               secs => least(greatest(coalesce(p_retry_after_seconds, 30), 1), 86400))
       where id = p_id;
    exception when unique_violation then
      -- Une mise en file concurrente, invisible au contrôle ci-dessus (pas
      -- encore validée), vient de créer la ligne en attente : elle relira
      -- l'état courant, celle-ci s'efface (même règle que claim).
      v_status := 'done';
      update public.wallet_outbox
         set status = 'done', locked_until = null, last_error = v_error
       where id = p_id;
    end;
  end if;

  update public.wallet_passes set last_error = v_error where id = v_row.wallet_pass_id;
  return v_status;
end;
$$;

-- ---------------------------------------------------------------------
-- 12. Apple : service web
-- ---------------------------------------------------------------------
-- Inscription d'un appareil. 'created' | 'exists' | 'limit' (5 appareils
-- par pass : iPhone, Apple Watch, iPad…) | 'gone' (pass inconnu, révoqué
-- ou effacé : le service web répond 401, sans distinguer les cas).
create or replace function public.wallet_apple_register(
  p_serial     text,
  p_device     text,
  p_push_token text
) returns text
language plpgsql
security definer
set search_path = public, internal, extensions, pg_temp
as $$
declare
  v_pass public.wallet_passes;
begin
  if p_device is null or p_device !~ '^[A-Za-z0-9._-]{8,128}$'
     or p_push_token is null or p_push_token !~ '^[0-9a-fA-F]{32,200}$' then
    raise exception 'Appareil ou jeton Apple invalide' using errcode = '22023';
  end if;

  -- Verrou du pass : sérialise le contrôle du nombre d'appareils. `for no
  -- key update` : la mise en file concurrente du moteur (clé étrangère,
  -- FOR KEY SHARE) passe sans attendre ; voir l'en-tête (verrous).
  select * into v_pass
  from public.wallet_passes
  where provider = 'apple' and external_id = p_serial
  for no key update;

  if not found or v_pass.state in ('revoked', 'scrubbed') then
    return 'gone';
  end if;

  if exists (select 1 from public.wallet_apple_registrations
             where device_library_identifier = p_device and wallet_pass_id = v_pass.id) then
    update public.wallet_apple_devices
       set push_token = p_push_token
     where device_library_identifier = p_device
       and push_token is distinct from p_push_token;
    update public.wallet_passes
       set live = true, holder_state = 'saved'
     where id = v_pass.id and (not live or holder_state <> 'saved');
    return 'exists';
  end if;

  if (select count(*) from public.wallet_apple_registrations
      where wallet_pass_id = v_pass.id) >= 5 then
    return 'limit';
  end if;

  -- ON CONFLICT DO UPDATE verrouille l'appareil existant même quand le
  -- jeton ne change pas : une désinscription concurrente ne peut plus le
  -- supprimer avant la validation (internal.wallet_apple_forget_devices).
  insert into public.wallet_apple_devices (device_library_identifier, push_token)
  values (p_device, p_push_token)
  on conflict (device_library_identifier) do update
     set push_token = excluded.push_token
   where wallet_apple_devices.push_token is distinct from excluded.push_token;

  insert into public.wallet_apple_registrations (device_library_identifier, wallet_pass_id)
  values (p_device, v_pass.id);

  update public.wallet_passes
     set live = true, holder_state = 'saved'
   where id = v_pass.id;

  -- L'état a pu changer entre le téléchargement et l'inscription : une
  -- synchronisation (silencieuse si rien n'a bougé : l'appareil reçoit 304).
  perform internal.enqueue_wallet_updates(array[v_pass.id], 'register', false);

  return 'created';
end;
$$;

-- Appareils à oublier : ceux de la liste qui n'ont plus aucune
-- inscription. Chaque appareil est d'abord verrouillé, `skip locked` :
-- une inscription concurrente du même appareil (wallet_apple_register)
-- tient ce verrou depuis son ON CONFLICT jusqu'à sa validation, et
-- l'appareil est alors laissé en place (la purge horaire le reprendra
-- s'il reste orphelin). Le contrôle « sans inscription » vient APRÈS le
-- verrou, dans une nouvelle instruction : il voit les inscriptions
-- validées entre-temps. En une seule instruction, la suppression jugeait
-- sur l'instantané de la requête et pouvait emporter en cascade
-- l'inscription validée pendant son attente.
create or replace function internal.wallet_apple_forget_devices(p_devices text[])
returns int
language plpgsql
security definer
set search_path = public, internal, extensions, pg_temp
as $$
declare
  v_locked text[];
  v_count  int;
begin
  if p_devices is null or cardinality(p_devices) = 0 then
    return 0;
  end if;

  select array_agg(d.device_library_identifier) into v_locked
  from (
    select x.device_library_identifier
    from public.wallet_apple_devices x
    where x.device_library_identifier = any (p_devices)
    order by x.device_library_identifier
    for update skip locked
  ) d;

  delete from public.wallet_apple_devices d
   where d.device_library_identifier = any (coalesce(v_locked, '{}'))
     and not exists (select 1 from public.wallet_apple_registrations r
                     where r.device_library_identifier = d.device_library_identifier);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Désinscription. S'il ne reste aucun appareil, plus rien n'est tenu à
-- jour : `live` retombe et le pass reste consultable jusqu'à sa purge.
create or replace function public.wallet_apple_unregister(p_serial text, p_device text)
returns boolean
language plpgsql
security definer
set search_path = public, internal, extensions, pg_temp
as $$
declare
  v_pass_id uuid;
  v_deleted int;
begin
  select id into v_pass_id
  from public.wallet_passes
  where provider = 'apple' and external_id = p_serial
  for no key update;

  if not found then
    return false;
  end if;

  delete from public.wallet_apple_registrations
   where device_library_identifier = p_device and wallet_pass_id = v_pass_id;
  get diagnostics v_deleted = row_count;

  perform internal.wallet_apple_forget_devices(array[p_device]);

  if not exists (select 1 from public.wallet_apple_registrations where wallet_pass_id = v_pass_id) then
    update public.wallet_passes
       set live = false, holder_state = 'removed'
     where id = v_pass_id;
  end if;

  return v_deleted > 0;
end;
$$;

-- Passes inscrits sur un appareil et modifiés depuis p_since (la valeur
-- `lastUpdated` renvoyée au précédent appel).
create or replace function public.wallet_apple_serials(
  p_device    text,
  p_pass_type text,
  p_since     bigint
) returns table (serial text, version_seq bigint)
language sql
stable
security definer
set search_path = public, internal, extensions, pg_temp
as $$
  select p.external_id, p.version_seq
  from public.wallet_apple_registrations r
  join public.wallet_passes p on p.id = r.wallet_pass_id
  where r.device_library_identifier = p_device
    and p.provider = 'apple'
    and p.class_ref = p_pass_type
    and p.state in ('active', 'final')
    and p.version_seq > coalesce(p_since, 0)
  order by p.version_seq;
$$;

create or replace function public.wallet_apple_lookup(p_serial text)
returns table (id uuid, state text, version_seq bigint, version_at timestamptz, content_hash text)
language sql
stable
security definer
set search_path = public, internal, extensions, pg_temp
as $$
  select p.id, p.state, p.version_seq, p.version_at, p.content_hash
  from public.wallet_passes p
  where p.provider = 'apple' and p.external_id = p_serial;
$$;

-- Jetons à pousser pour un pass (vide s'il est révoqué ou effacé).
create or replace function public.wallet_apple_push_targets(p_pass_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public, internal, extensions, pg_temp
as $$
  select coalesce(array_agg(distinct d.push_token), '{}')
  from public.wallet_passes p
  join public.wallet_apple_registrations r on r.wallet_pass_id = p.id
  join public.wallet_apple_devices d on d.device_library_identifier = r.device_library_identifier
  where p.id = p_pass_id
    and p.provider = 'apple'
    and p.state in ('active', 'final');
$$;

-- Jetons qu'APNs déclare morts (BadDeviceToken, Unregistered…) : les
-- appareils disparaissent, et un pass sans appareil n'est plus `live`.
create or replace function public.wallet_apple_drop_tokens(p_tokens text[])
returns int
language plpgsql
security definer
set search_path = public, internal, extensions, pg_temp
as $$
declare
  v_passes uuid[];
  v_count  int;
begin
  if p_tokens is null or cardinality(p_tokens) = 0 then
    return 0;
  end if;

  select array_agg(distinct r.wallet_pass_id) into v_passes
  from public.wallet_apple_registrations r
  join public.wallet_apple_devices d on d.device_library_identifier = r.device_library_identifier
  where d.push_token = any (p_tokens);

  delete from public.wallet_apple_devices where push_token = any (p_tokens);
  get diagnostics v_count = row_count;

  update public.wallet_passes p
     set live = false, holder_state = 'removed'
   where p.id = any (coalesce(v_passes, '{}'))
     and p.live
     and not exists (select 1 from public.wallet_apple_registrations r where r.wallet_pass_id = p.id);

  return v_count;
end;
$$;

-- ---------------------------------------------------------------------
-- 13. Google : classes et objets
-- ---------------------------------------------------------------------
-- Classes à synchroniser : salies, jamais synchronisées, en erreur depuis
-- plus de 10 min, ou événement en cours sans classe (class_id nul :
-- l'application la crée avec wallet_google_class_upsert, avant tout
-- billet : le bouton Google reste masqué tant que la classe manque).
--
-- Une classe d'événement ne part chez Google que pour une organisation
-- active qui n'a pas désactivé Wallet (features.wallet, comme
-- wallet_issue_pass) : nom, logo et règles de l'événement n'ont rien à y
-- faire sinon (minimisation, § 12.1). Une classe salie pendant une
-- suspension le reste, et part à la réactivation.
--
-- dirty_at : l'étiquette à rendre à wallet_google_class_synced. Nulle pour
-- un événement encore sans classe : le serveur rend alors celle que
-- renvoie wallet_google_class_upsert.
create or replace function public.wallet_google_classes_due(p_limit int default 20)
returns table (
  class_id      text,
  kind          text,
  event_id      uuid,
  review_status text,
  synced_hash   text,
  dirty         boolean,
  dirty_at      timestamptz,
  synced_at     timestamptz,
  last_error    text
)
language sql
stable
security definer
set search_path = public, internal, extensions, pg_temp
as $$
  select * from (
    select c.class_id, c.kind, c.event_id, c.review_status, c.synced_hash,
           c.dirty, c.dirty_at, c.synced_at, c.last_error
    from public.wallet_google_classes c
    where ((c.last_error is null and (c.dirty or c.synced_at is null))
           or (c.last_error is not null and c.updated_at < now() - interval '10 minutes'))
      and (c.kind = 'queue' or exists (
            select 1
            from public.event_campaigns ev
            join public.organizations o on o.id = ev.organization_id
            left join public.organization_settings s on s.organization_id = ev.organization_id
            where ev.id = c.event_id
              and o.status = 'active'
              and coalesce(s.features ->> 'wallet', 'true') <> 'false'))
    union all
    select null::text, 'event'::text, ev.id, null::text, null::text,
           true, null::timestamptz, null::timestamptz, null::text
    from public.event_campaigns ev
    join public.organizations o on o.id = ev.organization_id
    left join public.organization_settings s on s.organization_id = ev.organization_id
    where ev.status in ('live', 'paused')
      and o.status = 'active'
      and coalesce(s.features ->> 'wallet', 'true') <> 'false'
      and not exists (select 1 from public.wallet_google_classes c where c.event_id = ev.id)
  ) due
  order by due.synced_at nulls first, due.dirty_at nulls first
  limit least(greatest(coalesce(p_limit, 20), 1), 200);
$$;

create or replace function public.wallet_google_class_upsert(
  p_class_id text,
  p_kind     text,
  p_event_id uuid
) returns public.wallet_google_classes
language plpgsql
security definer
set search_path = public, internal, extensions, pg_temp
as $$
declare
  v_class public.wallet_google_classes;
begin
  if p_class_id is null or p_class_id !~ '^[0-9]+\.[A-Za-z0-9._-]+$' then
    raise exception 'Identifiant de classe Google invalide' using errcode = 'VT022';
  end if;
  if p_kind is null or p_kind not in ('queue', 'event')
     or (p_kind = 'event') <> (p_event_id is not null) then
    raise exception 'Classe Google incohérente' using errcode = 'VT022';
  end if;

  insert into public.wallet_google_classes (class_id, kind, event_id)
  values (p_class_id, p_kind, p_event_id)
  on conflict (class_id) do update
     set kind = excluded.kind, event_id = excluded.event_id
   where wallet_google_classes.kind is distinct from excluded.kind
      or wallet_google_classes.event_id is distinct from excluded.event_id
  returning * into v_class;

  if not found then
    select * into v_class from public.wallet_google_classes where class_id = p_class_id;
  end if;
  return v_class;
end;
$$;

-- Résultat d'une synchronisation de classe. p_dirty_at : l'étiquette
-- dirty_at lue AVANT l'envoi (wallet_google_classes_due, ou le retour de
-- wallet_google_class_upsert pour une classe neuve). Si elle a changé
-- depuis, la classe a été salie pendant l'envoi : elle reste à
-- synchroniser. Comparaison à égalité, sûre puisque l'étiquette ne fait
-- que croître ; une salissure encore en cours (non validée) tient le
-- verrou de la ligne, et cette mise à jour la relit après validation.
-- p_dirty_at nul : classe déclarée propre sans condition (à éviter).
create or replace function public.wallet_google_class_synced(
  p_class_id      text,
  p_hash          text,
  p_review_status text,
  p_error         text,
  p_dirty_at      timestamptz default null
) returns void
language plpgsql
security definer
set search_path = public, internal, extensions, pg_temp
as $$
begin
  if nullif(p_error, '') is null then
    update public.wallet_google_classes c
       set synced_hash   = coalesce(p_hash, c.synced_hash),
           review_status = coalesce(nullif(p_review_status, ''), c.review_status),
           dirty         = case when p_dirty_at is not null and c.dirty_at is distinct from p_dirty_at
                                then c.dirty else false end,
           synced_at     = now(),
           last_error    = null
     where c.class_id = p_class_id;
  else
    update public.wallet_google_classes c
       set last_error    = left(p_error, 1000),
           review_status = coalesce(nullif(p_review_status, ''), c.review_status)
     where c.class_id = p_class_id;
  end if;
end;
$$;

-- Après l'insertion REST réussie au moment du clic : Google détient
-- désormais une copie à tenir à jour.
create or replace function public.wallet_google_mark_live(p_pass_id uuid, p_hash text)
returns boolean
language plpgsql
security definer
set search_path = public, internal, extensions, pg_temp
as $$
begin
  update public.wallet_passes
     set live = true,
         synced_hash = coalesce(p_hash, synced_hash),
         last_synced_at = now(),
         last_error = null
   where id = p_pass_id
     and provider = 'google'
     and state in ('active', 'final');
  return found;
end;
$$;

-- ---------------------------------------------------------------------
-- 14. Purge (cron de maintenance, chaque heure)
-- ---------------------------------------------------------------------
-- Délais plus courts que data_retention_days : un pass n'a plus d'utilité
-- une fois le passage terminé.
--   1. Filet : pass actif dont le ticket est terminé depuis plus de 2 h,
--      ou créé depuis plus de 3 jours (ticket resté absent) → final, avec
--      une dernière synchronisation s'il est tenu à jour. final_at = fin
--      réelle du passage (pas l'heure de la purge) : la fenêtre de
--      réouverture de 2 h et le délai d'effacement de 24 h en partent.
--   2. Pass final (ou révoqué) depuis plus de 24 h → effacement : travail
--      `scrub` s'il est tenu à jour, directement sinon.
--   3. Organisation en suppression → effacement immédiat de ses passes.
--   4. Effacé ou révoqué depuis plus de 7 jours → ligne supprimée.
--   5. Filet ultime : pass créé depuis plus de 30 jours → supprimé, même
--      si le fournisseur n'a jamais pu l'effacer (retiré de la
--      configuration) : on ne garde pas d'identifiant d'appareil sans fin.
--      Conséquence assumée, à dire dans la mention § 12.3 : un pass Google
--      dont l'effacement n'a jamais abouti garde chez Google son dernier
--      contenu (jamais de prénom : marque, statut, heures), et Rangvia n'a
--      plus de quoi l'effacer. Apple : l'iPhone garde de toute façon la
--      dernière version reçue.
--   6. Appareils Apple sans inscription → supprimés (sauf inscription en
--      cours, voir internal.wallet_apple_forget_devices).
--   7. File d'envoi : ligne en attente depuis plus de 2 jours (fournisseur
--      non configuré) → abandonnée ; lignes closes de plus de 7 jours → supprimées.
create or replace function public.purge_wallet_data()
returns jsonb
language plpgsql
security definer
set search_path = public, internal, extensions, pg_temp
as $$
declare
  v_live       uuid[];
  v_finalized  int := 0;
  v_scrub_jobs int := 0;
  v_scrubbed   int := 0;
  v_org_jobs   int := 0;
  v_deleted    int := 0;
  v_expired    int := 0;
  v_devices    int := 0;
  v_abandoned  int := 0;
  v_outbox     int := 0;
  v_n          int;
begin
  -- 1. Filet.
  with done as (
    update public.wallet_passes p
       set state = 'final',
           final_at = case
             when e.status in ('completed', 'cancelled', 'expired', 'skipped')
               then least(now(), coalesce(e.completed_at, e.cancelled_at, e.expired_at, e.updated_at))
             else now()
           end
      from public.queue_entries e
     where e.id = p.queue_entry_id
       and p.state = 'active'
       and (p.created_at < now() - interval '3 days'
            or (e.status in ('completed', 'cancelled', 'expired', 'skipped')
                and coalesce(e.completed_at, e.cancelled_at, e.expired_at, e.updated_at)
                    < now() - interval '2 hours'))
    returning p.id, p.live
  )
  select count(*)::int, array_agg(done.id) filter (where done.live)
    into v_finalized, v_live
  from done;
  perform internal.enqueue_wallet_updates(v_live, 'archive', false);

  -- 2. Effacement 24 h après la fin.
  select array_agg(p.id) into v_live
  from public.wallet_passes p
  where p.live
    and ((p.state = 'final' and p.final_at < now() - interval '24 hours')
         or (p.state = 'revoked' and p.revoked_at < now() - interval '24 hours'));
  v_scrub_jobs := internal.enqueue_wallet_updates(v_live, 'scrub', false, 'scrub');

  update public.wallet_passes
     set state = 'scrubbed', scrubbed_at = now(), alerts = '{}'::jsonb, notify_log = '{}'
   where not live
     and ((state = 'final' and final_at < now() - interval '24 hours')
          or (state = 'revoked' and revoked_at < now() - interval '24 hours'));
  get diagnostics v_scrubbed = row_count;

  -- 3. Organisations en suppression : tout de suite.
  select array_agg(p.id) into v_live
  from public.wallet_passes p
  join public.organizations o on o.id = p.organization_id
  where o.status = 'pending_deletion' and p.live and p.state <> 'scrubbed';
  v_org_jobs := internal.enqueue_wallet_updates(v_live, 'scrub', true, 'scrub');

  update public.wallet_passes p
     set state = 'scrubbed', scrubbed_at = now(), alerts = '{}'::jsonb, notify_log = '{}'
    from public.organizations o
   where o.id = p.organization_id
     and o.status = 'pending_deletion'
     and not p.live
     and p.state <> 'scrubbed';
  get diagnostics v_n = row_count;
  v_scrubbed := v_scrubbed + v_n;

  -- 4. Suppression 7 jours après l'effacement (cascade : file, inscriptions).
  delete from public.wallet_passes
   where (state = 'scrubbed' and scrubbed_at < now() - interval '7 days')
      or (state = 'revoked' and revoked_at < now() - interval '7 days');
  get diagnostics v_deleted = row_count;

  -- 5. Filet ultime.
  delete from public.wallet_passes where created_at < now() - interval '30 days';
  get diagnostics v_expired = row_count;

  -- 6. Appareils orphelins.
  v_devices := internal.wallet_apple_forget_devices(array(
    select d.device_library_identifier
    from public.wallet_apple_devices d
    where not exists (select 1 from public.wallet_apple_registrations r
                      where r.device_library_identifier = d.device_library_identifier)));

  -- 7. File d'envoi.
  update public.wallet_outbox
     set status = 'dead', last_error = 'Abandonnée : fournisseur indisponible depuis 2 jours'
   where status = 'pending' and created_at < now() - interval '2 days';
  get diagnostics v_abandoned = row_count;

  delete from public.wallet_outbox
   where status in ('done', 'dead') and updated_at < now() - interval '7 days';
  get diagnostics v_outbox = row_count;

  return jsonb_build_object(
    'finalizedPasses',   v_finalized,
    'scrubJobs',         v_scrub_jobs + v_org_jobs,
    'scrubbedPasses',    v_scrubbed,
    'deletedPasses',     v_deleted,
    'expiredPasses',     v_expired,
    'deletedDevices',    v_devices,
    'abandonedJobs',     v_abandoned,
    'deletedOutboxRows', v_outbox,
    'at',                now()
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 15. RLS et droits
-- ---------------------------------------------------------------------
-- Aucune politique : ni un client ni un professionnel ne lit une table
-- Wallet. Supabase accorde par défaut des droits aux nouveaux objets de
-- public : on les retire explicitement, comme 0010.
do $$
declare
  t text;
begin
  foreach t in array array[
    'wallet_passes', 'wallet_outbox', 'wallet_apple_devices',
    'wallet_apple_registrations', 'wallet_google_classes'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;
end
$$;

revoke all on sequence public.wallet_version_seq from public, anon, authenticated;
grant usage, select on sequence public.wallet_version_seq to service_role;
revoke all on sequence public.wallet_outbox_id_seq from public, anon, authenticated;
grant usage, select on sequence public.wallet_outbox_id_seq to service_role;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.wallet_issue_pass(text,text,uuid,text,jsonb)',
    'public.wallet_pass_snapshot(uuid)',
    'public.wallet_record_render(uuid,text)',
    'public.claim_wallet_outbox(text,uuid,int,int)',
    'public.complete_wallet_outbox(bigint,jsonb)',
    'public.fail_wallet_outbox(bigint,text,int,boolean)',
    'public.wallet_apple_register(text,text,text)',
    'public.wallet_apple_unregister(text,text)',
    'public.wallet_apple_serials(text,text,bigint)',
    'public.wallet_apple_lookup(text)',
    'public.wallet_apple_push_targets(uuid)',
    'public.wallet_apple_drop_tokens(text[])',
    'public.wallet_google_classes_due(int)',
    'public.wallet_google_class_upsert(text,text,uuid)',
    'public.wallet_google_class_synced(text,text,text,text,timestamptz)',
    'public.wallet_google_mark_live(uuid,text)',
    'public.purge_wallet_data()'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', fn);
    execute format('grant execute on function %s to service_role', fn);
  end loop;

  -- Fonctions internes : appelées seulement par les fonctions ci-dessus
  -- et par les déclencheurs (SECURITY DEFINER), jamais par un rôle client.
  foreach fn in array array[
    'internal.wallet_merge_reasons(text[],text[])',
    'internal.enqueue_wallet_updates(uuid[],text,boolean,text,timestamptz)',
    'internal.enqueue_wallet_update(uuid,text,boolean,text,timestamptz)',
    'internal.assert_wallet_pass_consistency()',
    'internal.wallet_entry_touch()',
    'internal.wallet_event_pass_touch()',
    'internal.wallet_queue_touch()',
    'internal.wallet_event_touch()',
    'internal.wallet_branding_touch()',
    'internal.wallet_class_dirty_stamp(timestamptz)',
    'internal.wallet_apple_forget_devices(text[])'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', fn);
  end loop;
end
$$;

notify pgrst, 'reload schema';

commit;
