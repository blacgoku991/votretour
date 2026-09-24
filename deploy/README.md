# VotreTour sur votre propre serveur

Tout tourne chez vous : base de données, authentification, temps réel,
application, certificat TLS. Aucun compte Supabase, aucun compte Vercel.

---

## Ce qu'il vous faut

| | Minimum | Confortable |
|---|---|---|
| Mémoire | **2 Go** | 4 Go |
| Processeur | 1 cœur | 2 cœurs |
| Disque | 20 Go | 40 Go |
| Système | Debian 12 ou Ubuntu 22.04+ | idem |

Un VPS à 5 €/mois suffit pour quelques dizaines de commerces. La pile
tourne en six conteneurs : PostgreSQL, GoTrue, PostgREST, Realtime,
l'application et Caddy. Les services Storage, Studio, Edge Functions et
le pooler de Supabase ne sont pas installés : VotreTour ne s'en sert pas.

**Un nom de domaine** est obligatoire. Son enregistrement DNS `A` doit
pointer vers l'IP du serveur **avant** de démarrer : Let's Encrypt
vérifie le domaine, et sans certificat rien ne marche — ni les
notifications, ni la programmation NFC, ni l'App Clip.

---

## 1. Préparer le serveur

Connectez-vous en SSH, puis :

```bash
# Docker
curl -fsSL https://get.docker.com | sh

# Pare-feu : on n'ouvre que SSH et le web
apt install -y ufw git
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable
```

> Aucun port de base de données n'est exposé : PostgreSQL n'écoute que
> sur le réseau interne des conteneurs. C'est voulu.

## 2. Récupérer le code

```bash
git clone https://github.com/blacgoku991/votretour.git /opt/votretour
cd /opt/votretour/deploy
```

## 3. Configurer

```bash
./scripts/bootstrap.sh
```

Le script demande votre domaine et votre adresse, puis génère tous les
secrets : mot de passe PostgreSQL, secret JWT, clés `anon` et
`service_role`, clés Realtime, poivre de session, secret des tâches
planifiées, paire VAPID pour les notifications Android, secret des
passes Apple Wallet (`WALLET_AUTH_SECRET`).

Relançable sans danger : il ne régénère jamais un secret déjà en place.

> **Ne changez plus `JWT_SECRET` ni `SESSION_HASH_SECRET` après la mise
> en service.** Le premier invaliderait toutes les sessions
> professionnelles et les clés qui en dérivent ; le second sortirait de
> la file tous les clients en attente.

## 4. Démarrer

```bash
./scripts/up.sh
```

Le script construit l'image, démarre la base et GoTrue, attend que
GoTrue ait créé le schéma d'authentification, applique les 13
migrations, puis lance le reste.

Comptez 5 à 10 minutes la première fois — la compilation de
l'application est le plus long. Le certificat arrive dans la minute qui
suit.

## 5. Créer votre commerce

Ouvrez `https://votre-domaine.fr/inscription` et suivez l'onboarding.
Il se termine sur **« Votre file est prête »** avec votre QR code.

Pour accéder à l'espace plateforme, passez votre compte en super-admin :

```bash
docker compose exec db psql -U postgres -d votretour \
  -c "update profiles set is_platform_admin = true where email = 'vous@exemple.fr';"
```

`https://votre-domaine.fr/admin` s'ouvre alors.

---

## Tester

Suivez le **§15 de `SETUP.md`** — le scénario complet en 19 étapes.
En résumé, avec deux téléphones :

1. Téléphone pro : connexion → **File** → **Ouvrir la file**
2. Téléphone client : scannez le QR → prénom → **Rejoindre la file**
3. Le prénom apparaît côté pro, le client voit **1 personne devant vous**
4. Client : **Me prévenir quand c'est mon tour** → Autoriser
5. Pro : **Démarrer** puis **Terminer** → le client reçoit la notification
6. Pro : **Terminer** → **Merci pour votre visite** + avis Google

Pour tester seul, ouvrez le client en navigation privée.

**Les plaques NFC :** `SETUP.md` §13. Depuis Chrome sur Android, le
produit écrit les tags lui-même et les relit pour vérifier.

---

## Exploitation

### Sauvegardes

```bash
crontab -e
```
```
0 3 * * * /opt/votretour/deploy/scripts/backup.sh >> /var/log/vt-backup.log 2>&1
```

Les sauvegardes vont dans `deploy/sauvegardes/`, compressées, gardées 30
jours. Le script vérifie que le fichier produit est lisible : une
sauvegarde vide serait signalée, pas enregistrée en silence.

**Essayez la restauration une fois, avant d'en avoir besoin** — sur une
copie du serveur, pas en production :

```bash
./scripts/restore.sh sauvegardes/votretour_2026-09-22_03h00.sql.gz
```

