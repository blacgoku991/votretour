# VotreTour

**La file d'attente qui laisse vos clients partir.**

Un client arrive dans un commerce sans rendez-vous. Il y a quatre personnes
devant lui. Au lieu de rester debout, il approche son téléphone d'une plaque
NFC — ou scanne un QR code — rejoint la file, et sort.

Son écran n'affiche qu'une seule chose : **combien de personnes sont devant
lui**. Quand il ne reste plus qu'une personne, il reçoit une notification :
*« Plus qu'une personne devant vous. Commencez à revenir. »* Puis : *« C'est
votre tour. »* À la fin, le professionnel appuie sur **TERMINER** et le client
reçoit un remerciement avec un bouton qui ouvre directement la fiche d'avis
Google de CET établissement.

Pas de compte. Pas d'application à installer. Pas de SMS payant. Pas de numéro
de ticket type A013.

---

## Ce qu'il y a dans ce dépôt

```
votretour/
├── apps/web/            Next.js 15 — site public, expérience client,
│                        tableau de bord professionnel, espace plateforme,
│                        API et service worker
├── ios/                 Xcode — application iPhone + cible App Clip (SwiftUI)
├── supabase/
│   ├── migrations/      12 migrations : schéma, moteur de file, RLS
│   ├── tests/           suite de tests SQL (98 assertions)
│   └── seed.sql         jeu de démonstration
├── scripts/             vérification de la base, génération des clés VAPID
├── docs/                décisions d'architecture
└── SETUP.md             ⭐ le guide pas-à-pas, du code au test réel
```

## Démarrer

```bash
npm install
cp apps/web/.env.example apps/web/.env.local   # puis renseignez vos clés
npm run dev
```

Le guide complet — Supabase, Vercel, Apple Developer, App Clip, APNs,
Web Push, avis Google, tags NFC et QR — est dans **[SETUP.md](./SETUP.md)**.

## Vérifier

```bash
npm run typecheck          # TypeScript, mode strict
npm run test               # 37 tests unitaires
npm run build              # build de production
./scripts/verify-db.sh     # rejoue les 12 migrations sur une base vierge
                           # puis 98 assertions SQL
```

`verify-db.sh` n'a besoin ni de Docker ni d'un projet Supabase : il recrée
l'environnement Supabase (rôles, schéma `auth`, `auth.uid()`) sur un PostgreSQL
nu, applique toutes les migrations dans l'ordre, et rejoue le scénario complet
— y compris l'isolation multi-tenant vue depuis les rôles `anon`,
`authenticated` et `service_role`.

---

## L'architecture en une page

### Toute la logique de file vit dans PostgreSQL

Ce n'est pas un choix de commodité. Deux employés qui appuient sur TERMINER à
la même seconde, un client qui rescanne la plaque pendant que le professionnel
le fait avancer, une notification qui part deux fois : ce sont des courses, et
elles se règlent là où se trouvent les données.

- Chaque mutation prend un **verrou sur la ligne de file** (`select … for
  update`) : les avancements se sérialisent.
- Les positions sont recalculées **dans la même transaction**, par une fonction
  à fenêtre unique.
- Les notifications sont **réclamées atomiquement**
  (`update … where not (notification_status ? kind) returning`) : deux appels
  concurrents ne peuvent pas produire deux fois le même message.
- Un **index unique partiel** empêche qu'un même appareil occupe deux places
  actives dans la même file.

La couche TypeScript orchestre — authentification, quotas, diffusion, envoi —
mais ne recalcule jamais une position elle-même.

### Deux chemins temps réel, pour deux besoins de confidentialité

| | Canal | Pourquoi |
|---|---|---|
| **Client** | Broadcast Supabase | La table des tickets contient les prénoms des autres personnes. Le navigateur n'y a **aucun accès**. Il reçoit une charge utile construite par le serveur : des identifiants de ticket opaques et un nombre de personnes devant. Chaque appareil y reconnaît le sien parce qu'il est le seul à le connaître. |
| **Professionnel** | Postgres Changes sous RLS, **plus** le Broadcast comme simple signal | Il a le droit de voir les prénoms de SA file. Le Broadcast ne sert qu'à déclencher un rechargement : aucune donnée n'en est lue. Si la réplication logique est coupée, un client qui appuie sur « Je suis de retour » apparaît quand même **immédiatement** au comptoir — c'est précisément le moment où le professionnel en a besoin. |

Le temps réel n'est jamais considéré comme acquis : reconnexion à repli
exponentiel, interrogation de secours, resynchronisation au retour de veille et
au retour du réseau. L'utilisateur ne rafraîchit jamais.

### Isolation multi-tenant

