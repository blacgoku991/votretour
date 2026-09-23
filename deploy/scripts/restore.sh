#!/usr/bin/env bash
# =====================================================================
# Restaure PostgreSQL et, si présente, l'archive médias correspondante.
#
#   ./scripts/restore.sh sauvegardes/rangvia_2026-09-23_03h00.sql.gz
#
# ÉCRASE les données en place.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

db_file="${1:-}"
[ -f "$db_file" ] || { echo "Usage : $0 <fichier.sql.gz>"; exit 1; }

case "$db_file" in
  *.sql.gz) media_file="${db_file%.sql.gz}.media.tar.gz" ;;
  *) echo "Le fichier doit se terminer par .sql.gz"; exit 1 ;;
esac

echo "Cette opération REMPLACE le contenu de la base ${POSTGRES_DB:-votretour}."
echo "Base : $db_file"
if [ -f "$media_file" ]; then
  echo "Médias : $media_file"
else
  echo "Médias : aucune archive associée (les médias existants seront conservés)."
fi

read -r -p "Tapez RESTAURER pour confirmer : " reponse
[ "$reponse" = "RESTAURER" ] || { echo "Annulé."; exit 1; }

# Empêche l'application et les APIs d'écrire pendant la restauration.
docker compose stop app rest realtime auth

gunzip -c "$db_file" | docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db   psql -v ON_ERROR_STOP=1 -U postgres -d "${POSTGRES_DB:-votretour}"

if [ -f "$media_file" ]; then
  gzip -t "$media_file"
  docker compose run --rm --no-deps --entrypoint sh app -c     'mkdir -p /app/data/uploads && rm -rf /app/data/uploads/* && tar -C /app/data -xzf -'     < "$media_file"
fi

docker compose start auth rest realtime app
echo "✓ Restauration terminée."
