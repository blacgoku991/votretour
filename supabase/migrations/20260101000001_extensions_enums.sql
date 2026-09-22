-- =====================================================================
-- VotreTour — 0001 : extensions, schémas techniques et énumérations
-- ---------------------------------------------------------------------
-- Toute la logique métier de la file vit dans PostgreSQL : les
-- transitions d'état sont atomiques, le calcul des positions est
-- transactionnel, et aucune course entre deux employés qui cliquent
-- "TERMINER" en même temps ne peut corrompre l'ordre de la file.
-- =====================================================================

create extension if not exists "pgcrypto"  with schema extensions;
create extension if not exists "citext"    with schema extensions;
create extension if not exists "pg_trgm"   with schema extensions;

-- Schéma privé : fonctions internes jamais exposées via PostgREST.
create schema if not exists internal;
revoke all on schema internal from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Énumérations
-- ---------------------------------------------------------------------

-- Machine à états d'une entrée de file. Les libellés affichés côté
-- client/pro sont traduits dans l'applicatif : ici on garde des états
-- techniques précis.
create type public.entry_status as enum (
  'waiting',    -- dans la file, rien de particulier
  'notified',   -- "votre tour approche" envoyé
  'returning',  -- le client a appuyé sur "Je suis de retour"
  'present',    -- le client est physiquement là (confirmé par le pro)
  'next',       -- prochain à passer
  'serving',    -- prestation en cours
  'completed',  -- prestation terminée
  'absent',     -- appelé mais absent
  'skipped',    -- décalé volontairement par le pro
  'cancelled',  -- le client a quitté la file
  'expired'     -- expiré automatiquement (TTL)
);

create type public.queue_mode      as enum ('shared', 'per_staff');
create type public.queue_status    as enum ('open', 'paused', 'closed');
create type public.org_status      as enum ('active', 'suspended', 'pending_deletion');
create type public.member_role     as enum ('owner', 'admin', 'manager', 'member');
create type public.member_status   as enum ('active', 'invited', 'disabled');
create type public.entry_source    as enum ('qr', 'nfc', 'appclip', 'staff', 'link');
create type public.plate_kind      as enum ('nfc', 'qr', 'both');
create type public.plate_order_status as enum ('none', 'requested', 'in_production', 'shipped', 'delivered', 'cancelled');
create type public.absent_policy   as enum ('hold', 'move_back', 'remove');
create type public.advance_mode    as enum ('auto_serve', 'call_next');
create type public.client_platform as enum ('web', 'ios_appclip', 'ios_app', 'android_web', 'unknown');

create type public.notification_channel as enum ('web_push', 'apns_appclip', 'apns_app', 'fcm');

create type public.notification_kind as enum (
  'ahead_two',        -- "Plus que 2 personnes devant vous."
  'ahead_one',        -- "Plus qu'une personne. Commencez à revenir."
  'your_turn',        -- "C'est votre tour."
  'visit_completed',  -- "Merci pour votre visite." + avis Google
  'removed',          -- retiré de la file par le pro
  'queue_closed',     -- la file a été fermée
  'custom'
);

create type public.delivery_status as enum ('queued', 'sent', 'failed', 'skipped');

create type public.subscription_status as enum (
  'trialing', 'active', 'past_due', 'canceled', 'incomplete', 'paused'
);

create type public.activity_type as enum (
  'barber', 'hair_salon', 'nail_bar', 'beauty', 'phone_repair', 'garage',
  'auto_center', 'shop', 'aftersales', 'restaurant', 'counter',
  'admin_service', 'health', 'other'
);

create type public.actor_type as enum ('staff', 'client', 'system', 'platform_admin');

-- ---------------------------------------------------------------------
-- Utilitaires transverses
-- ---------------------------------------------------------------------

-- Horodatage automatique, branché sur chaque table possédant updated_at.
create or replace function internal.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Génère un identifiant public court, non devinable, sans caractères
-- ambigus (ni 0/O ni 1/l/I) : tickets clients, codes de plaques.
-- 22 caractères sur un alphabet de 55 ≈ 127 bits d'entropie.
create or replace function internal.generate_public_id(p_length int default 22)
returns text
language plpgsql
volatile
as $$
declare
  alphabet constant text := '23456789abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
  result text := '';
  bytes bytea;
  i int;
begin
  bytes := extensions.gen_random_bytes(p_length);
  for i in 0 .. p_length - 1 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
  end loop;
  return result;
end;
$$;

-- Repli déterministe à unaccent (pas toujours activable selon le plan).
create or replace function public.unaccent_fallback(p_input text)
returns text
language sql
immutable
as $$
  select translate(
    replace(replace(replace(replace(coalesce(p_input, ''),
      'œ', 'oe'), 'Œ', 'OE'), 'æ', 'ae'), 'Æ', 'AE'),
    'àáâãäåèéêëìíîïòóôõöùúûüçñýÿÀÁÂÃÄÅÈÉÊËÌÍÎÏÒÓÔÕÖÙÚÛÜÇÑŸ',
    'aaaaaaeeeeiiiiooooouuuucnyyAAAAAAEEEEIIIIOOOOOUUUUCNY'
  );
$$;

-- Slugifie un texte libre : "Barber House Paris 11" -> "barber-house-paris-11".
create or replace function internal.slugify(p_input text)
returns text
language sql
immutable
as $$
  select nullif(
    trim(both '-' from
      regexp_replace(
        regexp_replace(lower(public.unaccent_fallback(p_input)), '[^a-z0-9]+', '-', 'g'),
        '-{2,}', '-', 'g'
      )
    ),
    ''
  );
$$;
