#!/bin/sh
# ---------------------------------------------------------------------------
# Apple Wallet : .p12 du certificat Pass Type ID → lignes prêtes à coller
# dans deploy/.env.
#
# À lancer SUR LE MAC qui a exporté le certificat (Trousseau → Mes
# certificats → « Pass Type ID: … » → Exporter, avec un mot de passe) :
#
#     sh scripts/wallet-apple-import.sh pass.p12 > wallet-apple.env
#
# Les cinq lignes APPLE_WALLET_* sortent sur la sortie standard ; tout le
# reste (contrôles, échéance, empreintes) sur la sortie d'erreur. Rien
# n'est envoyé nulle part : le script ne télécharge que le certificat
# intermédiaire public d'Apple (WWDR), depuis apple.com.
#
# Ce que fait le script :
#   1. lit le certificat et la clé du .p12 (OpenSSL 3 : -legacy si le
#      Trousseau a chiffré en RC2 ; LibreSSL de macOS : sans option) ;
#   2. contrôle le certificat : UID (identifiant du type de pass), OU
#      (Team ID), clé ↔ certificat, dates ;
#   3. télécharge le WWDR de la génération qui a émis le certificat (G4
#      pour tout certificat émis depuis 2022), vérifie qu'il est bien
#      l'émetteur, qu'il est signé par « Apple Root CA » (racine lue dans
#      le trousseau système du Mac, ou fournie), dont l'EMPREINTE doit être
#      celle publiée par Apple : un nom ne prouve rien, n'importe qui peut
#      fabriquer une racine qui s'appelle « Apple Root CA » ;
#   4. RECHIFFRE la clé (PKCS#8, AES-256) avec une phrase de passe neuve,
#      tirée au hasard (hexadécimal : sans caractère qui gênerait un
#      .env), au lieu de réutiliser le mot de passe du .p12 ;
#   5. écrit chaque PEM en base64 sur une seule ligne.
#
# Variables facultatives (poste sans accès à apple.com, vérification
# manuelle) : WWDR_PEM_FILE (WWDR déjà téléchargé, PEM ou DER),
# APPLE_ROOT_PEM_FILE (racine Apple Root CA, PEM ou DER ; son empreinte
# est comparée à celle d'Apple), P12_PASSWORD (sinon demandé sans écho).
# ALLOW_TEST_ROOT=1 accepte une autre racine (AC de scripts/wallet-dev-
# certs.sh, essais locaux) : les lignes produites sont alors refusées par
# un serveur de production, qui épingle la vraie racine.
# ---------------------------------------------------------------------------
set -eu

# Empreinte SHA-256 de « Apple Root CA » (AppleIncRootCertificate.cer,
# https://www.apple.com/certificateauthority/), la même que celle épinglée
# par le serveur (apps/web/src/server/wallet/apple/apple-root.ts).
APPLE_ROOT_SHA256="B0:B1:73:0E:CB:C7:FF:45:05:14:2C:49:F1:29:5E:6E:DA:6B:CA:ED:7E:2C:68:C5:BE:91:B5:A1:10:01:F0:24"

say() { printf '%s\n' "$*" >&2; }
fail() { say ""; say "ÉCHEC : $*"; exit 1; }

if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
  say "Usage : sh scripts/wallet-apple-import.sh pass.p12 > wallet-apple.env"
  exit 2
fi
P12=$1
command -v openssl >/dev/null 2>&1 || fail "openssl introuvable."

