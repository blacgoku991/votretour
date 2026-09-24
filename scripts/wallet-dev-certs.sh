#!/bin/sh
# ---------------------------------------------------------------------------
# Apple Wallet : AUTORITÉ ET CERTIFICAT DE TEST, pour essayer la chaîne en
# local (distribution, service web, carte du super-admin) sans les vrais
# identifiants Apple.
#
#     sh scripts/wallet-dev-certs.sh [dossier]      # défaut : dossier temporaire
#
# Produit, dans un dossier HORS du dépôt (jamais versionné) :
#   root.pem          fausse « Apple Root CA » (OU : Rangvia, test local)
#   wwdr.pem          faux intermédiaire WWDR, émis par cette racine
#   pass.pem          certificat qui imite un Pass Type ID
#                     (UID=pass.test.rangvia, OU=TESTTEAM01)
#   pass.key.pem      sa clé RSA 2048, chiffrée (PKCS#8, AES-256)
#   wallet-dev.env    les lignes APPLE_WALLET_* correspondantes (base64)
#
# Ces passes se construisent, se signent et se vérifient avec OpenSSL,
# mais AUCUN iPhone ne les acceptera : seule une chaîne émise par Apple
# l'est. Ne mettez JAMAIS ces valeurs en production.
#
# Variables : PASS_TYPE_ID (défaut pass.test.rangvia), TEAM_ID (défaut
# TESTTEAM01), DAYS (validité du certificat, défaut 365).
# ---------------------------------------------------------------------------
set -eu

say() { printf '%s\n' "$*" >&2; }
fail() { say "ÉCHEC : $*"; exit 1; }
command -v openssl >/dev/null 2>&1 || fail "openssl introuvable."

PASS_TYPE_ID=${PASS_TYPE_ID:-pass.test.rangvia}
TEAM_ID=${TEAM_ID:-TESTTEAM01}
DAYS=${DAYS:-365}
printf '%s' "$PASS_TYPE_ID" | grep -Eq '^pass\.[A-Za-z0-9][A-Za-z0-9.-]+$' || fail "PASS_TYPE_ID doit commencer par « pass. »."
printf '%s' "$TEAM_ID" | grep -Eq '^[A-Z0-9]{10}$' || fail "TEAM_ID : 10 capitales ou chiffres."

umask 077
if [ "$#" -ge 1 ]; then
  OUT=$1
  mkdir -p "$OUT"
else
  OUT=$(mktemp -d "${TMPDIR:-/tmp}/rangvia-wallet-dev.XXXXXX")
fi
OUT=$(cd "$OUT" && pwd)

# Garde-fou : des clés de test n'ont rien à faire dans le dépôt.
ROOT=$(git -C "$OUT" rev-parse --show-toplevel 2>/dev/null || true)
if [ -n "$ROOT" ]; then
  fail "$OUT est dans un dépôt git ($ROOT) : choisissez un dossier hors du dépôt."
fi

cd "$OUT"
cat > ext.cnf <<'EOF'
[ca]
basicConstraints = critical, CA:TRUE
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
[intermediate]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
[leaf]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = clientAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid
EOF

say "Racine de test…"
openssl genrsa -out root.key 2048 2>/dev/null
openssl req -new -key root.key -subj "/CN=Apple Root CA/OU=Rangvia - test local, sans valeur/O=Apple Inc./C=US" -out root.csr
openssl x509 -req -in root.csr -signkey root.key -days 3650 -sha256 -extfile ext.cnf -extensions ca -out root.pem 2>/dev/null

say "Intermédiaire WWDR de test…"
openssl genrsa -out wwdr.key 2048 2>/dev/null
openssl req -new -key wwdr.key \
  -subj "/CN=Apple Worldwide Developer Relations Certification Authority/OU=G4/O=Rangvia - test local, sans valeur/C=FR" -out wwdr.csr
openssl x509 -req -in wwdr.csr -CA root.pem -CAkey root.key -CAcreateserial -days 1825 -sha256 \
  -extfile ext.cnf -extensions intermediate -out wwdr.pem 2>/dev/null

say "Certificat Pass Type ID de test ($PASS_TYPE_ID)…"
openssl genrsa -out pass.plain.key 2048 2>/dev/null
openssl req -new -key pass.plain.key \
  -subj "/UID=$PASS_TYPE_ID/CN=Pass Type ID: $PASS_TYPE_ID/OU=$TEAM_ID/O=Rangvia (test local)/C=FR" -out pass.csr
openssl x509 -req -in pass.csr -CA wwdr.pem -CAkey wwdr.key -CAcreateserial -days "$DAYS" -sha256 \
  -extfile ext.cnf -extensions leaf -out pass.pem 2>/dev/null

openssl verify -CAfile root.pem -untrusted wwdr.pem pass.pem >/dev/null || fail "chaîne de test invalide."

KEY_PASSPHRASE=$(openssl rand -hex 32)
export KEY_PASSPHRASE
openssl pkcs8 -topk8 -v2 aes-256-cbc -in pass.plain.key -passout env:KEY_PASSPHRASE -out pass.key.pem
rm -f pass.plain.key root.csr wwdr.csr pass.csr ./*.srl ext.cnf

b64() { openssl base64 -A -in "$1"; }
{
  printf '# Identifiants Apple Wallet de TEST (%s) : jamais en production.\n' "$OUT"
  printf 'APPLE_WALLET_PASS_TYPE_ID=%s\n' "$PASS_TYPE_ID"
  printf 'APPLE_WALLET_CERT_PEM=%s\n' "$(b64 pass.pem)"
  printf 'APPLE_WALLET_KEY_PEM=%s\n' "$(b64 pass.key.pem)"
  printf 'APPLE_WALLET_KEY_PASSPHRASE=%s\n' "$KEY_PASSPHRASE"
  printf 'APPLE_WALLET_WWDR_PEM=%s\n' "$(b64 wwdr.pem)"
} > wallet-dev.env

say ""
say "Prêt : $OUT"
say "  wallet-dev.env : variables à charger dans un serveur de DÉVELOPPEMENT"
say "  root.pem       : racine de test (openssl cms -verify -CAfile root.pem …)"
say "Aucun iPhone n'acceptera ces passes : seule la chaîne d'Apple l'est."
printf '%s\n' "$OUT"
