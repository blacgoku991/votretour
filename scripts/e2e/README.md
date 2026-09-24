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
| `pro-file-bureau` | `/app/<org>/file` : deux en cours, un appelé, deux en attente, un retiré, un absent | bureau 1440 × 900 |
| `pro-file-telephone` | le même poste au téléphone | téléphone |
| `ecran-tv` | `/ecran/<org>` | écran 1920 × 1080 |
| `pro-reglages` | `/app/<org>/reglages`, page entière | bureau |

## Lancer

Prérequis : `npm install` à la racine (installe `playwright-core`,
`pixelmatch` et `pngjs`), `psql`, un Chromium, et **le banc local** :
PostgreSQL avec les migrations, PostgREST et sa passerelle « façon
Supabase » (REST, temps réel et connexion émulés), et l’application.

```bash
# Application de production sur le banc (référence)
cd apps/web && npx next build && npx next start -p 3000
# puis, à la racine
E2E_BASE_URL=http://127.0.0.1:3000 \
E2E_DATABASE_URL=postgresql://postgres@127.0.0.1:54399/votretour_verify \
node scripts/e2e/walkin-baseline.mjs
```

`next dev` donne les mêmes pixels (l’indicateur de développement est masqué) :
les deux ont été vérifiés identiques au pixel près.

| Variable | Rôle | Défaut |
|---|---|---|
| `E2E_BASE_URL` | l’application | `http://127.0.0.1:3000` |
| `E2E_DATABASE_URL` | la base du banc, pour `psql` | `postgresql://postgres@127.0.0.1:54399/votretour_verify` |
| `E2E_CHROMIUM` | exécutable Chromium | `/opt/pw-browsers/chromium-1194/chrome-linux/chrome` s’il existe |

Options : `--update` réécrit les références ; `--only a,b` ne compare que ces
écrans (le scénario entier est rejoué) ; `--keep` garde l’organisation de test
pour l’inspecter.

Sortie : une ligne par écran et le nombre de pixels différents. Code 0 si tout
est identique, 1 sinon. Les captures du passage et les images de différence
(`<écran>.diff.png`, en rouge) sont dans `scripts/e2e/.out/`, jamais versionné.

## Comment le résultat reste stable

- **Banc local seulement.** Le script refuse une base ou une application qui
  ne sont pas sur `127.0.0.1`. La connexion du pro passe par la connexion
  émulée du banc (n’importe quel mot de passe).
- **Organisation jetable.** « Barber Témoin », propriétaire, slugs d’URL,
  professionnels et couleurs sont fixes. Elle est supprimée au début
  (rejouable après un échec) et à la fin. Le compteur de débit
  `join:ip:*` du banc est remis à zéro, car tous les tests locaux partagent
  la même adresse.
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
- **Tolérance.** Un pixel compte comme différent au-delà du seuil couleur
  0,1 de pixelmatch (anticrénelage ignoré) ; un écran échoue au-delà de
  0,1 % de pixels différents. Un mot changé dans un bouton (≈ 0,15 %) échoue ;
  une seule lettre peut passer sous le seuil : les textes, eux, sont
  verrouillés mot pour mot par `walkin-copy-contract.test.ts`.
- **Erreurs.** Une erreur JavaScript, un avertissement d’hydratation ou un
  débordement horizontal font aussi échouer le script.

## Images de référence

`baseline/*.png`, versionnées, compressées (zlib 9, filtre adaptatif) :
environ 1,7 Mo au total. Elles dépendent du rendu des polices de la machine :
elles ont été produites sur le banc de développement (Linux, Chromium 1194).
Sur une autre machine, régénérez-les d’abord sur `main`, puis comparez votre
branche.
