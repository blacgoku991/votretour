#!/usr/bin/env bash
# =====================================================================
# Restaure une sauvegarde. ÉCRASE la base en place.
#   ./scripts/restore.sh sauvegardes/votretour_2026-09-22_03h00.sql.gz
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

fichier="${1:-}"
[ -f "$fichier" ] || { echo "Usage : $0 <fichier.sql.gz>"; exit 1; }

echo "Cette opération REMPLACE le contenu de la base ${POSTGRES_DB:-votretour}."
echo "Fichier : $fichier"
read -r -p "Tapez RESTAURER pour confirmer : " reponse
[ "$reponse" = "RESTAURER" ] || { echo "Annulé."; exit 1; }

# On arrête ce qui écrit pendant la restauration, sinon on restaure une
# base que l'application est en train de modifier.
docker compose stop app rest realtime auth

gunzip -c "$fichier" | docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
  psql -v ON_ERROR_STOP=1 -U postgres -d "${POSTGRES_DB:-votretour}"

docker compose start auth rest realtime app
echo "✓ Restauration terminée."