`anon` n'a **aucun privilège** sur aucune table métier. Toute l'expérience
client passe par des routes serveur qui valident le jeton d'appareil, limitent
le débit, et n'utilisent la clé `service_role` que côté serveur.

`authenticated` ne peut que **lire** les données de ses propres organisations —
le strict nécessaire au temps réel du tableau de bord. Les jetons push et les
sessions d'appareil des clients ne sont lisibles par **personne**, pas même par
le commerce concerné. Aucune écriture directe n'est possible depuis un
navigateur : tout passe par des actions serveur qui revérifient l'appartenance
et le rôle.

Ces affirmations sont testées : `supabase/tests/02_rls_isolation.test.sql` se
place réellement dans chaque rôle PostgREST et vérifie qu'un commerce ne voit
jamais la file d'un autre.

### Un seul App Clip, N commerces

Pas un App Clip par boutique : **une** application, **un** App Clip, et c'est
l'URL d'invocation qui détermine l'établissement.

```
https://votre-domaine/e/barber-house   →  Barber House
https://votre-domaine/e/garage-92      →  Garage 92
```

Chaque commerce est déclaré comme *expérience App Clip avancée* dans App Store
Connect. Conformément à la documentation Apple sur les App Clips multi-commerces,
**chaque notification porte un `target-content-id` égal à cette URL** : c'est
iOS qui route le push vers la bonne instance. Un commerce ne peut donc pas
notifier à la place d'un autre.

L'App Clip est écrit **sans aucune dépendance externe** : Apple plafonne sa
taille à 15 Mo décompressés dès lors qu'il accepte les invocations physiques
(NFC, QR, App Clip Codes) — ce qui est précisément notre usage. Le canal temps
réel est donc parlé directement sur le protocole Phoenix via
`URLSessionWebSocketTask`, et la typographie s'appuie sur les axes de chasse
natifs de SF Pro plutôt que sur une police embarquée.

### On ne prétend jamais

- Aucune interface n'affiche « notification envoyée » sans une ligne
  `notification_deliveries` passée à l'état `sent` **par le fournisseur**.
- Quand aucun canal n'est disponible sur l'appareil, l'écran client le dit et
  explique quoi faire à la place.
- Quand une intégration n'est pas configurée, l'interface l'indique au lieu
  d'afficher un bouton qui ne mène nulle part.

---

## Le langage visuel : « Le Rang »

La direction artistique est tirée de l'objet même du produit — une file, des
positions, un ordre qui avance. Trois éléments, utilisés partout :

- **Le rail** — une ligne verticale continue : la file elle-même.
- **La latte** — une barre horizontale accrochée au rail par une encoche : une
  personne. C'est la forme signature du produit.
- **Le volet** — un compteur à lamelle, façon tableau d'affichage de gare. Le
  chiffre ne se remplace pas : il *tombe*.

Quand quelqu'un passe, sa latte se rétracte vers le rail, une impulsion descend
le long du rail, et tout le reste avance d'un cran — avec un retour haptique.
Le client ne lit pas que la file a avancé : il la voit avancer.

Typographie **Archivo** sur le web (axes de graisse et de chasse : interface
resserrée, chiffres de position très larges), **SF Pro** et son axe
`Font.width` sur iOS. Palette encre et os, avec un seul vermillon de signal
pour le « maintenant ». Aucun dégradé, aucun verre dépoli, aucun violet.

Les couleurs des graphiques ne sont pas choisies à l'œil : le couple
catégoriel est validé par script (bande de clarté, chroma, séparation
daltonienne, contraste) contre les deux surfaces réelles du produit.

---

## Pile technique

| Domaine | Choix | Pourquoi |
|---|---|---|
| Web | Next.js 15 (App Router), React 19, TypeScript strict | Rendu serveur pour le premier écran client — il doit s'afficher avant que le client ait rangé son téléphone. Actions serveur pour les mutations. |
| Base | PostgreSQL via Supabase | Le moteur de file a besoin de transactions et de verrous. Les fonctions à fenêtre calculent toutes les positions en une instruction. |
| Temps réel | Supabase Realtime | Broadcast pour les clients, Postgres Changes sous RLS pour les professionnels. |
| Style | CSS Modules + jetons faits main | Pas de Tailwind : le produit a une identité propre, et un utilitaire générique pousse vers un rendu générique. |
| iOS | SwiftUI, zéro dépendance | Contrainte de taille de l'App Clip. |
| Push | APNs en HTTP/2 écrit directement, Web Push VAPID | Pas de service tiers entre nous et Apple. |
| Paiement | Stripe (facultatif) | Sans clé, tout reste en période d'essai et l'interface le dit. |

---

## Licence

Propriétaire. Tous droits réservés.
