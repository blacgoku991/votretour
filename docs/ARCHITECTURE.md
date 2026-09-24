# Décisions d'architecture

Ce document explique **pourquoi** le code est fait ainsi. Chaque section décrit
un choix, ce qu'il coûte, et ce qui a été écarté.

---

## 1. La logique de file vit dans PostgreSQL, pas dans TypeScript

### Le problème

Une file d'attente est un objet concurrent. Dans un salon à deux fauteuils, un
samedi après-midi :

- deux barbiers appuient sur **TERMINER** à la même seconde ;
- un client rescanne la plaque pendant que le professionnel le fait avancer ;
- la fonction serverless qui envoie une notification est relancée après un
  délai d'attente, alors que le premier envoi avait abouti.

Chacun de ces cas est une course. Calculées en TypeScript, elles produisent
deux clients promus à la même place, un ticket en double, une notification
envoyée deux fois.

### Le choix

Tout ce qui touche à l'ordre de la file est une fonction PostgreSQL.

- **Verrou de file.** Chaque mutation commence par
  `select * from queues where id = … for update`. Deux avancements simultanés
  se sérialisent.
- **Recalcul transactionnel.** `recompute_queue_positions` recalcule toutes les
  positions en **une** instruction, avec une fonction à fenêtre partitionnée
  selon le mode de file (commune ou par professionnel).
- **Réclamation atomique des notifications.**
  `claim_pending_notifications` fait
  `update … where not (notification_status ? kind) … returning`. Une
  notification réclamée ne peut plus l'être. Deux appels concurrents ne peuvent
  pas produire deux fois le même message.
- **Index unique partiel.** Un même appareil ne peut pas occuper deux places
  actives dans la même file — garanti par le schéma, pas par une vérification
  applicative qui laisserait une fenêtre entre la lecture et l'écriture.

### Le coût

La logique est en PL/pgSQL, moins familier que TypeScript, et plus difficile à
tester avec les outils habituels. C'est pourquoi `supabase/tests/` contient une
suite de 98 assertions rejouable sur un PostgreSQL vierge, sans Docker ni
projet Supabase.

### Écarté

Un verrou applicatif (Redis, advisory lock) : il faudrait le prendre à chaque
mutation et le relâcher correctement en cas de panne. Le verrou de ligne
PostgreSQL est relâché par la fin de transaction, quoi qu'il arrive.

---

## 2. Deux chemins temps réel, pour deux besoins de confidentialité

### Le problème

Le tableau de bord et l'écran client ont besoin du même événement — « la file a
avancé » — mais **pas du même contenu**.

La table `queue_entries` contient les prénoms de toutes les personnes de la
file. Donner au navigateur d'un client un abonnement à cette table, même
filtré, reviendrait à exposer ces prénoms : un filtre Realtime est un confort
d'affichage, pas une frontière de sécurité.

### Le choix

| | Canal | Contenu |
|---|---|---|
| **Client** | Broadcast Supabase | Charge utile construite par le serveur : identifiants de ticket opaques et nombre de personnes devant. Aucun prénom. Chaque appareil y reconnaît le sien parce qu'il est le seul à connaître son `public_id`. |
| **Professionnel** | Postgres Changes sous RLS, **et** Broadcast en signal | Les lignes réelles viennent des Postgres Changes, filtrées par les policies. Le Broadcast est écouté en parallèle, mais **rien n'est lu de sa charge utile** : il ne sert qu'à déclencher un rechargement de l'instantané par l'action serveur authentifiée. |

Ce second canal n'est pas de la redondance gratuite. Il a été ajouté après
avoir mesuré le comportement réel : sans lui, quand les Postgres Changes sont
indisponibles, un client qui appuie sur « Je suis de retour » mettait 18
secondes à apparaître au comptoir — le temps du filet de sécurité périodique.
Avec lui, c'est instantané, et sans exposer la moindre donnée personnelle sur
un canal public.

Le navigateur du client n'a **aucun privilège** sur `queue_entries`. Un
`select` depuis le rôle `anon` échoue avec *permission denied* — ce n'est pas
une policy qui le filtre, c'est l'absence totale de privilège.

### Le coût

Le serveur doit diffuser explicitement après chaque mutation (`propagate()`).
Une diffusion ratée n'est pas fatale : le client dispose d'un repli par
interrogation, et la diffusion est rejouée au prochain événement.

---

## 3. Le temps réel n'est jamais considéré comme acquis

Un client est dans la rue, dans le métro, dans un sous-sol. Le canal tombe.

