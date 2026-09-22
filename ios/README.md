# VotreTour — iOS

**Une** application, **un** App Clip, **N** établissements.

Ce n'est pas un App Clip par commerce : c'est l'URL d'invocation qui détermine
où l'on se trouve.

```
https://votre-domaine/e/barber-house-comptoir   →  Barber House
https://votre-domaine/e/garage-92-accueil       →  Garage 92
```

## Générer le projet

Le projet Xcode n'est pas versionné : il est décrit dans `project.yml` et
généré par XcodeGen. Un `.pbxproj` de plusieurs milliers de lignes est
illisible en revue et produit un conflit à chaque fusion.

```bash
brew install xcodegen
cp Config/Local.xcconfig.example Config/Local.xcconfig   # puis vos valeurs
xcodegen generate
open VotreTour.xcodeproj
```

La marche à suivre complète — App IDs, capacités, clé APNs, expériences App
Clip, publication — est dans **[../SETUP.md](../SETUP.md)**, sections 6 à 11.

## Arborescence

```
ios/
├── project.yml              description du projet (XcodeGen)
├── Config/Local.xcconfig    VOS identifiants — ignoré par git
├── VotreTourKit/            code partagé entre l'app et l'App Clip
│   ├── Configuration.swift  réglages lus depuis l'Info.plist
│   ├── Models.swift         modèles du domaine
│   ├── APIClient.swift      réseau (URLSession, sans dépendance)
│   ├── SessionStore.swift   trousseau + conteneur de groupe
│   ├── RealtimeChannel.swift protocole Phoenix sur URLSessionWebSocketTask
│   ├── QueueModel.swift     la machine à états de l'expérience
│   ├── NotificationManager.swift  APNs et autorisations
│   ├── Design.swift         le système de design « Le Rang »
│   ├── Haptics.swift        retour haptique quand la file avance
│   ├── Components/          RangView, FlapNumberView
│   └── Screens/             RootView, JoinScreen, QueueScreen, DoneScreen
├── VotreTour/               cible application complète
└── VotreTourClip/           cible App Clip
```

Le code d'expérience est **strictement partagé**. Apple exige que
l'application complète sache traiter toutes les invocations que l'App Clip
traite, puisqu'elle le remplace dès qu'elle est installée.

## Trois décisions qui expliquent le reste

### Aucune dépendance externe

Un App Clip qui accepte les invocations physiques — NFC, QR, App Clip Codes,
c'est-à-dire exactement notre usage — est plafonné par Apple à **15 Mo
décompressés**.

Conséquences assumées :

- **Pas de SDK Supabase.** Le canal temps réel est parlé directement sur le
  protocole Phoenix v2 via `URLSessionWebSocketTask` : rejoindre un canal,
  répondre aux battements de cœur, recevoir des diffusions. Une centaine de
  lignes dans `RealtimeChannel.swift`.
- **Pas de police embarquée.** Le web utilise Archivo et ses axes de graisse et
  de chasse ; iOS utilise SF Pro, dont `Font.width` joue exactement le même
  rôle depuis iOS 16. Embarquer une police coûterait du poids là où Apple en
  plafonne strictement la taille, pour un gain nul en lisibilité.
- **Pas d'image d'illustration.** Le vocabulaire visuel — rail, lattes, volet —
  est dessiné en SwiftUI.

Pour mesurer la taille réelle : archivez, **Distribute App** → Ad Hoc avec
app thinning, puis lisez `App Thinning Size Report.txt`.

### Les notifications éphémères, et leurs 8 heures

`Info.plist` de l'App Clip déclare :

```xml
<key>NSAppClip</key>
<dict>
  <key>NSAppClipRequestEphemeralUserNotification</key>
  <true/>
</dict>
```

Cette clé accorde à l'App Clip le droit de recevoir des notifications pendant
**8 heures après chaque lancement**, **sans alerte de permission**. La carte
App Clip en informe le client, qui peut refuser d'un geste — c'est pourquoi
`NotificationManager` vérifie toujours `authorizationStatus` avant de promettre
quoi que ce soit à l'écran.

On ne demande donc **jamais** explicitement l'autorisation dans l'App Clip : le
faire afficherait une alerte inutile et risquerait un refus qui écraserait la
fenêtre accordée. L'application complète, elle, demande une autorisation
classique, qui n'expire pas.

Chaque relance de l'App Clip — depuis la plaque ou depuis une notification —
repart pour 8 heures. Pour une file d'attente de quelques dizaines de minutes,
la fenêtre est largement suffisante.

### `target-content-id` : le garde-fou multi-commerces

Apple documente une exigence précise pour un App Clip servant plusieurs
entreprises : la charge utile de notification doit porter un
`target-content-id` égal à l'URL d'invocation correspondant à une expérience
App Clip avancée déclarée.

C'est ce champ qui permet à iOS de router la notification vers la **bonne**
instance d'App Clip quand un client a ouvert plusieurs commerces dans la même
journée. Le serveur le renseigne systématiquement depuis
`notification_subscriptions.invocation_url`, mémorisée au lancement.

Sans lui, un client pourrait voir la notification d'un commerce dans l'App Clip
d'un autre. Un test unitaire verrouille ce comportement côté serveur
(`apps/web/tests/notifications.test.ts`).

## Le cas du lancement sans URL

Apple le documente explicitement : **un App Clip rouvert depuis une
notification ou depuis le sélecteur d'applications démarre sans aucune URL
d'invocation.**

C'est le pire moment pour afficher un écran vide : c'est précisément quand le
client vient d'être prévenu que c'est son tour.

`QueueModel.start(url:)` retombe donc sur la dernière invocation mémorisée dans
le conteneur de groupe. À tester en décochant `_XCAppClipURL` dans le schéma
Xcode.

## Ce qui est partagé avec l'application complète

| Quoi | Où | Pourquoi |
|---|---|---|
| Jeton de session | Trousseau, groupe d'accès partagé | Le ticket survit à l'installation de l'application |
| Dernière URL d'invocation, identifiant de ticket | `UserDefaults(suiteName:)` du groupe | Reprise sans URL |
| Prénom du client | Groupe | Un habitué ne le ressaisit pas |

Les deux cibles doivent porter le **même** App Group et le **même** groupe
d'accès trousseau, sinon le passage de l'App Clip à l'application perd la
place du client.

## Déboguer

| Besoin | Comment |
|---|---|
| Ouvrir sur un commerce précis | Scheme → Run → Arguments → `_XCAppClipURL` |
| Voir la carte App Clip | Réglages → Développeur → App Clips Testing → Local Experience |
| Tester la reprise sans URL | Décocher `_XCAppClipURL` et relancer |
| Vérifier l'association | Réglages → Développeur → Associated Domains Development |
| Diagnostiquer après publication | Réglages → Développeur → App Clips Testing → Diagnostics |

> Le **simulateur ne délivre aucun jeton APNs**. Toute vérification des
> notifications se fait sur un iPhone physique.

## Compilation

Le code Swift de ce dépôt n'a pas pu être compilé dans l'environnement où il a
été écrit : SwiftUI, UIKit et UserNotifications ne sont disponibles qu'avec les
SDK Apple, sur macOS. La première compilation se fera donc sur votre Mac —
prévoyez d'y passer quelques minutes.
