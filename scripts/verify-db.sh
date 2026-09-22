#!/usr/bin/env bash
# =====================================================================
# Rejoue TOUTES les migrations sur une base PostgreSQL vierge puis
# exécute la suite de tests. Aucun projet Supabase ni Docker requis :
# c'est ce que fait la CI.
#
#   ./scripts/verify-db.sh
#   PGPORT=54399 ./scripts/verify-db.sh          # cluster déjà démarré
# =====================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PGPORT="${PGPORT:-54399}"
PGHOST="${PGHOST:-127.0.0.1}"
PGUSER="${PGUSER:-postgres}"
DBNAME="${DBNAME:-votretour_verify}"
ADMIN_URL="postgresql://${PGUSER}@${PGHOST}:${PGPORT}/postgres"
DB_URL="postgresql://${PGUSER}@${PGHOST}:${PGPORT}/${DBNAME}"

command -v psql >/dev/null || { echo "psql introuvable"; exit 1; }
pg_isready -h "$PGHOST" -p "$PGPORT" >/dev/null 2>&1 || {
  echo "Aucun PostgreSQL sur ${PGHOST}:${PGPORT}."
  echo "Démarrez-en un, ou lancez : docker run --rm -e POSTGRES_HOST_AUTH_METHOD=trust -p ${PGPORT}:5432 postgres:16"
  exit 1
}

echo "▸ Recréation de la base ${DBNAME}"
psql "$ADMIN_URL" -q -v ON_ERROR_STOP=1 \
  -c "drop database if exists ${DBNAME} with (force)" \
  -c "create database ${DBNAME}"

echo "▸ Environnement Supabase simulé"
psql "$DB_URL" -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/tests/00_supabase_shim.sql" 2>&1 \
  | grep -vE 'NOTICE|WARNING|HINT|^$' || true

echo "▸ Migrations"
for f in "$ROOT"/supabase/migrations/*.sql; do
  printf '   %s' "$(basename "$f")"
  psql "$DB_URL" -q -v ON_ERROR_STOP=1 -f "$f" 2>&1 | grep -vE 'NOTICE|^$' || true
  printf '  ✓\n'
done

echo "▸ Tests"
FAILED=0
for f in "$ROOT"/supabase/tests/*.test.sql; do
  echo "   ── $(basename "$f")"
  set +e
  OUTPUT="$(psql "$DB_URL" -q -v ON_ERROR_STOP=1 -f "$f" 2>&1)"
  RC=$?
  set -e
  printf '%s\n' "$OUTPUT" \
    | sed -E 's/^psql:[^ ]+ //' \
    | grep -E '^(NOTICE|ERROR|FATAL)' \
    | sed -E 's/^NOTICE:  ?//' \
    | sed 's/^/     /' || true
  [ "$RC" -ne 0 ] && FAILED=1
done

if [ "$FAILED" -ne 0 ]; then
  echo "✗ Des tests ont échoué."
  exit 1
fi
echo "✓ Base de données vérifiée de bout en bout."