- Reconnexion à **repli exponentiel plafonné** — un téléphone dans un tunnel ne
  doit pas vider sa batterie en tentatives.
- **Interrogation de secours**, cadencée selon l'état du canal : rare quand il
  tient, serrée quand il est tombé.
- **Resynchronisation** au retour de veille, au retour du réseau, et à chaque
  établissement de canal — un événement a pu être manqué pendant la connexion.
- Hors ligne, l'écran **garde la dernière position connue** plutôt que de
  clignoter vide.

L'utilisateur ne rafraîchit jamais. Il n'y a d'ailleurs aucun bouton pour.

---

## 4. Pas de numéro de ticket

Le produit n'affiche jamais « A013 ». Un numéro de ticket demande une
conversion mentale : *je suis A013, on en est à A009, donc quatre personnes*.
L'information utile, c'est **quatre**.

`queue_entries` porte bien un `public_id` opaque — nécessaire pour que
l'appareil reconnaisse son ticket dans un flux temps réel anonyme — mais il
n'est jamais montré.

Même raisonnement pour le **temps estimé** : il dépend de la coupe, du
bavardage, d'un client qui change d'avis. Une estimation fausse est pire
qu'aucune estimation. Le produit ne promet que ce qu'il sait : le nombre de
personnes devant.

---

## 5. Une identité d'appareil, pas un compte

Un client qui entre chez un barbier ne va pas créer un compte. Il ne va pas
davantage attendre un SMS.

- Le téléphone détient un **jeton aléatoire de 32 octets**. La base n'en stocke
  que le SHA-256 **poivré** par un secret serveur : une copie de la base ne
  permet pas de rejouer une session.
- Les **adresses IP ne sont jamais stockées en clair** — seulement un condensat
  irréversible, utilisé pour la limitation de débit.
- La session est **cloisonnée par organisation**. Un même téléphone chez deux
  commerces détient deux jetons indépendants : meilleure isolation, et rien à
  corréler entre commerces.
- Côté web, le jeton vit dans un **cookie httpOnly** ; côté iOS, dans le
  **trousseau**, dans un groupe d'accès partagé entre l'App Clip et
  l'application.

---

## 6. Un seul App Clip pour tous les commerces

### Le problème

Un App Clip par commerce signifierait : un bundle ID, une fiche App Store
Connect et une revue Apple **par client**. Inexploitable.

### Le choix

Une seule application, un seul App Clip, et c'est l'**URL d'invocation** qui
détermine l'établissement. Chaque commerce est déclaré comme *expérience App
Clip avancée* dans App Store Connect.

Apple impose une contrepartie précise : chaque notification doit porter un
`target-content-id` égal à l'URL d'invocation. C'est ce champ qui permet au
système de router le push vers la bonne instance quand un client a ouvert
plusieurs commerces. Le serveur le renseigne depuis
`notification_subscriptions.invocation_url`, mémorisée au lancement.

### Le coût

Déclarer une expérience avancée par plaque dans App Store Connect. C'est du
travail d'exploitation, pas de développement — et c'est le prix d'un modèle
multi-tenant sur la plateforme Apple.

---

## 7. On ne prétend jamais

C'est une règle de conception, appliquée partout :

- Une interface n'affiche « notification envoyée » que si une ligne
  `notification_deliveries` est passée à `sent` **parce que le fournisseur l'a
  acceptée**. La page Notifications montre les échecs, avec leur motif.
- Quand aucun canal n'est disponible sur l'appareil — iPhone en Safari sans
  PWA, permission refusée — l'écran client le dit et explique quoi faire.
- Quand une intégration n'est pas configurée, l'interface l'indique au lieu
  d'afficher un bouton qui mènerait à une erreur.
- Une invitation d'équipe produit un lien à transmettre soi-même, avec la
  mention explicite que le produit n'envoie pas d'e-mail à votre place.

---

## 8. CSS Modules plutôt qu'un framework d'utilitaires

Le produit devait avoir une identité propre. Un framework d'utilitaires pousse
vers les valeurs de son échelle par défaut, et donc vers un rendu reconnaissable
comme tel.

Le système de design est écrit à la main : jetons CSS, composants signature
(`.rang`, `.slat`, `.flap`), thèmes clair et sombre. Aucun dégradé, aucun verre
dépoli, aucun violet.

Les couleurs des graphiques ne sont pas choisies à l'œil : le couple catégoriel
est validé par script — bande de clarté, plancher de chroma, séparation
daltonienne (ΔE 12,1 en deutéranopie), plancher vision normale (ΔE 32,4),
contraste — contre les deux surfaces réelles du produit, claire et sombre.

