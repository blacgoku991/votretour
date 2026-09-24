# Profils métier

Rangvia sert quinze métiers avec sept parcours. Ce document explique le
modèle, les codes d'erreur et les règles de confidentialité. Le détail des
écrans et des textes se trouve dans le code (`apps/web/src/lib/profiles/`),
qui fait foi.

---

## 1. Le modèle : profil, étape, statut

**Le profil se règle sur la file** (`queues.profile`), pas sur
l'établissement. Un centre auto peut ainsi avoir une file « Atelier » en
`vehicle` et une file « Pneus minute » en `walkin`. Le profil par défaut
vient de l'activité de l'organisation (`ACTIVITY_PROFILE`, dont le miroir SQL
est `internal.default_profile`).

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
Le test `profile-parity` lit la migration 0034 et vérifie que ce tableau,
les profils à position, les profils parallèles et l'avance automatique sont
identiques en TypeScript et en SQL.

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
chute du volet. Tous sont montrés sur la planche `/design/metiers`, jamais
indexée et introuvable en production.

## 3. Codes d'erreur VT

| Code | Sens | Traduction (`lib/errors.ts`) |
|---|---|---|
| VT001 à VT010 | file, ticket, professionnel (0007) | inchangés |
| VT011 | plaque introuvable (0013, 0017) **ou** informations invalides (0034) | `plate_not_found` / `invalid_details` |
| VT012 | tag verrouillé (0013) **ou** trop de messages (0034) | `plate_locked` / `too_many_messages` |
| VT013 | plaque indisponible (0017) **ou** file non vide au changement de profil (0034) | `plate_unavailable` / `queue_not_empty` |
| VT014 | quantité hors limites (0017) | `invalid_quantity` |
| VT015 à VT017 | réservés aux profils, si 0034 quitte les codes partagés | `invalid_details`, `too_many_messages`, `queue_not_empty` |

**VT011 à VT013 sont partagés** avec les plaques, qui les employaient déjà.
Le code seul ne suffit donc pas : `toAppError` départage par le début du
message SQL (« Informations invalides », « Trop de messages », « Terminez ou
videz la file »). Tout autre message garde le sens « plaque » d'aujourd'hui.
Le test `profile-parity` vérifie que chaque erreur levée par 0034 est
traduite sans être prise pour une erreur de plaque.

## 4. Confidentialité

- **Immatriculation** : donnée personnelle selon la CNIL. Hors du poste du pro
  (historique compris, réservé aux membres), elle n'apparaît que **masquée** :
  les trois derniers caractères restent lisibles (`AB-123-CD` devient
  `••-••3-CD`). L'écran TV la reçoit déjà masquée par le serveur
  (`display_snapshot`) : la forme complète ne quitte jamais la base vers le
  téléviseur. Elle est purgée en même temps que les prénoms.
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
= true` (`profileAvailable`), ce qui suffit au banc de développement.
