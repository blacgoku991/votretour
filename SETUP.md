# VotreTour — du code au test réel

Ce guide vous emmène d'un dépôt cloné jusqu'à un vrai client qui approche son
iPhone d'une plaque NFC chez un vrai barbier.

Il est écrit pour être suivi **dans l'ordre**, une étape après l'autre. Chaque
section indique ce que vous devez obtenir avant de passer à la suivante.

**Temps réaliste :**

| Étape | Durée | Bloquant ? |
|---|---|---|
| 1 à 4 — Supabase, local, Vercel | 45 min | — |
| 5 — Web Push (Android) | 10 min | — |
| 6 à 11 — Apple, App Clip, APNs | 2 à 4 h | compte Apple Developer payant |
| 12 à 14 — Avis Google, NFC, QR | 30 min | — |
| 15 — Le scénario complet | 20 min | — |

Le produit **fonctionne entièrement sans les étapes 6 à 11** : les clients
Android et les iPhone en navigateur rejoignent la file et voient leur position
en direct. L'App Clip et les notifications iPhone sont un ajout, pas un
prérequis.

---

## Table des matières

1. [Avant de commencer](#1-avant-de-commencer)
2. [Supabase](#2-supabase)
3. [Lancer le site en local](#3-lancer-le-site-en-local)
4. [Vercel et votre domaine](#4-vercel-et-votre-domaine)
5. [Notifications navigateur (Android)](#5-notifications-navigateur-android)
6. [Apple Developer : identifiants et capacités](#6-apple-developer--identifiants-et-capacités)
7. [La clé APNs](#7-la-clé-apns)
8. [Le projet Xcode](#8-le-projet-xcode)
9. [Associer le domaine à l'App Clip](#9-associer-le-domaine-à-lapp-clip)
10. [Tester l'App Clip sur un vrai iPhone](#10-tester-lapp-clip-sur-un-vrai-iphone)
11. [App Store Connect, TestFlight et publication](#11-app-store-connect-testflight-et-publication)
12. [Le lien d'avis Google](#12-le-lien-davis-google)
13. [Les tags NFC](#13-les-tags-nfc)
14. [Les QR codes](#14-les-qr-codes)
15. [Le scénario de test complet](#15-le-scénario-de-test-complet)
16. [Stripe (facultatif)](#16-stripe-facultatif)
17. [Tâches planifiées](#17-tâches-planifiées)
18. [Dépannage](#18-dépannage)

---

## 1. Avant de commencer

### Ce qu'il vous faut

| | Obligatoire | Pour quoi |
|---|---|---|
| Node.js 20+ | oui | construire et lancer le site |
| Un compte Supabase | oui | base de données, authentification, temps réel |
| Un compte Vercel | oui (ou tout hébergeur Node) | mettre le site en ligne |
| Un nom de domaine | oui | les plaques, et l'association Apple |
| Un Mac avec Xcode 15+ | pour l'App Clip | compiler l'application iOS |
| Un compte Apple Developer (99 $/an) | pour l'App Clip | App Clips, APNs, App Store Connect |
| Un compte Stripe | non | facturer vos clients |

### Cloner et installer

```bash
git clone <votre-dépôt> votretour
cd votretour
npm install
```

Vérifiez que tout compile avant d'aller plus loin :

```bash
npm run typecheck
npm run test
```

---

## 2. Supabase

### 2.1 Créer le projet

1. Allez sur **[supabase.com/dashboard](https://supabase.com/dashboard)** →
   **New project**.
2. Nom : `votretour`. Choisissez une région **proche de vos commerces** —
   `eu-west-3` (Paris) ou `eu-central-1` (Francfort) pour la France. La latence
   du temps réel s'entend : un client voit sa place bouger d'autant plus vite.
3. Notez le **mot de passe de la base** dans votre gestionnaire de mots de
   passe. Vous en aurez besoin pour les migrations.
4. Attendez la fin du provisionnement (1 à 2 minutes).

### 2.2 Récupérer les clés

**Project Settings → API**. Trois valeurs :

| Champ Supabase | Variable | Secrète ? |
|---|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` | non |
| `anon` `public` | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | non |
| `service_role` `secret` | `SUPABASE_SERVICE_ROLE_KEY` | **oui** |

> ⚠️ La clé `service_role` contourne la sécurité au niveau ligne. Elle ne doit
> **jamais** être préfixée `NEXT_PUBLIC_`, ni apparaître dans le dépôt, ni dans
> un fichier livré au navigateur. Si elle fuite, régénérez-la immédiatement
> depuis **Project Settings → API → Rotate**.

### 2.3 Appliquer les migrations

**Option A — la CLI Supabase (recommandé).**

```bash
npm install -g supabase
supabase login
supabase link --project-ref <votre-ref-de-projet>   # visible dans l'URL du dashboard
supabase db push
```

`supabase db push` applique les 12 migrations dans l'ordre. Comptez une
vingtaine de secondes.

**Option B — l'éditeur SQL.**

Ouvrez **SQL Editor** dans le dashboard et exécutez les fichiers de
`supabase/migrations/` **dans l'ordre alphabétique**, un par un :

```
20260101000001_extensions_enums.sql
20260101000002_tenancy.sql
20260101000003_queues.sql
20260101000004_plates_notifications.sql
20260101000005_billing_admin.sql
20260101000006_queue_engine.sql
20260101000007_queue_api.sql
20260101000008_queue_actions.sql
20260101000009_snapshots_maintenance.sql
20260101000010_rls.sql
20260101000011_provisioning.sql
20260101000012_seed_plans.sql
```

L'ordre compte : une fonction référence les types créés par la migration
précédente.

### 2.4 Vérifier que tout est en place

Dans **SQL Editor**, collez :

```sql
-- Les tables (27 attendues)
select count(*) as tables
from pg_tables where schemaname = 'public';

-- La sécurité au niveau ligne est active PARTOUT
select tablename, rowsecurity
from pg_tables where schemaname = 'public' and not rowsecurity;
-- ↑ doit ne renvoyer AUCUNE ligne

-- Les policies
select tablename, count(*) as policies
from pg_policies where schemaname = 'public'
group by tablename order by tablename;

-- Les offres sont chargées
select code, name, max_staff, max_plates from public.plans order by sort_order;
```

Attendu : 27 tables, aucune table sans RLS, trois offres (`starter`, `pro`,
`business`).

**Le test décisif** — vérifiez qu'un rôle navigateur ne voit rien :

```sql
set local role anon;
select count(*) from public.queue_entries;
-- ↑ doit échouer avec « permission denied for table queue_entries »
reset role;
```

Si cette requête **réussit**, arrêtez tout : la migration `…_rls.sql` n'a pas
été appliquée.

### 2.5 Activer le temps réel

1. **Database → Replication** (ou **Realtime → Policies** selon la version du
   dashboard).
2. Vérifiez que la publication `supabase_realtime` contient
   **`queue_entries`** et **`queues`**. La migration `…_rls.sql` les y ajoute
   déjà ; cet écran ne sert qu'à le confirmer.
3. **Project Settings → Realtime** : laissez **Broadcast** activé. C'est le
   canal qu'utilisent les clients — sans lui, ils retombent sur
   l'interrogation périodique (le produit continue de fonctionner, mais
   l'avancement se voit avec quelques secondes de retard).

Pour vérifier :

```sql
select tablename from pg_publication_tables where pubname = 'supabase_realtime';
```

### 2.6 Les buckets de stockage

Le produit fonctionne **sans aucun bucket** : les QR codes sont générés à la
volée, et les logos sont facultatifs. Si vous voulez permettre aux commerces
d'envoyer un logo :

1. **Storage → New bucket** → nom `logos`, cochez **Public bucket**.
2. Ajoutez une policy d'écriture réservée aux membres de l'organisation :

```sql
create policy "membres peuvent envoyer un logo"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'logos'
  and public.is_org_member((storage.foldername(name))[1]::uuid)
);
```

Le chemin attendu est alors `logos/<organization_id>/<fichier>`.

### 2.7 Réglages d'authentification

**Authentication → Providers → Email** :

- **Confirm email** : activez-le en production. En développement, le désactiver
  évite d'avoir à cliquer un lien à chaque essai.
- **Authentication → URL Configuration → Site URL** : mettez votre domaine
  (`https://votretour.app`).
- **Redirect URLs** : ajoutez `https://votre-domaine/auth/callback` et, pour le
  développement, `http://localhost:3000/auth/callback`.

### ✅ Avant de continuer

Vous devez avoir : les 3 clés Supabase, 27 tables, aucune table sans RLS, et
`anon` qui se fait refuser l'accès à `queue_entries`.

---

## 3. Lancer le site en local

### 3.1 Les variables d'environnement

```bash
cp apps/web/.env.example apps/web/.env.local
```

Ouvrez `apps/web/.env.local` et renseignez au minimum :

```bash
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOi...
NEXT_PUBLIC_SITE_URL=http://localhost:3000
SESSION_HASH_SECRET=<générez-le>
```

Générez le secret de hachage **une seule fois** :

```bash
openssl rand -base64 48
```

> ⚠️ Ce secret poivre les jetons de session des clients. **Ne le changez
> jamais** une fois en production : le modifier déconnecterait instantanément
> tous les clients actuellement dans une file.

### 3.2 Démarrer

```bash
npm run dev
```

Ouvrez **http://localhost:3000**. Vous devez voir la page d'accueil, avec une
file qui avance toute seule dans la maquette de droite.

### 3.3 Créer votre premier commerce

1. **Ouvrir ma file** → créez un compte.
2. L'onboarding vous demande le nom du commerce, l'activité, l'équipe, le mode
   de file, votre lien d'avis Google et vos horaires.
3. Le dernier écran affiche **votre QR code et l'URL de votre plaque**.
4. Cliquez **Ouvrir la file maintenant**, puis **Tester comme un client** :
   l'onglet qui s'ouvre est exactement ce que verra votre client.

Vous avez maintenant une file fonctionnelle en local.

---

## 4. Vercel et votre domaine

### 4.1 Connecter le dépôt

1. **[vercel.com/new](https://vercel.com/new)** → importez votre dépôt Git.
2. **Root Directory** : laissez la racine du dépôt. Vercel détecte le workspace
   npm et construit `apps/web` grâce au script `build` de la racine.
   - Si la détection échoue, réglez explicitement :
     - Build Command : `npm run build`
     - Output Directory : `apps/web/.next`
     - Install Command : `npm install`

### 4.2 Les variables d'environnement

**Project Settings → Environment Variables**. Ajoutez, pour **Production** ET
**Preview** :

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY        ← marquez-la « Sensitive »
NEXT_PUBLIC_SITE_URL             ← https://votre-domaine (sans / final)
SESSION_HASH_SECRET              ← marquez-la « Sensitive »
CRON_SECRET                      ← openssl rand -hex 32
```

Les blocs Web Push, APNs et Stripe viendront aux étapes suivantes.

### 4.3 Le domaine

1. **Project Settings → Domains** → **Add** → votre domaine.
2. Chez votre registrar, créez les enregistrements DNS que Vercel affiche
   (en général un `A` sur `76.76.21.21` pour l'apex et un `CNAME` sur
   `cname.vercel-dns.com` pour `www`).
3. Attendez que Vercel affiche **Valid Configuration** et émette le certificat
   TLS.

> ⚠️ Apple exige **HTTPS avec un certificat valide** pour l'association de
> domaine. Un certificat auto-signé ou un domaine en `.local` ne fonctionnera
> pas.

### 4.4 Déployer et vérifier

Poussez sur votre branche principale : Vercel construit et déploie.

```bash
# La page d'accueil répond
curl -sI https://votre-domaine | head -1

# Le fichier d'association Apple est servi en JSON, sans redirection
curl -sI https://votre-domaine/.well-known/apple-app-site-association
# ↑ HTTP/2 200, content-type: application/json

# Le service worker est servi avec le bon type
curl -sI https://votre-domaine/sw.js | grep -i content-type
```

### 4.5 Mettez à jour Supabase

Retournez dans **Supabase → Authentication → URL Configuration** et remplacez
`Site URL` par votre domaine de production.

### ✅ Avant de continuer

Le site est en ligne, votre domaine répond en HTTPS, et
`/.well-known/apple-app-site-association` renvoie du JSON.

---

## 5. Notifications navigateur (Android)

C'est le canal le plus rapide à mettre en place, et il couvre Android ainsi que
les iPhone dont le site a été ajouté à l'écran d'accueil.

### 5.1 Générer les clés VAPID

```bash
npm run keys:vapid
```

La commande affiche :

```
NEXT_PUBLIC_VAPID_PUBLIC_KEY=BAIb7xsRWeup...
VAPID_PRIVATE_KEY=XJFrKtj91iPL...
VAPID_SUBJECT=mailto:contact@votre-domaine.fr
```

Copiez les trois lignes dans `.env.local` **et** dans Vercel. Remplacez
l'adresse par une vraie adresse de contact : les services push des navigateurs
s'en servent pour vous joindre en cas de problème.

> ⚠️ Ne régénérez pas ces clés une fois en production : tous les abonnements
> existants deviendraient invalides.

### 5.2 Faut-il Firebase ?

**Non.** Web Push est un standard : Chrome, Firefox et Safari l'implémentent
nativement avec VAPID. Firebase Cloud Messaging n'apporterait qu'une couche
supplémentaire entre vous et le navigateur.

Si vous décidez un jour de publier une application Android native, c'est à ce
moment-là que FCM deviendra pertinent : le schéma prévoit déjà le canal `fcm`
dans `notification_subscriptions`.

### 5.3 Vérifier

1. Sur un **téléphone Android**, ouvrez l'URL de votre plaque.
2. Rejoignez la file.
3. Touchez **« Me prévenir quand c'est mon tour »** → acceptez la permission.
4. Le bandeau doit passer à **« Vous serez prévenu »**.
5. Depuis votre tableau de bord, faites avancer la file jusqu'à ce qu'il ne
   reste qu'une personne devant ce client.
6. La notification arrive, même écran verrouillé.
7. **Tableau de bord → Notifications** : la ligne doit être marquée *Remise au
   fournisseur*.

> **iPhone sans App Clip.** Safari n'autorise le Web Push que si le site a été
> ajouté à l'écran d'accueil (Partager → Sur l'écran d'accueil). L'écran client
> le détecte et affiche une phrase honnête plutôt qu'une promesse qu'il ne peut
> pas tenir. C'est précisément le trou que l'App Clip vient combler.

### ✅ Avant de continuer

Une notification réelle est arrivée sur un vrai téléphone Android, et la page
Notifications en porte la trace.

---

## 6. Apple Developer : identifiants et capacités

À partir d'ici, il vous faut un **compte Apple Developer payant** (99 $/an) et
un **Mac avec Xcode 15 ou plus**.

### 6.1 Choisissez vos identifiants maintenant

Notez-les : ils reviennent dans six écrans différents et **doivent être
rigoureusement identiques partout**.

```
Team ID           : ABCDE12345             (Membership details)
App               : app.votretour.ios
App Clip          : app.votretour.ios.Clip  ← le bundle de l'app + « .Clip »
Groupe d'app      : group.app.votretour
Domaine           : votretour.app           ← sans https://, sans / final
```

> ⚠️ Le bundle de l'App Clip **doit** commencer par celui de l'application,
> suivi d'un suffixe. Apple le vérifie. `app.votretour.clip` serait refusé ;
> `app.votretour.ios.Clip` est correct.

### 6.2 L'App ID de l'application

**[developer.apple.com/account](https://developer.apple.com/account)** →
**Certificates, Identifiers & Profiles** → **Identifiers** → **+**

1. **App IDs** → **App**
2. Description : `VotreTour`
3. Bundle ID : **Explicit** → `app.votretour.ios`
4. Cochez ces capacités :
   - ☑ **App Groups**
   - ☑ **Associated Domains**
   - ☑ **Push Notifications**
5. **Continue** → **Register**

### 6.3 L'App ID de l'App Clip

**Identifiers** → **+** → **App IDs** → **App**

1. Description : `VotreTour App Clip`
2. Bundle ID : **Explicit** → `app.votretour.ios.Clip`
3. Cochez :
   - ☑ **App Groups**
   - ☑ **Associated Domains**
   - ☑ **Push Notifications**
   - ☑ **On Demand Install Capable (App Clips)**
4. **Continue** → **Register**

> La capacité **On Demand Install Capable** est ce qui fait de cet identifiant
> un App Clip. Si elle est absente, Xcode refusera d'embarquer la cible.

### 6.4 Le groupe d'applications

**Identifiers** → filtrez sur **App Groups** → **+**

1. Description : `VotreTour partagé`
2. Identifier : `group.app.votretour`
3. **Register**

Puis **rattachez-le aux deux App IDs** : ouvrez chacun, cochez **App Groups**,
**Edit**, sélectionnez `group.app.votretour`, **Save**.

C'est ce groupe qui permet à l'application complète de retrouver le ticket
ouvert dans l'App Clip. Sans lui, un client qui installe l'application après
coup perdrait sa place.

### ✅ Avant de continuer

Deux App IDs enregistrés avec les bonnes capacités, un App Group rattaché aux
deux.

---

## 7. La clé APNs

Une **seule** clé suffit pour l'application et l'App Clip, en développement
comme en production.

**Certificates, Identifiers & Profiles** → **Keys** → **+**

1. Key Name : `VotreTour APNs`
2. Cochez **Apple Push Notifications service (APNs)**
3. **Configure** → **Environment: Sandbox & Production** → **Save**
4. **Continue** → **Register**
5. **Download** — le fichier `AuthKey_XXXXXXXXXX.p8`

> ⚠️ **Ce fichier ne peut être téléchargé qu'une seule fois.** Mettez-le
> immédiatement dans votre gestionnaire de mots de passe. Si vous le perdez, il
> faut révoquer la clé et en créer une nouvelle.

Notez aussi le **Key ID** (les 10 caractères dans le nom du fichier) et votre
**Team ID**.

### 7.1 Renseigner les variables

Le contenu du `.p8` est un PEM multiligne. Deux façons de le passer :

**En base64 (le plus simple) :**

```bash
base64 -i AuthKey_XXXXXXXXXX.p8 | tr -d '\n'
```

Collez le résultat dans `APNS_PRIVATE_KEY` — le code le décode tout seul.

**En PEM avec des `\n` littéraux :**

```bash
awk 'BEGIN{ORS="\\n"} {print}' AuthKey_XXXXXXXXXX.p8
```

Dans `.env.local` **et** dans Vercel :

```bash
APNS_KEY_ID=XXXXXXXXXX
APNS_TEAM_ID=ABCDE12345
APNS_PRIVATE_KEY=<base64 ou PEM>
APNS_BUNDLE_ID=app.votretour.ios
APNS_CLIP_BUNDLE_ID=app.votretour.ios.Clip
APNS_ENVIRONMENT=sandbox          # production pour TestFlight et l'App Store

APPLE_APP_ID=ABCDE12345.app.votretour.ios
APPLE_CLIP_APP_ID=ABCDE12345.app.votretour.ios.Clip
```

> **`APNS_ENVIRONMENT` est le piège classique.** Une build compilée depuis
> Xcode enregistre un jeton **sandbox**. Une build TestFlight ou App Store
> enregistre un jeton **production**. Un jeton envoyé au mauvais serveur est
> rejeté avec `BadDeviceToken`. Gardez `sandbox` tant que vous testez depuis
> Xcode, et basculez sur `production` au moment de passer par TestFlight.

### 7.2 Vérifier que la clé est lue

Redéployez, puis ouvrez **/admin** avec un compte super-admin (voir §15.1) :
la ligne **APNs (App Clip iPhone)** doit afficher **Configuré**.

---

## 8. Le projet Xcode

Le projet est décrit dans `ios/project.yml` et généré par **XcodeGen**. Cela
évite de versionner un `.pbxproj` de 4 000 lignes que personne ne peut relire.

### 8.1 Générer le projet

```bash
brew install xcodegen
cd ios
cp Config/Local.xcconfig.example Config/Local.xcconfig
```

Ouvrez `Config/Local.xcconfig` et renseignez **vos** valeurs :

```
DEVELOPMENT_TEAM = ABCDE12345
VT_BUNDLE_ID = app.votretour.ios
VT_CLIP_BUNDLE_ID = app.votretour.ios.Clip
VT_ASSOCIATED_DOMAIN = votretour.app
VT_API_BASE_URL = https://votretour.app
VT_APP_GROUP = group.app.votretour
```

Puis :

```bash
xcodegen generate
open VotreTour.xcodeproj
```

### 8.2 Vérifier ce que Xcode a compris

Dans Xcode, contrôlez ces cinq points — c'est là que 90 % des problèmes se
jouent :

1. **Deux cibles** existent : `VotreTour` et `VotreTourClip`.
2. Cible **VotreTour** → **Build Phases** → une phase **Embed App Clips**
   contient `VotreTourClip.app`.
   *Si elle manque :* **+ → New Copy Files Phase**, Destination **Products
   Directory**, Subpath `$(CONTENTS_FOLDER_PATH)/AppClips`, cochez **Code Sign
   On Copy**, et glissez-y `VotreTourClip.app`.
3. Cible **VotreTourClip** → **Signing & Capabilities** → la capacité
   **On Demand Install Capable** est présente.
4. Les deux cibles portent **Associated Domains**, **Push Notifications** et
   **App Groups**, avec les bonnes valeurs.
5. **Signing** : votre équipe est sélectionnée sur les deux cibles, et Xcode
   affiche un profil valide (pas de triangle jaune).

### 8.3 Premier lancement

1. Branchez un **iPhone physique** (le simulateur ne délivre pas de jeton APNs).
2. Schéma **VotreTourClip** → votre appareil → **⌘R**.
3. L'App Clip s'ouvre sur *« Approchez votre téléphone de la plaque »* — c'est
   normal : il n'a pas encore d'URL d'invocation.

### 8.4 Injecter une URL d'invocation pour déboguer

Apple prévoit une variable d'environnement exactement pour cela.

1. **Product → Scheme → Edit Scheme** → schéma **VotreTourClip**
2. **Run** → onglet **Arguments**
3. Dans **Environment Variables**, la variable `_XCAppClipURL` doit exister
   (XcodeGen et le modèle Xcode l'ajoutent). Sinon, créez-la.
4. Valeur : l'URL d'une de vos plaques, par exemple
   `https://votretour.app/e/barber-house-comptoir`
5. Cochez la case à gauche, **Close**, puis **⌘R**.

L'App Clip s'ouvre directement sur la file de ce commerce. **La carte App Clip
ne s'affiche pas** dans ce mode : c'est attendu, elle apparaîtra à l'étape 10.

> Pour tester le cas « l'App Clip est rouvert depuis une notification », Apple
> ne fournit **aucune** URL d'invocation. Décochez `_XCAppClipURL` et relancez :
> l'App Clip doit retrouver la dernière file grâce à l'état mémorisé dans le
> groupe d'applications. C'est un cas à tester, pas une curiosité.

### 8.5 Surveiller la taille

Un App Clip qui accepte les invocations physiques — NFC, QR, App Clip Codes,
c'est-à-dire exactement notre usage — est plafonné par Apple à **15 Mo
décompressés**.

Le projet est conçu pour rester très en dessous : aucune dépendance externe,
aucune police embarquée, le temps réel parlé directement en WebSocket. Pour
mesurer :

1. **Product → Archive**
2. **Distribute App** → **Ad Hoc** ou **Development**, avec **App Thinning**
   activé
3. Ouvrez `App Thinning Size Report.txt` dans le dossier exporté et lisez la
   taille **décompressée** de chaque variante.

---

## 9. Associer le domaine à l'App Clip

C'est ce qui autorise iOS à ouvrir **votre** App Clip depuis **votre** domaine.

### 9.1 Le fichier est déjà servi

L'application expose `/.well-known/apple-app-site-association` dynamiquement,
à partir de `APPLE_APP_ID` et `APPLE_CLIP_APP_ID`. Une fois ces variables
renseignées et le site redéployé :

```bash
curl -s https://votre-domaine/.well-known/apple-app-site-association | python3 -m json.tool
```

Vous devez lire :

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["ABCDE12345.app.votretour.ios"],
        "components": [
          { "/": "/e/*", "comment": "Rejoindre la file d'un établissement" }
        ]
      }
    ]
  },
  "appclips": {
    "apps": ["ABCDE12345.app.votretour.ios.Clip"]
  }
}
```

### 9.2 Les trois conditions d'Apple

| Condition | Comment vérifier |
|---|---|
| Servi en `application/json` | `curl -sI … \| grep -i content-type` |
| **Aucune** redirection | `curl -sIL … \| grep -c HTTP` doit valoir `1` |
| Accessible sans authentification | ouvrez l'URL en navigation privée |

De plus, **votre serveur doit laisser passer les agents `AASA-Bot` et
`CFNetwork`**. Vercel n'en bloque aucun par défaut ; si vous avez ajouté un
pare-feu applicatif ou une protection anti-robot, mettez-les en liste
d'autorisation.

```bash
curl -s -A "AASA-Bot" -o /dev/null -w "%{http_code}\n" \
  https://votre-domaine/.well-known/apple-app-site-association
# ↑ doit afficher 200
```

### 9.3 Vider le cache d'association sur l'iPhone

iOS met le fichier en cache. Après une modification :

**Réglages → Développeur → Associated Domains Development** → activez-le, puis
désinstallez et réinstallez l'application. En développement, le mode
*Development* fait contourner le CDN d'Apple et interroge votre serveur
directement.

---

## 10. Tester l'App Clip sur un vrai iPhone

**C'est l'étape la plus importante du guide — et la bonne nouvelle, c'est
qu'elle ne demande ni App Store Connect, ni publication, ni même le fichier
d'association.**

Apple fournit un mécanisme fait exactement pour ça : les **Local Experiences**.

### 10.1 Créer une expérience locale

Sur l'iPhone de test :

1. **Réglages → Développeur → App Clips Testing → Local Experience**
   *(le menu Développeur apparaît dès qu'un appareil a été connecté à Xcode)*
2. **Register Local Experience**
3. Remplissez :
   - **URL Prefix** : `https://votretour.app/e/barber-house-comptoir`
     *(l'URL exacte de votre plaque)*
   - **Bundle ID** : `app.votretour.ios.Clip`
   - **Title** : `Barber House`
   - **Subtitle** : `Rejoignez la file en deux secondes`
   - **Action** : `Open`
   - **Header Image** : n'importe quelle image de votre pellicule
4. **Save**

### 10.2 Lancer depuis un QR code

1. Dans votre tableau de bord → **Plaques & QR** → affichez le QR de la plaque.
2. Sur l'iPhone, ouvrez l'**appareil photo** et visez le QR.
3. La **carte App Clip** apparaît en bas de l'écran avec votre titre et votre
   image.
4. Touchez **Ouvrir** → l'App Clip se lance sur la file de ce commerce.

### 10.3 Lancer depuis un tag NFC

1. Programmez un tag avec l'URL de la plaque (voir §13).
2. Approchez l'iPhone du tag, écran allumé et déverrouillé.
3. La même carte App Clip apparaît.

> **Le détail qui piège :** l'URL du tag doit correspondre **exactement** au
> préfixe déclaré dans l'expérience locale. `https://votretour.app/e/xyz` et
> `https://www.votretour.app/e/xyz` sont deux URL différentes pour iOS.

### 10.4 Vérifier les notifications

1. Lancez l'App Clip depuis le QR ou le NFC.
2. Observez la carte App Clip : elle porte une mention indiquant que cette App
   Clip peut envoyer des notifications. C'est l'effet de
   `NSAppClipRequestEphemeralUserNotification` — **aucune alerte de permission
   n'est présentée**, l'autorisation est accordée par défaut et le client peut
   la refuser d'un geste sur la carte.
3. Rejoignez la file. Le bandeau doit afficher **« Vous serez prévenu »**.
   S'il affiche « Suivi à l'écran », c'est que le serveur n'a pas confirmé
   pouvoir pousser — vérifiez la section APNs de `/admin`.
4. **Verrouillez l'iPhone.**
5. Depuis le tableau de bord, faites avancer la file.
6. La notification arrive. L'iPhone vibre.
7. Touchez-la : l'App Clip se rouvre **sur le bon commerce**, grâce au
   `target-content-id`.

### 10.5 Les 8 heures

Apple n'accorde les notifications éphémères que pendant **8 heures après chaque
lancement** de l'App Clip. C'est une limite de la plateforme, pas du produit.

Concrètement :
- Une file d'attente dure quelques dizaines de minutes : la fenêtre est
  largement suffisante.
- Chaque relance de l'App Clip — depuis la plaque, ou depuis une notification —
  **repart pour 8 heures**.
- Au-delà, le serveur considère l'abonnement mort et cesse d'essayer. La tâche
  planifiée de l'étape 17 nettoie ces abonnements.

### 10.6 Tester le cas « application complète installée »

Apple exige que l'application complète sache traiter **toutes** les invocations
que l'App Clip traite : dès qu'elle est installée, elle le remplace.

1. Installez l'application complète (schéma `VotreTour`, **⌘R**).
2. Rescannez le QR de la plaque.
3. C'est maintenant **l'application** qui s'ouvre, sur la même file — et le
   ticket en cours est retrouvé grâce au groupe d'applications partagé.

---

## 11. App Store Connect, TestFlight et publication

Les expériences locales suffisent au développement. Pour que **n'importe quel
iPhone** ouvre votre App Clip, il faut passer par App Store Connect.

### 11.1 Créer la fiche

1. **[appstoreconnect.apple.com](https://appstoreconnect.apple.com)** →
   **Mes apps** → **+** → **Nouvelle app**
2. Plateforme **iOS**, nom, langue principale, Bundle ID
   `app.votretour.ios`, SKU au choix.

### 11.2 Envoyer une build

1. Dans Xcode : schéma **VotreTour** (pas l'App Clip), destination
   **Any iOS Device (arm64)**.
2. Incrémentez `CURRENT_PROJECT_VERSION` dans `ios/project.yml`, puis
   `xcodegen generate`.
3. **Product → Archive**
4. **Distribute App** → **App Store Connect** → **Upload**
5. Attendez le traitement (10 à 30 minutes) et l'e-mail de confirmation.

> L'App Clip est embarqué dans l'archive de l'application : vous n'envoyez
> **qu'une seule** build.

### 11.3 L'expérience App Clip par défaut

**App Store Connect → votre app → la version → section App Clip**

1. **Image d'en-tête** (1800 × 1200 px) — c'est ce que le client voit sur la
   carte App Clip. Soignez-la : c'est votre première impression.
2. **Sous-titre** : *« Rejoignez la file en deux secondes »*
3. **Verbe du bouton** : `Ouvrir`

App Store Connect génère alors un **lien App Clip par défaut**, de la forme
`https://appclip.apple.com/id?p=app.votretour.ios.Clip`. Il fonctionne sans
aucune configuration serveur, mais il est **identique pour tous vos
commerces** — il ne suffit donc pas à notre usage.

### 11.4 Les expériences avancées — **une par commerce**

C'est le mécanisme qui fait qu'**un seul App Clip sert N établissements**.

Dans la section App Clip → **Expériences App Clip avancées** → **+**

Pour **chaque plaque** :

| Champ | Valeur |
|---|---|
| URL | `https://votretour.app/e/barber-house-comptoir` |
| Titre | `Barber House` |
| Sous-titre | `Rejoignez la file` |
| Image d'en-tête | le visuel du commerce |
| Verbe | `Ouvrir` |
| Emplacement | facultatif — permet l'apparition dans Plans et Siri |

Répétez pour `garage-92-accueil`, `salon-x-comptoir`, et ainsi de suite.

> **Le lien entre cette étape et les notifications.** Chaque push que le serveur
> envoie porte un `target-content-id` égal à cette URL. C'est ce qui permet à
> iOS de router la notification vers la bonne instance d'App Clip quand un
> client a ouvert plusieurs commerces dans la même journée. Si une URL
> d'invocation n'est pas déclarée ici, la notification correspondante ne sera
> pas correctement acheminée.

App Store Connect vérifie votre fichier d'association au moment de la création
de chaque expérience. **App Clip → Voir le statut** indique si la vérification
a réussi.

### 11.5 TestFlight

1. **TestFlight** → sélectionnez la build → remplissez les informations de test.
2. Ajoutez des testeurs internes.
3. **Basculez `APNS_ENVIRONMENT` sur `production` dans Vercel** et redéployez :
   une build TestFlight enregistre un jeton de production.

### 11.6 Publication

L'App Clip est examiné **en même temps** que l'application. Prévoyez dans les
notes de revue :

- une URL de plaque de démonstration que le relecteur peut ouvrir ;
- une explication en une ligne : *« l'application sert plusieurs commerces,
  chaque URL d'invocation correspond à un établissement »*.

Une fois l'application publiée, le lien App Clip par défaut et les expériences
avancées deviennent actifs pour tout le monde.

### 11.7 Diagnostic sur l'appareil

Après publication, Apple fournit un outil intégré :

**Réglages → Développeur → App Clips Testing → Diagnostics** → entrez une URL
de plaque. iOS indique si l'expérience est trouvée et si l'association est
valide.

---

## 12. Le lien d'avis Google

C'est la fin de la boucle : quand le professionnel appuie sur **TERMINER**, le
client reçoit un remerciement avec un bouton qui ouvre **directement** la fiche
d'avis de CET établissement.

### 12.1 Récupérer le lien

**Méthode recommandée — depuis votre fiche d'établissement :**

1. Connectez-vous à **[business.google.com](https://business.google.com)** avec
   le compte qui gère l'établissement.
2. Sélectionnez l'établissement.
3. Cherchez **Demander des avis** (ou **Ask for reviews**).
4. Google affiche un lien court de la forme `https://g.page/r/XXXXXXXXXXXX/review`.
5. Copiez-le.

**Méthode de secours — depuis la recherche Google :**

1. Cherchez votre établissement sur Google.
2. Dans le panneau de droite, **Avis Google** → **Rédiger un avis**.
3. Copiez l'URL de la fenêtre qui s'ouvre. Elle ressemble à
   `https://search.google.com/local/writereview?placeid=ChIJ…`.

Les deux formats fonctionnent. Le lien `g.page` est plus court et plus lisible
si vous l'imprimez.

### 12.2 Le renseigner

**Tableau de bord → Réglages → Avis Google** → collez le lien → **Enregistrer**.

Un bouton **Ouvrir** apparaît juste en dessous : cliquez-le pour vérifier qu'il
mène bien chez **vous**. C'est l'erreur la plus fréquente — un lien copié
depuis la fiche d'un concurrent ou d'un autre de vos établissements.

Vous pouvez aussi le saisir pendant l'onboarding, à l'étape *Avis Google*.

### 12.3 Un lien par établissement

Le lien est stocké **sur l'établissement**, pas sur l'organisation. Une chaîne
de trois salons a trois liens différents, et chaque client reçoit celui du
salon où il est réellement passé.

### 12.4 Ce que le produit ne fait pas

Le lien est proposé à **tous** les clients dont le passage s'est terminé, sans
aucun filtrage sur une satisfaction supposée. Il n'existe pas de réglage pour
ne le montrer qu'aux clients contents : cette pratique est contraire aux règles
de Google sur les avis, et le produit ne l'implémente pas.

Vous pouvez en revanche désactiver complètement la proposition :
**Réglages → Données personnelles → Proposer l'avis Google en fin de passage**.

---

## 13. Les tags NFC

### 13.1 Quel tag acheter

| Modèle | Mémoire | URL max | Prix indicatif | Verdict |
|---|---|---|---|---|
| **NTAG213** | 144 o | ~130 caractères | ~0,30 € | **Suffisant** pour la plupart des URL |
| **NTAG215** | 504 o | ~490 caractères | ~0,50 € | **Le bon choix** — marge confortable |
| NTAG216 | 888 o | ~870 caractères | ~0,80 € | Surdimensionné |

Prenez des **NTAG215**. La différence de prix est négligeable et vous ne serez
jamais à l'étroit si un nom d'établissement s'allonge.

**Format :** des autocollants ronds de 25 à 30 mm, ou des cartes PVC. Pour un
comptoir, la carte PVC tient mieux dans le temps.

**⚠️ Le métal.** Un tag NFC collé directement sur une surface métallique ne
fonctionne pas : le métal absorbe le champ. Prenez des tags **« on-metal »**
(avec ferrite intégrée) si votre comptoir est en inox ou en aluminium.

### 13.2 Récupérer l'URL

**Tableau de bord → Plaques & QR** → sélectionnez la plaque →
**Programmer le tag NFC** → **Copier**.

L'URL a cette forme :

```
https://votretour.app/e/barber-house-comptoir
```

C'est **exactement** la même URL que celle encodée dans le QR code. Les deux
supports ouvrent rigoureusement la même expérience.

### 13.3 Programmer le tag depuis VotreTour (aucune application)

VotreTour écrit les tags lui-même, depuis le navigateur. C'est la méthode à
privilégier : l'URL n'est jamais recopiée à la main, le tag est **relu après
écriture** pour vérifier qu'il porte bien la bonne adresse, et la
programmation est enregistrée (date, auteur, numéro de série du tag).

1. Ouvrez le tableau de bord **sur un téléphone Android**, dans **Chrome**.
2. **Plaques & QR** → sélectionnez la plaque → **Programmer la plaque**.
3. **Commencer** → acceptez la demande d'accès NFC → approchez le tag du dos
   du téléphone, vers le haut, près de l'appareil photo.
4. Retirez le tag puis reposez-le : VotreTour le relit et affiche
   **« Relue et vérifiée »**.

La même fonction existe dans l'espace plateforme (**Plaques**), pour préparer
un lot de tags avant de les envoyer à un commerçant.

**Option « Verrouiller le tag après écriture ».** Cochée, le tag devient
définitivement inscriptible en lecture seule : plus personne ne pourra le
réécrire, vous compris. À réserver aux plaques en libre accès, une fois
l'adresse vérifiée.

> **Où ça marche, où ça ne marche pas.** L'écriture NFC depuis le navigateur
> est une fonction d'Android : **Chrome 89+, Edge, Opera Mobile 64+, Samsung
> Internet 15+**. Elle n'existe sur **aucun navigateur d'iPhone ou d'iPad** —
> Apple ne l'implémente pas dans WebKit, et Chrome iOS utilise WebKit. Elle
> n'existe sur **aucun ordinateur**. Dans ces cas, VotreTour ne cache pas le
> bouton : il affiche pourquoi, et donne la marche à suivre ci-dessous.

### 13.4 Programmer le tag avec NFC Tools (iPhone, ou sans Android sous la main)

**Sur iPhone comme sur Android :**

1. Installez **NFC Tools** (wakdev), gratuite sur l'App Store et le Play Store.
2. Onglet **Écrire** → **Ajouter un enregistrement** → **URL**
3. Collez l'URL copiée depuis le tableau de bord → **OK** →
   **Écrire / 1 enregistrement**
4. Approchez le tag du dos du téléphone.

L'enregistrement doit être de type **URI**. Un enregistrement « texte »
afficherait l'adresse au lieu de l'ouvrir.

**Vérifiez toujours** : scannez le tag avec un autre téléphone. Il doit ouvrir
votre page de file, et non une page d'erreur.

**Pour un lot de tags :** NFC Tools propose un mode d'écriture en série. Si vous
posez la même plaque à plusieurs endroits d'un même commerce, utilisez la
**même** URL. Si vous voulez distinguer les emplacements — vitrine, comptoir,
poste 2 — créez une plaque par emplacement dans le tableau de bord : vous
saurez alors laquelle convertit le mieux.

### 13.5 Verrouiller le tag (recommandé en production)

Depuis VotreTour : cochez **Verrouiller le tag après écriture** avant de
commencer. Depuis NFC Tools : onglet **Autres** → **Verrouiller le tag**.

Un tag verrouillé ne peut plus être réécrit. C'est irréversible, mais cela
empêche qu'un client mal intentionné remplace votre URL par la sienne sur un
tag posé en libre accès.

### 13.6 Vérifier

**Sur iPhone** (iPhone XS et plus récents — lecture NFC en arrière-plan) :

1. Écran **allumé et déverrouillé**.
2. Approchez le **haut du dos** de l'iPhone du tag.
3. Une bannière apparaît en haut de l'écran.
4. Touchez-la : votre file s'ouvre — ou la carte App Clip, si vous avez suivi
   l'étape 10.

**Sur Android :**

1. Vérifiez que le NFC est activé (**Réglages → Connexions → NFC**).
2. Écran allumé, approchez le tag du **milieu du dos** du téléphone.
3. L'URL s'ouvre directement dans le navigateur.

**Si rien ne se passe :**

| Symptôme | Cause probable |
|---|---|
| Aucune réaction, iPhone | Écran verrouillé, ou iPhone antérieur au XS |
| Aucune réaction, Android | NFC désactivé, ou antenne mal positionnée — l'antenne est souvent en haut sur iPhone, au centre sur Android |
| Ça marche parfois | Tag posé sur du métal, ou trop fin |
| Ouvre une autre URL | Le tag contenait déjà un enregistrement — réécrivez-le |

### 13.7 Où poser la plaque

- **Au comptoir, à hauteur de main**, là où le client s'arrête naturellement.
- **Pas derrière une vitre épaisse** : le NFC porte à 2–4 cm.
- Une courte phrase au-dessus aide beaucoup : *« Pas envie d'attendre debout ?
  Approchez votre téléphone. »* — c'est exactement ce que dit l'affiche
  imprimable générée par le produit.

---

### 13.8 Faire fabriquer des plaques en série

Pour commander des plaques à un fabricant — gravées d'avance, puis
attribuées à chaque commerce à la livraison :

1. **Super-admin → Stock fournisseur → Générer un lot de liens.** Donnez
   un nom au lot, choisissez le nombre (100 par exemple), validez.
2. Sur la page du lot, **Télécharger le CSV** : une ligne par plaque avec
   son numéro, le code à imprimer en petit (`RV-XXXXX-XXXXX`) et l'URL à
   graver dans la puce NFC **et** à encoder dans le QR. La **Liste d'URL**
   (une par ligne) convient à la plupart des encodeurs NFC. La **Planche
   QR** imprimable sert de bon à tirer.
3. Envoyez le fichier au fabricant. Précisez : enregistrement NDEF de type
   **URI**, puce NTAG213 ou plus, et le code `RV-…` imprimé lisiblement
   sur chaque plaque.
4. À la livraison, attribuez chaque plaque : **Stock fournisseur →
   Attribuer une plaque livrée**, par son code, son numéro, ou — le plus
   rapide — **en la scannant avec votre téléphone connecté au
   super-admin** : l'écran propose « Attribuer cette plaque ».

Tant qu'une plaque n'est pas attribuée, un client qui la scanne lit
« Cette plaque n'est pas encore activée — présentez-vous au comptoir ».

**Changer une plaque de commerce.** Retrouvez-la, puis **Réattribuer à
une autre société** : le lien gravé ne change pas, il ouvre simplement la
file du nouveau commerce. L'ancien commerce perd la plaque et son
historique de scans. **Libérer** la remet en stock.

> **Le domaine est gravé dans la plaque.** Les URL contiennent
> `NEXT_PUBLIC_SITE_URL` (par exemple `https://rangvia.com`). Générez les
> lots seulement une fois ce domaine définitif, et ne le changez plus
> ensuite — ou gardez une redirection permanente de l'ancien vers le
> nouveau. Sur iPhone, déclarez l'expérience App Clip avancée sur le
> **préfixe** `https://rangvia.com/e/` : toutes les plaques, même celles
> générées plus tard, ouvrent alors l'App Clip.

### 13.9 Mentions légales

Les pages CGU et Confidentialité, et la page `/mentions-legales`, lisent
l'identité de l'éditeur dans l'environnement du serveur, à chaque
requête. Renseignez dans `deploy/.env` les variables `LEGAL_*` (société,
forme, adresse, SIRET, e-mail de contact, hébergeur, date de mise à
jour ; voir `deploy/.env.example`), puis :

```bash
cd /opt/votretour/deploy && docker compose up -d app
```

Rien n'est inventé : une information vide ne s'affiche pas, et la page
`/mentions-legales` (avec son lien dans le pied de page) n'apparaît que
lorsque société, adresse, SIRET, e-mail et hébergeur sont tous
renseignés. Elle est obligatoire en France avant d'accueillir des
clients payants.

## 14. Les QR codes

### 14.1 Les obtenir

**Tableau de bord → Plaques & QR** → sélectionnez la plaque :

| Bouton | Résultat |
|---|---|
| **QR en SVG** | vectoriel, pour l'impression grand format |
| **QR en PNG** | 1200 px, pour le web ou une impression courante |
| **Affiche à imprimer** | une A5 complète, avec le nom du commerce, la phrase d'accroche et le QR |
| **Copier le lien** | l'URL brute, pour vos propres supports |

Le QR est généré avec une **correction d'erreur de niveau H** : il reste lisible
même sali, rayé ou partiellement masqué — ce qui arrive vite sur un comptoir.

### 14.2 Imprimer

| Support | Taille minimale du QR | Remarque |
|---|---|---|
| Chevalet de comptoir | 3 × 3 cm | la plus courante |
| Affiche A5 | 5 × 5 cm | utilisez l'affiche générée |
| Vitrine (lu depuis la rue) | 10 × 10 cm | ajoutez 1 cm de marge blanche |

**Règles à ne pas enfreindre :**

- **Du noir sur du blanc.** N'inversez pas les couleurs : beaucoup de lecteurs
  refusent un QR clair sur fond sombre.
- **Gardez la marge blanche** autour du code — c'est elle qui permet au lecteur
  de le détecter.
- **N'étirez pas** le QR : il doit rester parfaitement carré.
- Papier **mat** plutôt que brillant : les reflets gênent la lecture.

### 14.3 Vérifier

1. Imprimez le QR à sa taille définitive.
2. Scannez-le avec l'appareil photo d'un iPhone **et** d'un Android.
3. Vérifiez que la page qui s'ouvre porte le **bon nom d'établissement** —
   c'est le contrôle qui compte, surtout si vous gérez plusieurs adresses.
4. Scannez-le à la distance réelle d'usage, avec l'éclairage réel du lieu.

### 14.4 Associer un QR au bon établissement

Chaque plaque appartient à un établissement, et le QR encode son URL unique. Il
n'y a rien à « associer » manuellement : créez une plaque par emplacement, et
le lien est fait.

Deux réglages utiles, dans le détail de la plaque :

- **File rattachée** — si l'établissement a plusieurs files.
- **Professionnel dédié** — une plaque posée au poste d'un coiffeur précis fait
  rejoindre **sa** file directement, sans que le client ait à choisir.

---

## 15. Le scénario de test complet

Voici le parcours à dérouler de bout en bout. Prévoyez **deux téléphones** :
un pour le professionnel, un pour le client.

### 15.1 Se donner les droits plateforme

Pour accéder à `/admin`, passez votre compte en super-admin depuis le
**SQL Editor** de Supabase :

```sql
update public.profiles
set is_platform_admin = true
where email = 'vous@votre-domaine.fr';
```

C'est volontairement impossible depuis l'interface : une policy RLS empêche un
compte de s'auto-promouvoir.

### 15.2 Le parcours

| # | Action | Ce que vous devez observer |
|---|---|---|
| 1 | Créez un compte et suivez l'onboarding | L'écran final affiche votre QR et l'URL de la plaque |
| 2 | **Ouvrir la file maintenant** | Le bandeau passe au vert : *« La file est ouverte »* |
| 3 | **Plaques & QR** → affichez le QR | Le QR s'affiche, l'URL est copiable |
| 4 | Sur le téléphone client, scannez le QR | La page du commerce s'ouvre, avec le nombre de personnes dans la file |
| 5 | Saisissez un prénom → **Rejoindre la file** | L'écran bascule : *« N personnes devant vous »*, avec votre latte en vermillon |
| 6 | Sur le téléphone pro, ouvrez **File** | Le client apparaît **immédiatement**, sans rafraîchir |
| 7 | Second téléphone, ou **Ajouter une personne au comptoir** | Il apparaît aussi, derrière le premier |
| 8 | — | Le premier client voit toujours le même nombre : le second est derrière lui |
| 9 | Côté pro : **Démarrer** puis **Terminer** sur le client en cours | Le suivant passe automatiquement en prestation |
| 10 | Regardez l'écran client | Le chiffre **tombe** d'un cran, les lattes descendent, le téléphone vibre |
| 11 | Attendez la notification | *« Plus qu'une personne devant vous. Commencez à revenir. »* — vérifiez la trace dans **Notifications** |
| 12 | Côté client : **Je suis de retour** | Le bouton confirme *« Le salon sait que vous revenez »* |
| 13 | Côté pro | La pastille du client passe à **Revient**, immédiatement |
| 14 | Côté pro : **Démarrer** sur ce client | Son écran affiche **« C'est votre tour »**, en plein vermillon |
| 15 | Côté pro : **Terminer** | — |
| 16 | Côté pro | Le client disparaît de la file active |
| 17 | Côté client | *« Merci pour votre visite »* |
| 18 | Touchez **Laisser un avis Google** | — |
| 19 | — | La fiche d'avis du **bon** établissement s'ouvre |

Si les 19 étapes passent, le produit fonctionne.

### 15.3 Les cas limites à tester aussi

| Cas | Comment | Attendu |
|---|---|---|
| Perte de réseau | Mode avion pendant 30 s côté client, puis réactivez | L'écran garde la dernière position, puis se resynchronise tout seul |
| Retour sur la page | Fermez l'onglet, rouvrez l'URL de la plaque | Le ticket est retrouvé automatiquement |
| Double scan | Rescannez la plaque en étant déjà dans la file | Le même ticket est renvoyé, pas un second |
| Client absent | **Absent** sur le client en cours | Il recule du nombre de places réglé, et ses notifications sont réarmées |
| File fermée | **Fermer** côté pro, puis scannez | *« La file est fermée pour le moment »* |
| Étanchéité | Créez un second compte et un second commerce | Chacun ne voit que sa propre file |

### 15.4 La vérification automatique

```bash
./scripts/verify-db.sh
```

Rejoue les 12 migrations sur une base vierge puis 98 assertions SQL, dont le
scénario ci-dessus et l'isolation multi-tenant vue depuis les rôles `anon`,
`authenticated` et `service_role`.

---

## 16. Stripe (facultatif)

Sans Stripe, toutes les organisations restent en période d'essai et l'interface
le dit franchement. Le produit est pleinement utilisable ainsi.

### 16.1 Créer les produits

1. **[dashboard.stripe.com](https://dashboard.stripe.com)** →
   **Produits** → **+ Ajouter un produit**
2. Un produit par offre : *Starter*, *Pro*, *Business*.
3. Pour chacun, créez **deux tarifs récurrents** : mensuel et annuel.
4. Notez les identifiants de tarif — ils commencent par `price_`.

### 16.2 Les clés

**Développeurs → Clés API** :

```bash
STRIPE_SECRET_KEY=sk_live_…                     # ou sk_test_ pour commencer
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_…
```

### 16.3 Le webhook

1. **Développeurs → Webhooks** → **+ Ajouter un point de terminaison**
2. URL : `https://votre-domaine/api/stripe/webhook`
3. Événements à écouter :
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_failed`
4. Copiez le **secret de signature** (`whsec_…`) dans `STRIPE_WEBHOOK_SECRET`.

La signature est vérifiée sur le corps **brut** de la requête. Sans elle,
n'importe qui pourrait offrir l'offre Business à n'importe quelle organisation.

### 16.4 Renseigner les tarifs

**`/admin` → Offres & abonnements** → **Modifier** sur chaque offre → collez
les identifiants `price_…`.

Tant qu'une offre n'a pas de tarif Stripe, elle affiche **Tarif Stripe
manquant** et le bouton de paiement reste indisponible — plutôt que de mener
vers une erreur.

### 16.5 Tester

En mode test, utilisez la carte `4242 4242 4242 4242`, une date future et
n'importe quel CVC. Vérifiez ensuite que l'offre a bien changé dans
**Abonnement**.

---

## 17. Tâches planifiées

Deux tâches entretiennent le système. `vercel.json` les déclare déjà :

| Tâche | Fréquence | Rôle |
|---|---|---|
| `/api/cron/maintenance` | toutes les 15 min | expire les tickets oubliés, applique la purge RGPD, désactive les abonnements push morts |
| `/api/cron/notifications` | toutes les 5 min | filet de sécurité : renvoie les notifications restées en attente |

Elles sont protégées par `CRON_SECRET`, comparé en **temps constant** — une
comparaison naïve laisserait fuiter le secret caractère par caractère.

### 17.1 Sur Vercel

Rien à faire : les tâches sont créées au premier déploiement et Vercel envoie
automatiquement `CRON_SECRET` en en-tête `Authorization`.

Vérifiez dans **Project → Cron Jobs** qu'elles apparaissent, puis déclenchez-en
une à la main pour confirmer.

### 17.2 Ailleurs

Avec `cron` :

```cron
*/15 * * * * curl -sS -H "Authorization: Bearer $CRON_SECRET" https://votre-domaine/api/cron/maintenance
*/5  * * * * curl -sS -H "Authorization: Bearer $CRON_SECRET" https://votre-domaine/api/cron/notifications
```

### 17.3 La purge RGPD

Chaque établissement choisit sa durée de conservation
(**Réglages → Données personnelles**, entre 1 et 730 jours). Au-delà :

- les prénoms des clients sont effacés ;
- les sessions d'appareil sont supprimées ;
- les abonnements push morts sont nettoyés ;
- seules subsistent des statistiques agrégées, qui restent exactes car elles ne
  reposent sur aucun prénom.

---

## 18. Dépannage

### La file

| Symptôme | Cause et remède |
|---|---|
| *« permission denied for table … »* | La migration `…_rls.sql` n'a pas été appliquée, ou `service_role` n'a pas ses privilèges. Rejouez-la. |
| La position ne bouge pas en direct | Le canal Broadcast est coupé. L'écran retombe sur l'interrogation (15 s). Vérifiez **Project Settings → Realtime**, et que `NEXT_PUBLIC_SUPABASE_URL` est correct. |
| Le pro ne voit pas les nouveaux clients | Vérifiez que `queue_entries` est dans la publication `supabase_realtime` (§2.5). |
| Un client apparaît deux fois | Impossible : un index unique partiel l'empêche. Si vous le constatez, c'est un second appareil. |

### Les notifications

| Symptôme | Cause et remède |
|---|---|
| **APNs : non configuré** dans `/admin` | Une des trois variables manque. Le `.p8` doit être en base64 **ou** en PEM avec des `\n`. |
| `BadDeviceToken` | `APNS_ENVIRONMENT` ne correspond pas à la build. Xcode → `sandbox` ; TestFlight et App Store → `production`. |
| `DeviceTokenNotForTopic` | `APNS_CLIP_BUNDLE_ID` ne correspond pas au bundle réel de l'App Clip. |
| `TooManyProviderTokenUpdates` | Apple limite la régénération du jeton fournisseur. Le code le met en cache 50 min ; ce message signale un redémarrage en boucle du serveur. |
| Rien ne part sur Android | Clés VAPID absentes ou permission refusée. La page **Notifications** montre le motif exact. |
| Rien sur iPhone en Safari | Attendu : Safari exige que le site soit ajouté à l'écran d'accueil. C'est le rôle de l'App Clip. |

### L'App Clip

| Symptôme | Cause et remède |
|---|---|
| Le QR ouvre Safari au lieu de l'App Clip | Aucune expérience (locale ou avancée) ne correspond à cette URL. Vérifiez le préfixe **au caractère près**. |
| *« App Clip indisponible »* | L'association de domaine a échoué. Vérifiez §9.2, puis videz le cache (§9.3). |
| Xcode refuse d'embarquer l'App Clip | La capacité **On Demand Install Capable** manque sur l'App ID, ou le bundle du Clip ne commence pas par celui de l'app. |
| L'App Clip s'ouvre vide | Lancement sans URL d'invocation — cas normal depuis une notification. Il doit reprendre la dernière file ; si ce n'est pas le cas, vérifiez que l'App Group est rattaché aux **deux** App IDs. |
| Build rejetée pour sa taille | L'App Clip dépasse 15 Mo décompressés. Mesurez avec le rapport d'app thinning (§8.5). |

### Les tests

```bash
npm run typecheck        # types
npm run test             # 37 tests unitaires
./scripts/verify-db.sh   # migrations + 98 assertions SQL
npm run build            # build de production
```

---

## Ce qui reste à votre charge

Le code est complet. Ces éléments demandent **vos** comptes et ne peuvent pas
être automatisés :

| # | À faire | Sans cela |
|---|---|---|
| 1 | Créer le projet Supabase et appliquer les migrations | Rien ne fonctionne |
| 2 | Renseigner les 5 variables du noyau | L'application ne démarre pas |
| 3 | Brancher un domaine en HTTPS | Pas d'App Clip possible |
| 4 | Générer les clés VAPID | Pas de notification Android |
| 5 | Compte Apple Developer, App IDs, clé APNs | Pas d'App Clip ni de push iPhone |
| 6 | Déclarer une expérience avancée **par commerce** dans App Store Connect | Les plaques n'ouvrent pas l'App Clip |
| 7 | Publier l'app sur l'App Store | L'App Clip reste limité aux expériences locales de test |
| 8 | Coller le lien d'avis Google de chaque établissement | Pas de bouton d'avis en fin de passage |
| 9 | Acheter et programmer les tags NFC | Le QR fonctionne seul, mais pas le sans-contact |
| 10 | Stripe, si vous facturez | Tout reste en période d'essai |
