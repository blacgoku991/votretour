#!/usr/bin/env bash
# =====================================================================
# Met à jour le code et redéploie. Sauvegarde d'abord.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

echo "── Sauvegarde avant mise à jour ──"
./scripts/backup.sh

echo
echo "── Récupération du code ──"
git -C .. pull --ff-only

echo
echo "── Reconstruction et redémarrage ──"
./scripts/up.sh
