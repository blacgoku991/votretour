#!/usr/bin/env bash
# =====================================================================
# Applique les migrations SQL dans l'ordre, une par transaction.
# Une migration déjà passée ne repasse pas : on tient un registre.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

psql() {
  docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
    psql -v ON_ERROR_STOP=1 -U postgres -d "${POSTGRES_DB:-votretour}" "$@"
}

psql -q <<'SQL'
create table if not exists public.schema_migrations (
  version    text primary key,
  applied_at timestamptz not null default now()
);
SQL

appliquees=0
for fichier in ../supabase/migrations/*.sql; do
  version="$(basename "$fichier")"
  deja="$(psql -tAc "select 1 from public.schema_migrations where version = '$version'" || true)"
  if [ "$deja" = "1" ]; then
    printf '  ·   %s (déjà appliquée)\n' "$version"
    continue
  fi
  printf '  →   %s' "$version"
  if psql -q -f - < "$fichier" > /tmp/vt-migrate.log 2>&1; then
    psql -qc "insert into public.schema_migrations (version) values ('$version')"
    printf '\r  ok  %s\n' "$version"
    appliquees=$((appliquees + 1))
  else
    printf '\r  ÉCHEC %s\n\n' "$version"
    tail -20 /tmp/vt-migrate.log
    exit 1
  fi
done

echo "  $appliquees migration(s) appliquée(s)."
