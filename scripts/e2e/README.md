# Captures de référence des écrans barbiers

`walkin-baseline.mjs` fige, au pixel près, les écrans qu’un barbier et ses
clients voient aujourd’hui. C’est la troisième preuve de non-régression du
lot R0 (chantier « profils métier »), avec le test SQL
`supabase/tests/11_walkin_contract.test.sql` et le test Vitest
`apps/web/tests/walkin-copy-contract.test.ts`.

**Tout lot qui touche l’interface ou le serveur relance ce script.** Une
différence sur un écran walkin bloque la fusion. On ne régénère les
références (`--update`) que pour un changement voulu et visible, décidé et
noté dans la PR.

## Ce qui est capturé

| Référence | Écran | Format |
|---|---|---|
| `client-inscription` | `/e/<plaque>`, file ouverte, trois personnes | téléphone 390 × 844 @2x |
| `client-en-file` | le client vient de rejoindre (parcours réel), 3 devant | téléphone |
| `client-retire` | le pro l’a retiré ; l’écran le dit au retour au premier plan | téléphone |
| `client-retour` | plus qu’une personne devant, « Je suis de retour » touché | téléphone |
| `client-tour` | « C’est votre tour » | téléphone |
| `client-termine` | fin de visite, avis Google proposé | téléphone |
| `client-file-fermee` | un nouveau client trouve la file fermée | téléphone |
| `pro-file-bureau` | `/app/<org>/file`, page entière : « En cours » (Inès chez Karim, Nadia chez Sofia), « Prochain » (Paul appelé, « Démarrer » grisé), « En attente » (Zoé puis Lina), la colonne de l’équipe (Yanis en pause), un absent (Rayan) et un retiré (Tom) | bureau 1440 de large |
| `pro-file-telephone` | le même poste au téléphone, page entière, barre d’onglets en bas | téléphone 390 de large @2x |

Les deux captures du poste prennent toute la hauteur de la page : la
fenêtre est agrandie à la hauteur du contenu avant la capture. Une capture
« page entière » classique peindrait la barre d’onglets fixe du téléphone à
mi-hauteur, par-dessus la carte de Nadia. La note posée sur Zoé par le pro
n’est pas affichée par le poste aujourd’hui : elle est vérifiée par le test
SQL (`queue_snapshot`), pas par une image.
| `ecran-tv` | `/ecran/<org>` | écran 1920 × 1080 |
| `pro-reglages` | `/app/<org>/reglages`, page entière | bureau |

## Lancer

Prérequis : `npm install` à la racine (installe `playwright-core`,
`pixelmatch` et `pngjs`), `psql`, un Chromium, et **le banc local** :
PostgreSQL avec les migrations, PostgREST et sa passerelle « façon
Supabase » (REST, temps réel et connexion émulés), et l’application.

```bash
# Une base dédiée, migrée (jamais votretour_verify : verify-db.sh l’efface
# et le banc partagé l’utilise ; le script la refuse).
# PostgREST et la passerelle du banc pointent sur cette base, puis :
cd apps/web && npx next build && npx next start -p 3000
# puis, à la racine
E2E_BASE_URL=http://127.0.0.1:3000 \
E2E_DATABASE_URL=postgresql://postgres@127.0.0.1:54399/votretour_e2e \
node scripts/e2e/walkin-baseline.mjs
```

Avant le premier écran, le script vérifie que l’application lit bien la
base donnée à `psql` : il y inscrit un slug de sonde aléatoire, que
l’application doit ouvrir, puis le retire. Sinon il s’arrête avec un
message clair plutôt que onze échecs muets, et nettoie la base.

`next dev` donne les mêmes pixels (l’indicateur de développement est masqué) :
les deux ont été vérifiés identiques au pixel près.

| Variable | Rôle | Défaut |
|---|---|---|
| `E2E_BASE_URL` | l’application | `http://127.0.0.1:3000` |
| `E2E_DATABASE_URL` | la base du banc, pour `psql` (celle que lit l’application) | `postgresql://postgres@127.0.0.1:54399/votretour_e2e` |
| `E2E_CHROMIUM` | exécutable Chromium | `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` s’il existe |

Options : `--update` réécrit les références ; `--only a,b` ne compare que ces
écrans (le scénario entier est rejoué ; un nom inconnu est refusé) ; `--keep`
garde l’organisation de test pour l’inspecter.

Sortie : une ligne par écran et le nombre de pixels différents. Code 0 si tout
est identique, 1 sinon (2 si la configuration est refusée). Les captures du
passage et les images de différence (`<écran>.diff.png`, en rouge) sont dans
`scripts/e2e/.out/`, jamais versionné.

Le passage échoue aussi, sans image à regarder, si un écran du scénario n’a
pas été capturé, ou si une image de `baseline/` n’a été comparée à rien (une
capture retirée ou renommée ne passe donc pas en silence).