umask 077
WORK=$(mktemp -d "${TMPDIR:-/tmp}/rangvia-wallet.XXXXXX")
ECHO_OFF=""
cleanup() {
  # Interrompu (Ctrl-C) pendant la saisie du mot de passe : le terminal
  # retrouve son écho.
  if [ -n "$ECHO_OFF" ] && [ -t 0 ]; then stty echo 2>/dev/null || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

# --- 1. Mot de passe du .p12 -------------------------------------------------
if [ -z "${P12_PASSWORD:-}" ]; then
  printf 'Mot de passe du fichier %s : ' "$P12" >&2
  if [ -t 0 ]; then ECHO_OFF=1; stty -echo; fi
  IFS= read -r P12_PASSWORD || true
  if [ -t 0 ]; then stty echo; ECHO_OFF=""; fi
  say ""
fi
export P12_PASSWORD

# OpenSSL 3 refuse les .p12 du Trousseau (RC2-40) sans -legacy ; LibreSSL
# (openssl par défaut de macOS) ne connaît pas l'option mais les lit.
p12() {
  openssl pkcs12 -in "$P12" -passin env:P12_PASSWORD "$@" 2>/dev/null \
    || openssl pkcs12 -legacy -in "$P12" -passin env:P12_PASSWORD "$@" 2>/dev/null
}

p12 -clcerts -nokeys -out "$WORK/cert.raw" || fail "lecture du .p12 impossible (mot de passe ?)."
p12 -nocerts -nodes -out "$WORK/key.raw" || fail "clé privée absente du .p12."
openssl x509 -in "$WORK/cert.raw" -out "$WORK/cert.pem" 2>/dev/null || fail "certificat illisible dans le .p12."
openssl pkey -in "$WORK/key.raw" -out "$WORK/key.pem" 2>/dev/null || fail "clé privée illisible dans le .p12."
rm -f "$WORK/key.raw" "$WORK/cert.raw"

# --- 2. Certificat Pass Type ID ----------------------------------------------
field() {
  # $1 = sujet ou émetteur (une ligne), $2 = motif du nom de champ
  # (sed -E : l'alternative « | » en expression de base n'existe pas sur macOS)
  # « subject=… » / « issuer=… » d'abord retiré, puis un champ par ligne.
  printf '%s\n' "$1" | sed -E 's/^(subject|issuer) *= *//' | tr ',/' '\n\n' | sed -En "s/^ *($2) *= *//p" | head -n 1
}
SUBJECT=$(openssl x509 -in "$WORK/cert.pem" -noout -subject -nameopt RFC2253 2>/dev/null \
  || openssl x509 -in "$WORK/cert.pem" -noout -subject)
ISSUER=$(openssl x509 -in "$WORK/cert.pem" -noout -issuer -nameopt RFC2253 2>/dev/null \
  || openssl x509 -in "$WORK/cert.pem" -noout -issuer)

PASS_TYPE_ID=$(field "$SUBJECT" 'UID|userId|0\.9\.2342\.19200300\.100\.1\.1')
TEAM_ID=$(field "$SUBJECT" 'OU')
case "$PASS_TYPE_ID" in
  pass.*) ;;
  *) fail "ce n’est pas un certificat Pass Type ID (UID absent ou inattendu : « $PASS_TYPE_ID »)." ;;
esac
printf '%s' "$TEAM_ID" | grep -Eq '^[A-Z0-9]{10}$' || fail "Team ID (OU=) introuvable dans le certificat."

openssl pkey -in "$WORK/key.pem" -noout -text 2>/dev/null | grep -q 'Private-Key' || fail "clé privée illisible."
CERT_KEY=$(openssl x509 -in "$WORK/cert.pem" -noout -pubkey | openssl pkey -pubin -outform DER | openssl dgst -sha256)
PRIV_KEY=$(openssl pkey -in "$WORK/key.pem" -pubout | openssl pkey -pubin -outform DER | openssl dgst -sha256)
[ "$CERT_KEY" = "$PRIV_KEY" ] || fail "la clé privée ne correspond pas au certificat."

openssl x509 -in "$WORK/cert.pem" -noout -checkend 0 >/dev/null || fail "certificat EXPIRÉ : renouvelez-le dans le portail Apple."
END_DATE=$(openssl x509 -in "$WORK/cert.pem" -noout -enddate | sed 's/^notAfter=//')
SOON=""
openssl x509 -in "$WORK/cert.pem" -noout -checkend 2592000 >/dev/null || SOON=" (moins de 30 jours : prévoyez le renouvellement)"

