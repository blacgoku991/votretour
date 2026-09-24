-- =====================================================================
-- Rangvia — 0044 : écrans TV appairés, rattrapage de la branche ChatGPT
-- =====================================================================
-- Pourquoi ce fichier existe.
--
-- 0016 (visuel des événements, écrans TV appairés) vient de la branche
-- chatgpt/rangvia-max-2-5, qui l'a MODIFIÉ après l'avoir créé : dans sa
-- première version (4cb97da), `display_pair_codes.code_hash` portait une
-- contrainte `unique` sur toute la table ; la seconde (fcd82d8) l'a
-- remplacée par un index unique PARTIEL, limité aux codes non consommés.
--
-- deploy/scripts/migrate.sh tient un registre par NOM de fichier et ne
-- rejoue jamais une migration déjà passée. Une base qui a reçu 0016 dans
-- sa première version garde donc l'ancienne contrainte : un code à six
-- chiffres déjà consommé (conservé 24 h pour l'enquête, voir le cron de
-- maintenance) ne peut plus être réattribué, et la génération d'un code
-- échoue au hasard des collisions. 0016 n'est pas réécrit : ce fichier
-- porte l'écart, et rien que lui, de façon rejouable.
--
-- Sûr dans les deux cas :
--   · base neuve (0016 finale) : la contrainte n'existe pas, l'index
--     existe déjà — chaque instruction est sans effet ;
--   · base qui aurait reçu la première version de 0016 : la contrainte
--     tombe, l'index partiel est créé. Aucun doublon possible parmi les
--     codes non consommés, puisque l'ancienne contrainte les interdisait
--     tous. (La v1 n'a vécu que 25 minutes sur la branche ChatGPT, le
--     23/09, et la production tourne sur la 0016 finale : ce cas est
--     vraisemblablement théorique, mais il ne coûte rien de le couvrir.)
--
-- Le reste de l'écart entre les deux branches ne touche pas la base :
-- colonnes de visuel (hero_title, logo_url, cover_url, accent_hex,
-- rules_text, qr_label), tables et fonction d'appairage sont identiques
-- dans les deux versions de 0016. Elles sont néanmoins réaffirmées ici
-- (droits, RLS, search_path) : un rattrapage doit laisser la base dans
-- l'état exact d'une base neuve, sans dépendre de l'histoire du fichier.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. Réutilisation sûre d'un code consommé.
--
-- Le nom `display_pair_codes_code_hash_key` est celui que PostgreSQL
-- donne à une contrainte `unique` déclarée sur la colonne (0016 v1).
-- ---------------------------------------------------------------------
alter table public.display_pair_codes
  drop constraint if exists display_pair_codes_code_hash_key;

-- Un code à six chiffres ne désigne qu'UN appairage en attente à la fois ;
-- une fois consommé, la même combinaison peut resservir.
create unique index if not exists display_pair_codes_unconsumed_code_idx
  on public.display_pair_codes(code_hash)
  where consumed_at is null;

create index if not exists display_pair_codes_lookup_idx
  on public.display_pair_codes(code_hash, expires_at)
  where consumed_at is null;

-- ---------------------------------------------------------------------
-- 2. Garde-fou multi-tenant : chemin de recherche figé.
--
-- La fonction de déclencheur n'est pas SECURITY DEFINER (elle s'exécute
-- avec les droits de l'appelant, service_role), mais elle lit
-- `public.queues` et `public.event_campaigns` : un search_path figé évite
-- qu'un objet homonyme dans un autre schéma soit lu à leur place.
-- Personne n'a à l'appeler directement.
-- ---------------------------------------------------------------------
alter function internal.assert_display_binding_consistency()
  set search_path = public, internal, extensions;

revoke all on function internal.assert_display_binding_consistency()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 3. Consommation atomique d'un code : SECURITY DEFINER, search_path
--    figé, réservée au serveur (route /api/tv/pair).
-- ---------------------------------------------------------------------
alter function public.consume_display_pair_code(text, text)
  security definer;
alter function public.consume_display_pair_code(text, text)
  set search_path = public, internal, extensions;

revoke all on function public.consume_display_pair_code(text, text)
  from public, anon, authenticated;
grant execute on function public.consume_display_pair_code(text, text)
  to service_role;

-- ---------------------------------------------------------------------
-- 4. Tables des écrans : jamais lisibles depuis le navigateur.
--
-- Les empreintes de codes et de jetons ne sortent que par le serveur
-- (service_role). RLS active sans aucune politique : refus pour tout
-- autre rôle, même si un droit était accordé par erreur plus tard.
-- ---------------------------------------------------------------------
alter table public.display_pair_codes enable row level security;
alter table public.display_devices enable row level security;

revoke all on table public.display_pair_codes from anon, authenticated;
revoke all on table public.display_devices from anon, authenticated;
grant all on table public.display_pair_codes to service_role;
grant all on table public.display_devices to service_role;

commit;

notify pgrst, 'reload schema';