## Comment le résultat reste stable

- **Banc local seulement.** Le script refuse une base ou une application qui
  ne sont pas sur `127.0.0.1`, une URI qui redirige l’hôte en paramètre
  (`host`, `hostaddr`, `service`), et la base `votretour_verify`. `psql` est
  lancé sans `PGHOST`, `PGHOSTADDR`, `PGSERVICE` ni `PGSERVICEFILE` : l’hôte
  vérifié est celui auquel il se connecte. La connexion du pro passe par la
  connexion émulée du banc (n’importe quel mot de passe).
- **Organisation jetable.** « Barber Témoin », propriétaire, slugs d’URL,
  professionnels et couleurs sont fixes. Elle est supprimée au début
  (rejouable après un échec) et à la fin, slugs compris. Le compteur de
  débit `join:ip:*` de la base est remis à zéro, car tous les passages
  viennent de la même adresse : c’est une raison de plus pour une base
  dédiée.
- **Vrais parcours.** Le client rejoint et touche « Je suis de retour » dans
  l’écran ; les actions du pro passent par les fonctions du moteur
  (`staff_queue_action`, `add_walkin`, `set_queue_status`).
- **Heure figée.** Le navigateur vit le mardi 10 mars 2026 à 9 h 42 (Paris).
  Avant chaque capture, toutes les heures des tickets sont réécrites par
  rapport à cet instant : « depuis 09:36 », « 6 min » et « il y a 16 min »
  ne bougent pas. Exception assumée : l’heure de fin du ticket terminé reste
  réelle, car un ticket terminé n’est retrouvé que 30 minutes
  (`find_active_ticket`), et l’écran « terminé » n’affiche aucune heure.
- **Mouvement réduit** (`prefers-reduced-motion: reduce`), animations CSS
  arrêtées au moment de la capture, polices chargées, réseau au repos.
- **Tolérance : zéro pixel.** Un pixel compte comme différent au-delà du
  seuil couleur 0,1 de pixelmatch, anticrénelage écarté ; un seul pixel
  différent fait échouer l’écran. Sur la machine des références, chaque
  passage donne 0 px, en `next dev` comme en `next start`, sur l’état
  d’avant le chantier comme sur l’actuel. Toute marge laissait passer du
  vrai changement. Voici ce qu’on a mesuré en changeant le texte dans la
  page :

  | Changement | Pixels différents |
  |---|---|
  | une lettre (« Démarrer » → « Démarrez »), poste au bureau / au téléphone | 491 / 613 |
  | une lettre dans « Ajouté au comptoir », téléphone | 1 360 |
  | une lettre dans les réglages (page entière, 4,9 millions de pixels) | 904 à 1 404 |
  | une lettre sur l’écran client « file fermée » | 135 |
  | un accent retiré (« Ajouté » → « Ajoute », « fermée » → « fermee ») | 2 à 8 |

  Toutes ces modifications restent sous 0,05 % de l’écran : l’ancien
  seuil de 0,1 % les laissait toutes passer. Les textes restent en plus
  verrouillés mot pour mot par `walkin-copy-contract.test.ts`.
- **Erreurs.** Une erreur JavaScript, un avertissement d’hydratation, une
  réponse HTTP 5xx (page, API, action serveur) ou un débordement horizontal
  font aussi échouer le script, même si l’écran capturé est intact.

## Images de référence

`baseline/*.png`, versionnées, compressées (zlib 9, filtre adaptatif) :
environ 2 Mo au total. Elles ont été produites sur l’état d’avant le
chantier (`4510a2d`, migrations 0001 à 0020), en build de production, et
l’état actuel les reproduit à 0 px. Elles dépendent du rendu des polices
de la machine : elles ont été produites sur le banc de développement
(Linux, Chromium 1194). Sur une autre machine, régénérez-les d’abord sur
`main`, puis comparez votre branche.

## Recettes par métier

Deux jeux de parcours Playwright, joués sur un banc local dédié (jamais
`votretour_verify`, jamais une base distante : les deux bancs le refusent).

- `pro/` : le poste du pro (atelier véhicule et appareil avec l’étiquette de
  clé imprimée, salle, guichet, boutique), données `pro/profiles-seed.sql`.
  Paramètres et lancement en tête de `pro/profiles-lib.mjs`.
- `client/` : l’écran client `/e/<plaque>` pour les mêmes métiers, devis,
  rideau reçu en direct et fin de passage. Paramètres en tête de
  `client/bench.mjs`, par exemple :
  `E2E_DB=postgresql://…@127.0.0.1:…/votretour_e2e E2E_SUPABASE_URL=http://127.0.0.1:… node scripts/e2e/client/profiles-vehicle.mjs`