---

## 9. Passes Wallet : une file d'envoi commune, alimentée par la base

### Le problème

Un ticket ajouté à Apple Wallet ou à Google Wallet doit suivre la file
**sans que la page soit ouverte**, et sans que le client reçoive deux
alertes pour le même moment. Deux fournisseurs aux protocoles opposés :
Apple ne reçoit qu'un push vide et vient relire le pass sur notre service
web ; Google reçoit un PATCH de l'objet, et ne fait sonner le téléphone que
sur un message explicite, trois fois par 24 h au plus. Et une panne chez
l'un d'eux ne doit jamais bloquer le bouton « Suivant » du commerçant.

### Le choix

- **Un registre** `wallet_passes` (une ligne par ticket et par
  fournisseur) et **une file d'envoi** `wallet_outbox`, alimentée
  **uniquement par des déclencheurs** sur `queue_entries`,
  `event_access_passes`, `queues`, `event_campaigns` et la marque de
  l'établissement. Toutes les transitions du moteur passent par un
  `UPDATE` : aucun chemin applicatif ne peut oublier de prévenir le Wallet.
- **Au plus une ligne en attente par pass** : dix recalculs de position en
  deux secondes donnent un envoi. La ligne est un drapeau de travail, pas
  un contenu : au moment d'envoyer, le serveur relit l'état courant
  (`wallet_pass_snapshot`). Un changement mineur attend 20 s après le
  précédent ; au-delà de 20 personnes devant, le pass dit « Plus de 20 »,
  ce qui supprime la plupart des envois pendant un drop.
- **Un modèle de vue** pur, `buildWalletView()`, puis deux traducteurs
  (`pass.json` pour Apple, PATCH pour Google) : les deux plateformes
  affichent les mêmes textes aux mêmes moments. Aucun prénom n'entre dans
  un pass, ni dans l'instantané qui sert à le dessiner.
- **Une règle d'alerte** pure, `decideWalletAlert()` : « C'est votre tour »
  et l'ouverture d'un accès alertent toujours ; les autres moments
  seulement si aucun autre canal (Web Push, App Clip) ne les a déjà livrés,
  d'après `notification_deliveries`. Un envoi Wallet qui porte une alerte y
  est inscrit (`apple_wallet`, `google_wallet`) quand le fournisseur l'a
  accepté, comme les autres canaux.
- **Vidage** après la réponse (`after()` dans `propagate()`), et filet
  chaque minute par `/api/cron/notifications`. La mise en file est isolée
  dans un bloc d'exception : une erreur Wallet n'annule jamais une action de
  file.
- **Masquage** : chaque fournisseur expose `status() → { ready, reason }`.
  Non prêt, il n'affiche aucun bouton côté client ; la raison n'apparaît
  que dans la carte **Passes Wallet** du super-admin.
- **Effacement** 24 h après la fin du passage (inscriptions Apple
  supprimées, contenu Google vidé), suppression des lignes 7 jours plus
  tard, par le cron de maintenance.

### Le coût

- Un déclencheur par ligne modifiée ; sans pass, il coûte une lecture
  d'index partiel vide.
- Des secrets de plus à exploiter : certificat Pass Type ID à renouveler
  chaque année (alerte à J-30 dans `/admin`), clé de compte de service
  Google. Tout est facultatif : sans eux, le produit est inchangé.
- L'API Google ne permet pas de supprimer un objet : on en efface le
  contenu.

### Écarté

- **Pousser depuis le code applicatif** après chaque action : il suffisait
  d'un chemin oublié (un cron, une restauration) pour qu'un pass mente.
- **Une file par fournisseur** : deux jeux de règles de fusion, de débit et
  d'alerte à garder alignés, pour un même ticket.
- **Un service dédié** : le conteneur `cron` existant et `after()`
  suffisent au volume d'un commerce comme d'un drop.

---

## 10. Ce qui reste ouvert

| Sujet | État | Piste |
|---|---|---|
| Notifications Android natives | Non implémenté | Le canal `fcm` existe déjà dans le schéma |
| App Clip Codes (les disques Apple) | Non implémenté | À générer depuis App Store Connect ; l'URL d'invocation ne change pas |
| Temps d'attente estimé | Volontairement absent | Les données existent (`location_stats`) si vous changez d'avis |
| Multi-langue | Français uniquement | Les textes sont centralisés dans `lib/copy.ts` et `Design.swift` |
| Envoi d'e-mails | Non implémenté | Les invitations produisent un lien à transmettre |
