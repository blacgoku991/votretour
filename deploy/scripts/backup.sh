#!/usr/bin/env bash
# =====================================================================
# Sauvegarde quotidienne Rangvia : PostgreSQL + médias téléversés.
#
#   0 3 * * * /chemin/vers/deploy/scripts/backup.sh >> /var/log/rangvia-backup.log 2>&1
#
# Une sauvegarde qu'on n'a jamais restaurée n'est pas une sauvegarde :
# testez restore.sh sur une copie avant d'en avoir besoin.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

DEST="${VT_BACKUP_DIR:-./sauvegardes}"
GARDE_JOURS="${VT_BACKUP_KEEP_DAYS:-30}"
mkdir -p "$DEST"

horodatage="$(date +%Y-%m-%d_%Hh%M)"
base="$DEST/rangvia_${horodatage}"
db_file="${base}.sql.gz"
media_file="${base}.media.tar.gz"

docker compose exec -T -e PGPASSWORD="$POSTGRES_PASSWORD" db   pg_dump -U postgres -d "${POSTGRES_DB:-votretour}" --clean --if-exists   | gzip -9 > "$db_file"

if ! gzip -t "$db_file" 2>/dev/null || [ "$(stat -c%s "$db_file")" -lt 2048 ]; then
  echo "$(date '+%F %T')  ÉCHEC : sauvegarde DB illisible ou vide ($db_file)"
  rm -f "$db_file"
  exit 1
fi

# Les uploads sont dans le volume media-data monté sur /app/data/uploads.
# Le flux tar sort du conteneur afin que le fichier de sauvegarde reste
# sur le VPS, à côté du dump PostgreSQL.
if docker compose exec -T app test -d /app/data/uploads; then
  docker compose exec -T app tar -C /app/data -czf - uploads > "$media_file"
  if ! gzip -t "$media_file" 2>/dev/null; then
    echo "$(date '+%F %T')  ÉCHEC : archive médias illisible ($media_file)"
    rm -f "$media_file"
    exit 1
  fi
else
  # Première installation sans média : on garde tout de même une archive
  # vide afin que chaque sauvegarde soit un couple DB + médias cohérent.
  docker compose exec -T app sh -c 'mkdir -p /tmp/rv-empty/uploads && tar -C /tmp/rv-empty -czf - uploads' > "$media_file"
fi

db_size="$(du -h "$db_file" | cut -f1)"
media_size="$(du -h "$media_file" | cut -f1)"
echo "$(date '+%F %T')  OK  DB=$db_file ($db_size)  médias=$media_file ($media_size)"

# Supprime les deux fichiers d'un ancien jeu de sauvegarde.
deleted="$(find "$DEST" -type f \( -name 'rangvia_*.sql.gz' -o -name 'rangvia_*.media.tar.gz' -o -name 'votretour_*.sql.gz' \) -mtime "+$GARDE_JOURS" -print -delete | wc -l)"
[ "$deleted" -gt 0 ] && echo "$(date '+%F %T')  $deleted ancien(s) fichier(s) de sauvegarde supprimé(s)"
exit 0
