#!/usr/bin/env bash
# =====================================================================
# Sauvegarde de la base. À mettre dans une tâche cron quotidienne.
#
#   0 3 * * * /chemin/vers/deploy/scripts/backup.sh >> /var/log/vt-backup.log 2>&1
#
# Une sauvegarde qu'on n'a jamais restaurée n'est pas une sauvegarde :
# essayez restore.sh une fois, sur une copie, avant d'en avoir besoin.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

DEST="${VT_BACKUP_DIR:-./sauvegardes}"
GARDE_JOURS="${VT_BACKUP_KEEP_DAYS:-30}"
mkdir -p "$DEST"

horodatage="$(date +%Y-%m-%d_%Hh%M)"
fichier="$DEST/votretour_${horodatage}.sql.gz"

docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db \
  pg_dump -U postgres -d "${POSTGRES_DB:-votretour}" --clean --if-exists \
  | gzip -9 > "$fichier"

taille="$(du -h "$fichier" | cut -f1)"

# Une sauvegarde de quelques octets est une sauvegarde ratée qui ne dit
# pas son nom : on vérifie qu'elle se décompresse et contient du SQL.
if ! gzip -t "$fichier" 2>/dev/null || [ "$(stat -c%s "$fichier")" -lt 2048 ]; then
  echo "$(date '+%F %T')  ÉCHEC : sauvegarde illisible ou vide ($fichier)"
  exit 1
fi

echo "$(date '+%F %T')  OK  $fichier ($taille)"

supprimees="$(find "$DEST" -name 'votretour_*.sql.gz' -mtime "+$GARDE_JOURS" -print -delete | wc -l)"
[ "$supprimees" -gt 0 ] && echo "$(date '+%F %T')  $supprimees ancienne(s) sauvegarde(s) supprimée(s)"
exit 0
