#!/usr/bin/env bash
# =====================================================================
# Prépare le fichier .env : secrets générés, réglages demandés.
# Relançable sans danger — les secrets déjà remplis sont conservés.
# =====================================================================
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE=.env
[ -f "$ENV_FILE" ] || cp .env.example "$ENV_FILE"

lire() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- || true; }
ecrire() {
  local cle="$1" val="$2"
  if grep -qE "^${cle}=" "$ENV_FILE"; then
    # Le séparateur | évite les collisions avec les / des clés base64.
    val="${val//|/\\|}"
    sed -i.bak -E "s|^${cle}=.*|${cle}=${val}|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  else
    printf '%s=%s\n' "$cle" "$val" >> "$ENV_FILE"
  fi
}

echo "── Réglages du serveur ──"
for cle in DOMAIN SITE_URL TLS_EMAIL; do
  actuel="$(lire "$cle")"
  case "$cle" in
    DOMAIN)    invite="Domaine (sans https://), ex. file.mon-domaine.fr" ;;
    SITE_URL)  invite="URL complète, ex. https://file.mon-domaine.fr" ;;
    TLS_EMAIL) invite="Adresse pour Let's Encrypt" ;;
  esac
  if [ -z "$actuel" ] || [[ "$actuel" == *"mon-domaine.fr"* ]]; then
    read -r -p "$invite : " valeur
    [ -n "$valeur" ] && ecrire "$cle" "$valeur"
  else
    echo "  $cle déjà renseigné : $actuel"
  fi
done

# SITE_URL découle de DOMAIN : on évite l'incohérence silencieuse.
domaine="$(lire DOMAIN)"
attendu="https://${domaine}"
if [ "$(lire SITE_URL)" != "$attendu" ]; then
  echo "  SITE_URL aligné sur DOMAIN → $attendu"
  ecrire SITE_URL "$attendu"
fi

echo
echo "── Secrets ──"
manquants=()
for cle in POSTGRES_PASSWORD JWT_SECRET ANON_KEY SERVICE_ROLE_KEY \
           REALTIME_DB_ENC_KEY SECRET_KEY_BASE SESSION_HASH_SECRET CRON_SECRET; do
  [ -z "$(lire "$cle")" ] && manquants+=("$cle")
done

if [ ${#manquants[@]} -eq 0 ]; then
  echo "  Tous les secrets sont déjà en place. Rien n'est régénéré."
else
  echo "  À générer : ${manquants[*]}"
  if [ -n "$(lire JWT_SECRET)" ] && [[ " ${manquants[*]} " == *" ANON_KEY "* ]]; then
    echo
    echo "  ⚠ JWT_SECRET existe mais pas les clés qui en découlent."
    echo "    Régénérer JWT_SECRET invaliderait toutes les sessions."
    echo "    Arrêt : videz les huit secrets pour repartir de zéro."
    exit 1
  fi
  genere="$(node ../scripts/generate-supabase-keys.mjs)"
  while IFS='=' read -r cle valeur; do
    [ -z "$cle" ] && continue
    for m in "${manquants[@]}"; do
      [ "$m" = "$cle" ] && ecrire "$cle" "$valeur"
    done
  done <<< "$genere"
  echo "  Secrets écrits dans $ENV_FILE"
fi

# Secret des jetons des passes Apple Wallet. Généré même si Wallet n'est
# pas configuré : il existe ainsi AVANT le premier pass installé. Vide,
# l'application le dérive de SESSION_HASH_SECRET ; le remplacer par une
# valeur neuve sur un serveur qui a déjà émis des passes Apple les
# empêcherait de se mettre à jour. D'où les deux règles : une valeur
# existante n'est jamais touchée, et on n'en crée pas si Apple Wallet
# est déjà configuré sans elle. Hors de la boucle ci-dessus : son
# absence ne doit pas déclencher le garde-fou de JWT_SECRET.
if [ -z "$(lire WALLET_AUTH_SECRET)" ] && [ -n "$(lire APPLE_WALLET_CERT_PEM)" ]; then
  echo "  WALLET_AUTH_SECRET vide alors qu'Apple Wallet est configuré : laissé"
  echo "  vide (dérivé de SESSION_HASH_SECRET) pour ne pas figer les passes"
  echo "  déjà installés."
elif [ -z "$(lire WALLET_AUTH_SECRET)" ]; then
  if command -v openssl >/dev/null 2>&1; then
    wallet_secret="$(openssl rand -base64 48 | tr -d '\n')"
  else
    wallet_secret="$(node -e "process.stdout.write(require('crypto').randomBytes(48).toString('base64'))")"
  fi
  ecrire WALLET_AUTH_SECRET "$wallet_secret"
  echo "  WALLET_AUTH_SECRET généré (passes Apple Wallet)."
fi

chmod 600 "$ENV_FILE"

echo
echo "── Notifications navigateur (Android) ──"
if [ -z "$(lire VAPID_PRIVATE_KEY)" ]; then
  echo "  Génération de la paire VAPID…"
  vapid="$(node ../scripts/generate-vapid-keys.mjs 2>/dev/null || true)"
  pub="$(echo "$vapid" | grep -E '^NEXT_PUBLIC_VAPID_PUBLIC_KEY=' | cut -d= -f2-)"
  priv="$(echo "$vapid" | grep -E '^VAPID_PRIVATE_KEY=' | cut -d= -f2-)"
  if [ -n "$pub" ] && [ -n "$priv" ]; then
    ecrire NEXT_PUBLIC_VAPID_PUBLIC_KEY "$pub"
    ecrire VAPID_PRIVATE_KEY "$priv"
    ecrire VAPID_SUBJECT "mailto:$(lire TLS_EMAIL)"
    echo "  Fait."
  else
    echo "  Échec — lancez « npm run keys:vapid » à la racine et reportez les clés."
  fi
else
  echo "  Déjà en place."
fi

echo
echo "✓ $ENV_FILE prêt (droits 600)."
echo "  Vérifiez DOMAIN et SITE_URL, puis :  ./scripts/up.sh"