# --- 3. Intermédiaire Apple WWDR ---------------------------------------------
# La génération (G4, G5…) est l'OU de l'émetteur du certificat.
GENERATION=$(field "$ISSUER" 'OU')
case "$GENERATION" in
  G[0-9]) ;;
  *) GENERATION=G4 ;;
esac

to_pem() {
  # PEM ou DER → PEM
  openssl x509 -in "$1" -out "$2" 2>/dev/null || openssl x509 -inform DER -in "$1" -out "$2" 2>/dev/null
}

if [ -n "${WWDR_PEM_FILE:-}" ]; then
  say "WWDR : fichier local $WWDR_PEM_FILE (WWDR_PEM_FILE)."
  to_pem "$WWDR_PEM_FILE" "$WORK/wwdr.pem" || fail "WWDR_PEM_FILE illisible."
else
  command -v curl >/dev/null 2>&1 || fail "curl introuvable (ou fournissez WWDR_PEM_FILE)."
  URL="https://www.apple.com/certificateauthority/AppleWWDRCA$GENERATION.cer"
  say "WWDR : téléchargement de $URL"
  curl -fsSL --proto '=https' --tlsv1.2 -o "$WORK/wwdr.cer" "$URL" || fail "téléchargement du WWDR impossible."
  to_pem "$WORK/wwdr.cer" "$WORK/wwdr.pem" || fail "WWDR téléchargé illisible."
fi

WWDR_SUBJECT=$(openssl x509 -in "$WORK/wwdr.pem" -noout -subject -nameopt RFC2253 2>/dev/null \
  || openssl x509 -in "$WORK/wwdr.pem" -noout -subject)
WWDR_ISSUER=$(openssl x509 -in "$WORK/wwdr.pem" -noout -issuer -nameopt RFC2253 2>/dev/null \
  || openssl x509 -in "$WORK/wwdr.pem" -noout -issuer)
[ "${WWDR_SUBJECT#*=}" = "${ISSUER#*=}" ] || fail "le WWDR ($WWDR_SUBJECT) n’est pas l’émetteur du certificat ($ISSUER)."
[ "$(field "$WWDR_ISSUER" 'CN')" = "Apple Root CA" ] || fail "le WWDR n’est pas émis par Apple Root CA."
openssl x509 -in "$WORK/wwdr.pem" -noout -checkend 0 >/dev/null || fail "WWDR expiré."

# Racine : trousseau système du Mac (source de confiance locale), sinon
# fichier fourni. Jamais une racine prise au même endroit que le WWDR sans
# le dire.
if [ -n "${APPLE_ROOT_PEM_FILE:-}" ]; then
  to_pem "$APPLE_ROOT_PEM_FILE" "$WORK/root.pem" || fail "APPLE_ROOT_PEM_FILE illisible."
  ROOT_SOURCE="fichier $APPLE_ROOT_PEM_FILE"
elif command -v security >/dev/null 2>&1 \
  && security find-certificate -a -c "Apple Root CA" -p /System/Library/Keychains/SystemRootCertificates.keychain > "$WORK/root.all" 2>/dev/null; then
  # Le trousseau peut renvoyer plusieurs « Apple Root CA… » (G2, G3) : on
  # garde celui dont l'EMPREINTE est celle d'Apple Root CA.
  awk -v dir="$WORK" '/BEGIN CERTIFICATE/{n++} {print > (dir "/root." n ".pem")}' "$WORK/root.all"
  for candidate in "$WORK"/root.[0-9]*.pem; do
    FP=$(openssl x509 -in "$candidate" -noout -fingerprint -sha256 2>/dev/null | sed 's/^.*=//' | tr 'a-f' 'A-F' || true)
    if [ "$FP" = "$APPLE_ROOT_SHA256" ]; then cp "$candidate" "$WORK/root.pem"; fi
  done
  [ -f "$WORK/root.pem" ] || fail "Apple Root CA introuvable dans le trousseau système."
  ROOT_SOURCE="trousseau système de macOS"
