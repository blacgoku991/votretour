#!/usr/bin/env bash
# =====================================================================
# Rejoue les migrations dans l'ordre où la PRODUCTION peut les recevoir,
# compare le schéma obtenu à celui d'une base neuve, puis rejoue la suite
# de tests sur la base « production ».
#
# Pourquoi : deploy/scripts/migrate.sh applique toute migration absente du
# registre, dans l'ordre alphabétique. Si le chantier des profils métier
# (0031-0038) part en production avant le chantier Wallet (0021-0030), la
# production applique 0031-0038 PUIS 0021-0030, l'inverse d'une base neuve.
# Les deux ordres doivent donner exactement la même base.
#
#   ordre « production » : 0001-0020, 0031-0038, 0021-0030, 0039+
#   ordre alphabétique   : 0001-0020, 0021-0030, 0031-0038, 0039+
#
# Tant qu'une plage est vide, les deux ordres coïncident : le script est
# trivialement vert. apps/web/tests/migrations-commute.test.ts fait la même
# vérification par lecture des fichiers ; ce script la fait pour de vrai.
#
# D'autres entrelacements existent en production : 0021 est déjà sur la
# branche principale, la production peut donc recevoir 0021, puis
# 0031-0038, puis 0022-0030 (ou n'importe quel mélange, au gré des
# fusions). Le script n'en rejoue que deux, les extrêmes. Les autres sont
# couverts par le test lexical, qui vérifie la règle PAIRE PAR PAIRE :
# aucun fichier Wallet ne touche ni ne cite un objet d'un fichier profils,
# et réciproquement. Deux migrations qui ne se touchent pas commutent ;
# si toutes les paires commutent, tous les entrelacements donnent la même
# base. Les bornes des plages sont les mêmes ici et dans rangeOf() du test.
#
#   ./scripts/verify-db-order.sh
#   DBNAME=votretour_moi_ord ./scripts/verify-db-order.sh
#
# Deux bases sont recréées : ${DBNAME} (ordre « production », testée) et
# ${DBNAME}_alpha (ordre alphabétique, pour la comparaison).
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGPORT="${PGPORT:-54399}"
PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"
DBNAME="${DBNAME:-votretour_verify_order}"
ALPHA="${DBNAME}_alpha"
ADMIN_URL="postgresql://${PGUSER}@${PGHOST}:${PGPORT}/postgres"
PROD_URL="postgresql://${PGUSER}@${PGHOST}:${PGPORT}/${DBNAME}"
ALPHA_URL="postgresql://${PGUSER}@${PGHOST}:${PGPORT}/${ALPHA}"

command -v psql >/dev/null || { echo "psql introuvable"; exit 1; }
command -v pg_dump >/dev/null || { echo "pg_dump introuvable"; exit 1; }
pg_isready -h "$PGHOST" -p "$PGPORT" >/dev/null 2>&1 || {
  echo "Aucun PostgreSQL sur ${PGHOST}:${PGPORT}."
  echo "Démarrez-en un, ou lancez : docker run --rm -e POSTGRES_HOST_AUTH_METHOD=trust -p ${PGPORT}:5432 postgres:16"
  exit 1
}

