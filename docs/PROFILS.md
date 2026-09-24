# Profils métier

Rangvia sert quinze métiers avec sept parcours. Ce document explique le
modèle, les codes d'erreur et les règles de confidentialité. Le détail des
écrans et des textes se trouve dans le code (`apps/web/src/lib/profiles/`),
qui fait foi.

---

## 1. Le modèle : profil, étape, statut

**Le profil se règle sur la file** (`queues.profile`), pas sur
l'établissement. Un centre auto peut ainsi avoir une file « Atelier » en
`vehicle` et une file « Pneus minute » en `walkin`.

**Le métier est attribué par l'équipe Rangvia, et par elle seule**
(décision du propriétaire). Le commerçant déclare son activité à
l'inscription ; sa file naît **toujours** au passage (`walkin`, migration
0042), sans avis Google en santé et en service administratif, et sans
prénom en santé, en attendant l'installation. Le super-admin attribue
ensuite le métier depuis `/admin/etablissements/[id]` (section « Métier »,
action `assignQueueProfile`, `server/actions/admin-profiles.ts`, qui appelle
`switch_queue_profile`). Le commerçant voit son métier en lecture seule
dans ses Réglages et en règle les options. `ACTIVITY_PROFILE` (miroir SQL :
`internal.default_profile`) ne dit plus que le métier **attendu** : la liste
des établissements et la vue d'ensemble `/admin` signalent « Métier à
activer » tant qu'aucune file n'y est (`admin/etablissements/metier-pending.ts`).

| Profil | Métiers | Ce qui avance | Ordre |
|---|---|---|---|
| `walkin` | barbier, coiffure, ongles, beauté, autre | la personne | arrivée |
| `vehicle` | garage, centre auto | le véhicule | dans le désordre |
| `device` | réparation téléphone, SAV | l'appareil (dossier `0042`) | dans le désordre |
| `table` | restaurant | le groupe (couverts) | c'est la table libérée qui décide |
| `desk` | comptoir, service administratif, santé | la personne, numérotée (`A-042`) | arrivée, plusieurs guichets |
| `retail` | boutique | la personne ou la commande | arrivée ou dans le désordre |
| `event` | événement | inchangé (vagues, laisser-passer) | vagues |

**Une étape n'est pas un statut.** `entry_status` ne reçoit aucune valeur
nouvelle : l'App Clip installé décode ce type de façon stricte et ne
supporterait pas une valeur inconnue. Chaque étape (`queue_entries.stage`)
correspond à un statut existant. Le moteur raisonne en statuts, l'interface
et les messages en étapes.

| Étape | Profils | Statut | Prévenir par défaut |
|---|---|---|---|
| `received` | vehicle, device | `waiting` | non |
| `diagnosis` | vehicle, device | `serving` | non |
| `quote_pending` | vehicle, device | `serving` | oui (`quote_ready`) |
| `waiting_parts` | vehicle, device | `serving` | oui |
| `in_repair` | vehicle, device | `serving` | non (proposé) |
| `ready` | vehicle, device, retail | `next` | oui (`your_turn`) |
| `preparing` | retail | `serving` | non |

`walkin`, `table`, `desk` et `event` n'ont pas d'étape (`stage` reste null).

**Une seule source de vérité, vérifiée des deux côtés.** Le test
`profile-parity` lit la migration 0034 et vérifie que sont identiques en
TypeScript et en SQL :

- ce tableau, les profils à position, les profils parallèles et l'avance
  automatique ;
- les défauts posés au passage dans un profil : `internal.apply_profile_defaults`
  est **évaluée** (un mini-évaluateur SQL rejoue ses `case`, sa logique à
  trois valeurs et ses `jsonb_build_object`) pour chaque profil et chaque
  activité, puis comparée à `defaultProfileOptions` et à `queueDefaults`
  complété des défauts de colonnes de `queues` (0003) ;
- les prestations par défaut (`internal.default_services`) ;
- la règle d'immatriculation. Les vecteurs de
  `lib/profiles/registration-vectors.json` (accents, formes courtes, FNI,
  étrangères) sont rejoués par vitest sur `normalizeRegistration` et
  `maskRegistration`, et par le test SQL du moteur sur
  `internal.normalize_registration` et `internal.mask_registration`.