Copiez les sauvegardes ailleurs qu'ici. Un serveur perdu emporte ses
sauvegardes avec lui.

### Mise à jour

```bash
cd /opt/votretour/deploy && ./scripts/update.sh
```

Sauvegarde, `git pull`, reconstruction, migrations, redémarrage.

### Passes Wallet (facultatif)

Le client peut garder son ticket dans Apple Wallet ou Google Wallet,
mis à jour sur l'écran verrouillé. Tout se règle dans `.env`, bloc
**PASSES WALLET** : `APPLE_WALLET_*` (les cinq lignes produites par
`scripts/wallet-apple-import.sh` sur le Mac qui a exporté le certificat)
et `GOOGLE_WALLET_*` (Issuer ID, clé du compte de service en base64,
mode `demo` puis `production`). Puis :

```bash
docker compose up -d app
```

Aucun conteneur de plus : le conteneur `cron` vide déjà la file d'envoi
Wallet chaque minute. Sans ces valeurs, aucun bouton n'apparaît ; la
carte **Passes Wallet** de `/admin` dit ce qui manque, et alerte 30
jours avant l'expiration annuelle du certificat Apple. Pas à pas :
**§18 de `SETUP.md`**.

### Journaux

```bash
docker compose logs -f app        # l'application
docker compose logs -f realtime   # le temps réel
docker compose ps                 # l'état de santé
curl -s https://votre-domaine.fr/api/health
```

`/api/health` répond `{"status":"ok"}` si la base répond, `503` sinon.
Branchez-y votre supervision.

---

## Choix d'architecture, et pourquoi

**Caddy à la place de Kong.** Supabase livre Kong ou Envoy comme
passerelle. Caddy fait déjà le certificat : autant qu'il fasse aussi
l'aiguillage. Un conteneur de moins, et celui qui consommait le plus de
mémoire.

**PostgreSQL standard plutôt que l'image `supabase/postgres`.** Plus
légère, et surtout : c'est la version contre laquelle les 125 assertions
SQL du projet ont été vérifiées. `init/01-roles.sql` crée les rôles et
les fonctions `auth.*` que les services attendent.

**`/rest/v1` fermé depuis l'extérieur.** Le navigateur ne parle jamais
directement à PostgREST dans VotreTour : il passe par les actions
serveur, et n'utilise Supabase que pour l'authentification et le temps
réel. Caddy renvoie donc 404 sur `/rest/v1` pour tout appel venu
d'Internet. Si vous ajoutez un jour du code qui lit la base depuis le
navigateur, retirez le bloc `@externe` du `Caddyfile`.

**Le domaine résout vers Caddy depuis l'intérieur.** Un alias réseau
fait que les appels du serveur à sa propre API ne ressortent pas sur
Internet, tout en gardant un certificat valide. Sans cela il faudrait
compter sur le retour en épingle du serveur, que beaucoup d'hébergeurs
ne font pas.

---

## Ce qui coince le plus souvent

| Symptôme | Cause |
|---|---|
| Pas de certificat | Le DNS `A` ne pointe pas encore vers le serveur, ou le port 80 est fermé. `docker compose logs caddy` |
| `realtime` redémarre en boucle | `SECRET_KEY_BASE` ne fait pas 64 caractères, ou `REALTIME_DB_ENC_KEY` pas 16. Relancez `bootstrap.sh` sur un `.env` vidé de ses secrets |
| La file n'avance pas toute seule | `wal_level` n'est pas `logical`. `docker compose exec db psql -U postgres -c "show wal_level"` |
| Connexion impossible | `SITE_URL` ne correspond pas au domaine réellement servi. Corrigez, puis `./scripts/up.sh` |
| Erreur 500 partout | `docker compose logs app`. Presque toujours un secret manquant dans `.env` |
| Pas de courriel de confirmation | Normal sans SMTP. `MAILER_AUTOCONFIRM=true` active les comptes directement |
| Mémoire saturée | Ajoutez 2 Go d'échange : `fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile` |

---

## Ce qui reste à votre charge

Auto-héberger, c'est reprendre ce que Supabase et Vercel faisaient pour
vous :

- **Les sauvegardes.** Personne ne les fera à votre place. Mettez le
  cron, et copiez les fichiers hors du serveur.
- **Les mises à jour de sécurité** du système : `apt update && apt upgrade`.
- **La surveillance.** Si le serveur tombe un samedi matin, les files
  s'arrêtent. `/api/health` est là pour qu'un service externe vous
  prévienne.
- **La montée en charge.** Un seul serveur, donc une seule panne
  possible. Pour plusieurs dizaines de commerces actifs en même temps,
  prévoyez 4 Go et surveillez la mémoire de Realtime, qui croît avec le
  nombre de WebSocket ouverts.