WORK="$(mktemp -d)"
# La base de comparaison ne sert qu'ici : elle part avec le script, même
# en échec (la base « production » reste, pour enquêter).
cleanup() {
  rm -rf "$WORK"
  psql "$ADMIN_URL" -q -c "drop database if exists ${ALPHA} with (force)" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ---------------------------------------------------------------------
# Les plages, d'après l'horodatage du nom (20260101000031_… : n° 31).
# Toute migration datée d'après 20260101000038 va dans la dernière plage.
# ---------------------------------------------------------------------
BASE=() WALLET=() PROFILES=() JUNCTION=()
for f in "$ROOT"/supabase/migrations/*.sql; do
  name="$(basename "$f")"
  stamp="${name%%_*}"
  if [[ ! "$stamp" =~ ^[0-9]{14}$ ]]; then
    echo "✗ Nom de migration inattendu : ${name}"
    exit 1
  fi
  if   [[ "$stamp" < "20260101000021" ]]; then BASE+=("$f")
  elif [[ "$stamp" < "20260101000031" ]]; then WALLET+=("$f")
  elif [[ "$stamp" < "20260101000039" ]]; then PROFILES+=("$f")
  else JUNCTION+=("$f")
  fi
done
echo "▸ Plages : ${#BASE[@]} socle, ${#WALLET[@]} Wallet (0021-0030), ${#PROFILES[@]} profils (0031-0038), ${#JUNCTION[@]} jonction (0039+)"

# ---------------------------------------------------------------------
# Base vierge + environnement Supabase simulé.
# ---------------------------------------------------------------------
recreate() {
  local db="$1" url="$2"
  PGOPTIONS='-c client_min_messages=warning' psql "$ADMIN_URL" -q -v ON_ERROR_STOP=1 \
    -c "drop database if exists ${db} with (force)" \
    -c "create database ${db}"
  set +e
  OUTPUT="$(psql "$url" -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/00_supabase_shim.sql" 2>&1)"
  RC=$?
  set -e
  if [ "$RC" -ne 0 ]; then
    printf '%s\n' "$OUTPUT" | grep -vE 'NOTICE|^$' || true
    echo "✗ L'environnement Supabase simulé n'a pas pu être posé sur ${db}."
    exit 1
  fi
}

# Applique des migrations dans l'ordre donné. Le code de retour de psql,
# pas celui de grep : une migration en échec arrête tout (même règle que
# verify-db.sh).
apply() {
  local url="$1"; shift
  local f
  for f in "$@"; do
    printf '   %s' "$(basename "$f")"
    set +e
    OUTPUT="$(psql "$url" -q -v ON_ERROR_STOP=1 -f "$f" 2>&1)"
    RC=$?
    set -e
    printf '%s\n' "$OUTPUT" | grep -vE 'NOTICE|^$' || true
    if [ "$RC" -ne 0 ]; then
      printf '  ✗\n'
      echo "✗ La migration $(basename "$f") a échoué dans cet ordre."
      exit 1
    fi
    printf '  ✓\n'
  done
}

echo "▸ Ordre « production » (profils avant Wallet) : base ${DBNAME}"
recreate "$DBNAME" "$PROD_URL"
apply "$PROD_URL" "${BASE[@]}" ${PROFILES[@]+"${PROFILES[@]}"} ${WALLET[@]+"${WALLET[@]}"} ${JUNCTION[@]+"${JUNCTION[@]}"}

echo "▸ Ordre alphabétique (base neuve) : base ${ALPHA}"
recreate "$ALPHA" "$ALPHA_URL"
apply "$ALPHA_URL" "${BASE[@]}" ${WALLET[@]+"${WALLET[@]}"} ${PROFILES[@]+"${PROFILES[@]}"} ${JUNCTION[@]+"${JUNCTION[@]}"}

# ---------------------------------------------------------------------
# Comparaison des schémas.
#
# pg_dump --schema-only, normalisé : sans commentaires de pg_dump, sans
# lignes vides, sans les clés \restrict aléatoires (pg_dump 16.10 et plus),
# puis trié (l'ordre d'émission de certains objets suit leur OID, qui
# dépend de l'ordre des migrations sans rien changer à la base).
#
# Le tri masquerait deux différences réelles, vérifiées à part dans le
# catalogue : l'ORDRE des valeurs d'une énumération (comparaisons < et >)
# et l'ORDRE des colonnes d'une table (select *, insert sans liste).
# ---------------------------------------------------------------------
dump_schema() {
  local url="$1" out="$2"
  set +e
  pg_dump --schema-only --no-owner "$url" > "$out.raw" 2> "$out.err"
  RC=$?
  set -e
  if [ "$RC" -ne 0 ]; then
    cat "$out.err"
    echo "✗ pg_dump a échoué."
    exit 1
  fi
  grep -vE '^(--|\\restrict |\\unrestrict |SET |SELECT pg_catalog\.set_config)' "$out.raw" \
    | sed -E 's/[[:space:]]+$//' \
    | grep -v '^$' \
    | LC_ALL=C sort > "$out"
}

catalog_order() {
  local url="$1" out="$2"
  set +e
  psql "$url" -X -A -t -q -v ON_ERROR_STOP=1 > "$out" 2>&1 <<'SQL'
select 'enum ' || n.nspname || '.' || t.typname || ' : '
       || string_agg(e.enumlabel, ', ' order by e.enumsortorder)
from pg_type t
join pg_namespace n on n.oid = t.typnamespace
join pg_enum e on e.enumtypid = t.oid
where n.nspname not in ('pg_catalog', 'information_schema')
group by n.nspname, t.typname
union all
select 'colonnes ' || n.nspname || '.' || c.relname || ' : '
       || string_agg(a.attname, ', ' order by a.attnum)
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
where c.relkind in ('r', 'p', 'v', 'm', 'c')
  and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
group by n.nspname, c.relname
order by 1;
SQL
  RC=$?
  set -e
  if [ "$RC" -ne 0 ]; then
    cat "$out"
    echo "✗ Lecture du catalogue impossible."
    exit 1
  fi
}

echo "▸ Comparaison des schémas"
dump_schema "$PROD_URL" "$WORK/prod.sql"
dump_schema "$ALPHA_URL" "$WORK/alpha.sql"
catalog_order "$PROD_URL" "$WORK/prod.order"
catalog_order "$ALPHA_URL" "$WORK/alpha.order"

DIFFERENT=0
if ! diff -u "$WORK/alpha.sql" "$WORK/prod.sql" > "$WORK/schema.diff"; then
  echo "✗ Le schéma diffère selon l'ordre des migrations (- base neuve, + production) :"
  head -n 80 "$WORK/schema.diff" | sed 's/^/     /'
  DIFFERENT=1
fi
if ! diff -u "$WORK/alpha.order" "$WORK/prod.order" > "$WORK/order.diff"; then
  echo "✗ L'ordre des valeurs d'énumération ou des colonnes diffère (- base neuve, + production) :"
  head -n 40 "$WORK/order.diff" | sed 's/^/     /'
  DIFFERENT=1
fi
if [ "$DIFFERENT" -ne 0 ]; then
  echo "  Une migration de 0021-0030 et une de 0031-0038 touchent au même objet (ou"
  echo "  ajoutent chacune une colonne à la même table, ou une valeur à la même"
  echo "  énumération) : déplacez l'un des deux changements dans une migration de"
  echo "  jonction (0039 et au-delà), appliquée en dernier partout."
  exit 1
fi
echo "   schémas identiques ($(wc -l < "$WORK/prod.sql" | tr -d ' ') lignes), énumérations et colonnes dans le même ordre  ✓"

# ---------------------------------------------------------------------
# La suite de tests, sur la base « production ».
# ---------------------------------------------------------------------
echo "▸ Tests (ordre « production »)"
FAILED=0
for f in "$ROOT"/supabase/tests/*.test.sql; do
  echo "   ── $(basename "$f")"
  set +e
  OUTPUT="$(psql "$PROD_URL" -q -v ON_ERROR_STOP=1 -f "$f" 2>&1)"
  RC=$?
  set -e
  printf '%s\n' "$OUTPUT" \
    | sed -E 's/^psql:[^ ]+ //' \
    | grep -E '^(ERROR|FATAL)|ÉCHEC|✅' \
    | sed -E 's/^NOTICE:  ?//' \
    | sed 's/^/     /' || true
  if [ "$RC" -ne 0 ]; then
    echo "     ✗ $(basename "$f") a échoué"
    FAILED=1
  fi
done

if [ "$FAILED" -ne 0 ]; then
  echo "✗ Des tests ont échoué dans l'ordre « production »."
  exit 1
fi
echo "✓ Ordre « production » vérifié : même schéma qu'une base neuve, tests verts."