Règles communes : la clé ne garde que `[A-Za-z0-9]`, filtrés **avant** le
passage en majuscules, **sans repli des accents** (`ÉB-123-CD` donne `B123CD`
des deux côtés) ; le masquage laisse lisibles `min(3, n − 1)` caractères,
jamais la plaque entière. L'activité ne change les options qu'au guichet
(santé : `sensitive`, pas d'avis ni de message de fin ; administration : pas
d'avis). Au guichet, le prénom n'est pas demandé par défaut
(`ask_client_name = false`).

**Les barbiers ne voient rien changer.** En `walkin`, `details = {}`,
`stage = null` et `profile_options = {}` : aucune branche nouvelle du moteur
n'est prise. `profileNotificationCopy` délègue caractère pour caractère à
`notificationCopy` (test `notification-copy-profiles`).

## 2. Registre TypeScript (`lib/profiles/`)

| Fichier | Rôle |
|---|---|
| `index.ts` | `PROFILES`, `ACTIVITY_PROFILE`, `getProfile`, étapes |
| `walkin.ts` … `event.ts` | vocabulaire, étapes, réglages et prestations par défaut, modèles de messages |
| `types.ts` | types étendus (`ProfileTicketState`, `ProfileStaffEntry`…) : clés **ajoutées** par 0035 |
| `registration.ts` | immatriculations : normalisation, SIV/FNI, frappe, masquage |
| `details.ts` | schémas zod des détails, par profil et par acteur |
| `options.ts` | schémas et défauts de `profile_options`, politique d'avis |
| `templates.ts` | modèles de messages : variables, contrôles, rendu |
| `copy.ts` | `profileNotificationCopy`, libellés du client |
| `table-suggest.ts` | « Table libre pour 4 » : quel groupe appeler |
| `stage-rail.ts` | état de chaque station du rail d'étapes |
| `ticket.ts` | `A-042`, `0042` |
| `capabilities.ts` | contrat avec les pages métier (§ 5) |

Objets visuels (`components/objects/`) : `Immatriculation`, `StageRail`,
`TicketNumber`, `PartySize` et `DeviceGlyph` sont des composants **purs**,
sans hook ni `'use client'`, pour que les pages métier (composants serveur)
les rendent. Seul `TicketNumberFlap` est un composant client : il ajoute la
chute du volet. `StageRail` horizontal mesure sa propre largeur (requête de
conteneur) : s'il ne peut pas écrire toutes les étapes sans les couper, il
ne garde que les jalons et nomme l'étape en cours sous sa latte
(« Réparation 5/6 ») ; les autres noms restent lus par les lecteurs d'écran. Tous sont montrés sur la planche `/design/metiers`, jamais
indexée et introuvable en production.

## 3. Codes d'erreur VT

| Code | Sens | Traduction (`lib/errors.ts`) |
|---|---|---|
| VT001 à VT010 | file, ticket, professionnel (0007) | inchangés |
| VT011 | plaque introuvable (0013, 0017) | `plate_not_found` |
| VT012 | tag verrouillé (0013) | `plate_locked` |
| VT013 | plaque indisponible (0017) | `plate_unavailable` |
| VT014 | quantité hors limites (0017) | `invalid_quantity` |
| VT015 | informations métier invalides (0034) | `invalid_details` (422) |
| VT016 | trop de messages pour un ticket (0034) | `too_many_messages` (429) |
| VT017 | file non vide au changement de profil (0034) | `queue_not_empty` (409) |

Un code ne veut dire qu'une chose : `toAppError` ne lit jamais le message
SQL. Le test `profile-parity` vérifie que chaque erreur levée par 0034 est
traduite, et jamais prise pour une erreur de plaque.

## 4. Confidentialité

- **Immatriculation** : donnée personnelle selon la CNIL. Hors du poste du pro
  (historique compris, réservé aux membres), elle n'apparaît que **masquée** :
  les trois derniers caractères restent lisibles (`AB-123-CD` devient
  `••-••3-CD` ; une plaque étrangère courte garde au moins un caractère
  masqué). L'écran TV la reçoit déjà masquée par le serveur
  (`display_snapshot`) : la forme complète ne quitte jamais la base vers le
  téléviseur. Côté interface, `Immatriculation` ne masque pas au rendu : un
  écran qui n'a droit qu'à la forme masquée lui passe `maskedValue`, de type
  `MaskedRegistration` (fabriqué par `maskRegistration`, ou par
  `asMaskedRegistration` pour une valeur venue du serveur, qui refuse une
  forme non masquée). La forme complète ne peut donc pas partir dans les
  props d'un composant client. Elle est purgée en même temps que les prénoms.
- **Écran verrouillé** : jamais d'immatriculation complète (un garde-fou la
  remplace même dans un message libre du pro), jamais de prénom, jamais de
  motif au guichet.
- **Santé** (`desk` + `sensitive`) : pas de prénom, aucun texte libre, jamais
  de nom à la TV, **aucune demande d'avis Google** par défaut.
- **Détails** : liste blanche stricte, contrôlée deux fois (zod puis
  `internal.clean_details`). Jamais de téléphone, d'e-mail, de VIN, d'IMEI, de
  code de déverrouillage ni d'allergie. Le devis n'est posé que par l'action
  `send_quote`.
- **Messages du pro** : 180 caractères, variables sur liste blanche, **aucune
  adresse web** (contre l'hameçonnage par un compte compromis).
- **Écarts assumés aux textes de la conception** : au guichet, `ahead_two`
  et `ahead_one` ne citent pas le lieu dans le corps (« … avant vous au
  Service Urbanisme ») : il est déjà le TITRE de la notification, et la
  préposition (« au », « à la », « chez ») ne se déduit pas d'un nom libre.
  Les modèles de messages n'accordent aucun participe au client (« votre
  numéro sera appelé », pas « vous serez appelé »).
- **Numéro de ticket** : exception assumée à la règle « pas de numéro »
  (`ARCHITECTURE.md`, § 4). Au guichet, il protège la vie privée : on appelle
  un numéro, jamais un nom.

## 5. Capacités : ce qu'une page métier peut promettre

`lib/profiles/capabilities.ts` exporte `OPEN_PROFILES` (profils ouverts à tout
nouveau compte : `walkin` et `event` aujourd'hui) et `PROFILE_CAPABILITIES`
(vide aujourd'hui). Une page métier n'affiche un bloc que si sa capacité y
figure. Les deux listes ne changent **que** dans la PR qui ouvre un profil,
jamais par une variable d'environnement. En attendant, un profil fermé reste
utilisable par une organisation qui a `organization_settings.features.profiles
= true` (`profileAvailable`), posé par `assignQueueProfile` quand le
super-admin attribue un métier hors passage ; cela suffit aussi au banc de
développement. Remplir `OPEN_PROFILES` ne change rien pour un barbier : la
section Métier des Réglages (et son entrée de sommaire) suit `showsMetier`.
