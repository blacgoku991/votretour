#!/usr/bin/env bash
# =====================================================================
# Démarre la pile, applique les migrations, affiche l'état.
# Relançable : c'est aussi la commande de mise à jour de configuration.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."
[ -f .env ] || { echo "Pas de .env — lancez d'abord ./scripts/bootstrap.sh"; exit 1; }

echo "── Construction de l'image de l'application ──"
docker compose build app

echo
echo "── Démarrage de la base et de l'authentification ──"
# GoTrue crée le schéma auth et la table auth.users, vers laquelle nos
# migrations pointent : il doit avoir fini avant qu'on les applique.
docker compose up -d db auth
echo "  Attente de GoTrue…"
for i in $(seq 1 60); do
  etat="$(docker compose ps auth --format '{{.Health}}' 2>/dev/null || true)"
  [ "$etat" = "healthy" ] && break
  sleep 2
done
[ "${etat:-}" = "healthy" ] || {
  echo "  GoTrue n'est pas prêt. Journal :"
  docker compose logs --tail 30 auth
  exit 1
}
echo "  Prêt."

echo
echo "── Migrations ──"
./scripts/migrate.sh

echo
echo "── Démarrage du reste ──"
docker compose up -d

echo
echo "── État ──"
docker compose ps
echo
domaine="$(grep -E '^DOMAIN=' .env | cut -d= -f2-)"
echo "Le certificat peut mettre une minute à être délivré."
echo "Ouvrez ensuite :  https://${domaine}/inscription"