else
  fail "impossible de lire Apple Root CA (trousseau macOS absent) : fournissez APPLE_ROOT_PEM_FILE."
fi

ROOT_SHA256=$(openssl x509 -in "$WORK/root.pem" -noout -fingerprint -sha256 | sed 's/^.*=//' | tr 'a-f' 'A-F')
ROOT_LABEL="Apple Root CA"
if [ "$ROOT_SHA256" != "$APPLE_ROOT_SHA256" ]; then
  if [ "${ALLOW_TEST_ROOT:-}" = "1" ]; then
    ROOT_LABEL="RACINE DE TEST (ALLOW_TEST_ROOT=1), refusée par un serveur de production"
    say "ATTENTION : la racine ($ROOT_SOURCE) n’est pas Apple Root CA (empreinte $ROOT_SHA256)."
  else
    fail "la racine ($ROOT_SOURCE) n’est pas Apple Root CA : empreinte $ROOT_SHA256, attendue $APPLE_ROOT_SHA256."
  fi
fi

openssl verify -CAfile "$WORK/root.pem" "$WORK/wwdr.pem" >/dev/null 2>&1 \
  || fail "le WWDR ne se vérifie pas avec la racine $ROOT_LABEL ($ROOT_SOURCE)."
openssl verify -CAfile "$WORK/root.pem" -untrusted "$WORK/wwdr.pem" "$WORK/cert.pem" >/dev/null 2>&1 \
  || fail "la chaîne certificat → WWDR → Apple Root CA ne se vérifie pas."

# --- 4. Clé rechiffrée avec une phrase de passe neuve ------------------------
KEY_PASSPHRASE=$(openssl rand -hex 32)
export KEY_PASSPHRASE
openssl pkcs8 -topk8 -v2 aes-256-cbc -in "$WORK/key.pem" -passout env:KEY_PASSPHRASE -out "$WORK/key.enc.pem" \
  || fail "rechiffrement de la clé impossible."
rm -f "$WORK/key.pem"

# --- 5. Sortie ----------------------------------------------------------------
b64() { openssl base64 -A -in "$1"; }

say ""
say "Certificat Pass Type ID : $PASS_TYPE_ID"
say "Team ID (OU=)           : $TEAM_ID (APPLE_WALLET_TEAM_ID peut rester vide)"
say "Expire le               : $END_DATE$SOON"
say "Intermédiaire           : $(field "$WWDR_SUBJECT" 'CN') ($GENERATION), expire le $(openssl x509 -in "$WORK/wwdr.pem" -noout -enddate | sed 's/^notAfter=//')"
say "  empreinte SHA-256     : $(openssl x509 -in "$WORK/wwdr.pem" -noout -fingerprint -sha256 | sed 's/^.*=//')"
say "Racine                  : $ROOT_LABEL ($ROOT_SOURCE)"
say "  empreinte SHA-256     : $ROOT_SHA256"
say ""
say "Lignes à coller dans deploy/.env (puis : docker compose up -d app) :"
say ""

printf 'APPLE_WALLET_PASS_TYPE_ID=%s\n' "$PASS_TYPE_ID"
printf 'APPLE_WALLET_CERT_PEM=%s\n' "$(b64 "$WORK/cert.pem")"
printf 'APPLE_WALLET_KEY_PEM=%s\n' "$(b64 "$WORK/key.enc.pem")"
printf 'APPLE_WALLET_KEY_PASSPHRASE=%s\n' "$KEY_PASSPHRASE"
printf 'APPLE_WALLET_WWDR_PEM=%s\n' "$(b64 "$WORK/wwdr.pem")"

say ""
say "Ces lignes contiennent la clé de signature (chiffrée) et sa phrase de passe :"
say "ne les envoyez ni par e-mail ni par messagerie, et supprimez le fichier une fois collé."
