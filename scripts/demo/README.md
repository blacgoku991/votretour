# Vidéos de démonstration, filmées sur le vrai produit

Ces scripts tournent et montent les vidéos des pages `/pour/<métier>`
(lots V0 à V3 du chantier « profils métier et pages par métier »,
conception : `seo.md` § 10). Aujourd’hui : **barbiers** et **événements**.

## Les règles, vérifiées par les scripts

- **Le vrai produit.** Compilation de production (`next start`) branchée sur
  un banc Supabase **local**. Aucune maquette, aucun état injecté dans
  l’interface. Seule surcouche : l’anneau qui montre où le doigt touche
  (`lib/cursor.mjs`), hors de l’interface et sans interaction.
- **Commerce fictif, dit comme tel.** Carton d’ouverture, mention permanente
  « Commerce fictif » à l’image. Prénoms et adresses inventés ; téléphones
  dans la plage que l’ARCEP réserve à la fiction (01 99 00 xx xx).
- **Rien d’accéléré.** Les plans consécutifs s’enchaînent sans coupe ; un
  temps mort retiré se voit (fondu de 200 ms).
- **Ce que le banc ne peut pas filmer n’est pas imité.** Pas de fausse
  bannière de notification : un carton cite le texte réel de
  `notificationCopy`. La page Google n’est jamais ouverte (navigation
  bloquée) : un carton dit ce qui se passe.
- **Le tournage est un test du produit.** Chaque étape attend un texte réel,
  importé du vocabulaire (`lib/copy.ts`, `lib/profiles/*`) ou vérifié mot
  pour mot dans le source du composant (`ui()` de `lib/vocab.mjs`). Si le
  produit change, le tournage échoue au lieu de produire une vidéo fausse.
  Une erreur JavaScript, un avertissement d’hydratation ou une réponse 5xx
  le font aussi échouer.

## Rejouer

Prérequis : `npm install` à la racine (`playwright-core`), `psql`, un
Chromium (celui de Playwright, ou `DEMO_CHROMIUM`), un ffmpeg **complet**
(avec libx264, VP9, WebP et AV1 : `sudo apt-get install ffmpeg` ou
`pip install imageio-ffmpeg` ; `node scripts/demo/ffmpeg.mjs` dit lequel est
retenu), et un **banc local** :

```bash
# 1. Une base dédiée, migrée (jamais votretour_verify)
node scripts/demo/bench/db.mjs create            # votretour_demo, ou DEMO_DATABASE_URL

# 2. PostgREST et la passerelle « façon Supabase » du banc de développement
#    (REST, temps réel, connexion et administration des comptes émulés),
#    pointés sur cette base. Avec un vrai Supabase local (`supabase start`),
#    ces deux étapes sont remplacées par `supabase db reset`.

# 3. L'application, compilée contre ce banc (les NEXT_PUBLIC_* sont figées
#    à la compilation)
cd apps/web
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54392 NEXT_PUBLIC_SITE_URL=http://localhost:3163 npx next build
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54392 NEXT_PUBLIC_SITE_URL=http://localhost:3163 npx next start -p 3163
cd ../..

# 4. Tournage, puis montage
export DEMO_SUPABASE_URL=http://127.0.0.1:54392 DEMO_BASE_URL=http://localhost:3163
node scripts/demo/film.mjs barbiers
node scripts/demo/montage.mjs barbiers

# 5. Nettoyage
node scripts/demo/bench/reset.mjs                 # organisations demo-* et comptes éphémères
node scripts/demo/bench/db.mjs drop
```

Pourquoi `localhost` et pas `127.0.0.1` pour l’application : `next start`
construit l’URL de ses redirections sur `localhost` ; le lien d’accès d’un
laisser-passer (`/api/pass/access/…`) pose son cookie puis redirige vers
`/pass`. Sur `127.0.0.1`, le cookie et la page seraient sur deux sites
différents (404). `NEXT_PUBLIC_SITE_URL` doit être la même adresse : c’est
celle que le QR du laisser-passer encode.

Le scénario « événements » ouvre deux liens que le banc ne peut pas recevoir
(notification d’accès, appareil photo du personnel) ; il les reconstruit
avec le secret de session du banc (`SESSION_HASH_SECRET` de
`apps/web/.env.local`, ou `DEMO_SESSION_SECRET`) et vérifie que le QR affiché
par le téléphone encode exactement l’URL de contrôle (voir
`lib/event-links.mjs`).

| Variable | Rôle | Défaut |
|---|---|---|
| `DEMO_BASE_URL` | l’application (`next start`) | `http://127.0.0.1:3000` (préférer `http://localhost:…`) |
| `DEMO_SUPABASE_URL` | la passerelle Supabase du banc | `NEXT_PUBLIC_SUPABASE_URL` de `apps/web/.env.local` |
| `DEMO_SERVICE_ROLE_KEY` | clé service_role **du banc** | `SUPABASE_SERVICE_ROLE_KEY` de `apps/web/.env.local` |
| `DEMO_SESSION_SECRET` | secret de session du banc (scénario événements) | `SESSION_HASH_SECRET` de `apps/web/.env.local` |
| `DEMO_DATABASE_URL` | base créée par `db.mjs` | `postgresql://postgres@127.0.0.1:54399/votretour_demo` |
| `DEMO_CHROMIUM` | exécutable Chromium | celui de Playwright 1.56 s’il est installé |
| `FFMPEG_PATH` | ffmpeg à utiliser | `ffmpeg` du PATH, puis imageio-ffmpeg |

**Garde** (`bench/guard.mjs`) : toute adresse (application, Supabase, base)
doit être `127.0.0.1` ou `localhost` ; la base `votretour_verify` est
refusée ; la clé doit être une clé `service_role`. Un refus sort en code 2.

**Compte pro** : créé à chaque tournage par l’API d’administration de GoTrue,
avec un mot de passe aléatoire gardé en mémoire le temps de la connexion,
jamais écrit. La connexion se fait hors caméra ; seul l’état de session
passe au contexte filmé.

## Ce que produit chaque étape

| Étape | Fichiers | Sortie |
|---|---|---|
| Banc (V1) | `bench/{guard,db,seed-demo,reset,supabase}.mjs` | organisation `demo-<métier>`, plaque, personnes « de fond » ajoutées par le moteur |
| Tournage (V2) | `film.mjs`, `lib/{contexts,cursor,timeline,vocab}.mjs`, `scenarios/*.mjs` | `out/<scénario>/raw/` : images PNG horodatées du téléphone (780×1688) et de la tablette du pro (2049×1536), `timeline.json` |
| Montage (V3) | `montage.mjs`, `cards.mjs`, `cards/*`, `ffmpeg.mjs` | `apps/web/public/videos/<métier>/…`, `apps/web/src/lib/metiers/videos.json`, `out/<scénario>/{social,contact.png,keyframes}` |

`out/` n’est jamais versionné. Les fichiers publiés portent le hachage de
leur contenu (`demo-16x9.<hash8>.mp4`) : un nouveau montage change l’URL,
aucun cache ne sert l’ancienne vidéo.

### Pourquoi un screencast et pas `recordVideo`

Mini-étude V0 : `recordVideo` de Playwright filme en pixels CSS (390×844
posés dans une image 780×1688 complétée de gris) et encode en VP8 à 1 Mb/s.
Le screencast CDP livre des PNG sans perte en pixels **physiques** quand
Chromium est lancé avec `--force-device-scale-factor` : un navigateur par
appareil (échelle 2 pour le téléphone ; 1,5 pour la tablette, où l’échelle 2
faisait tomber la cadence à 10 i/s). Autres réponses de V0 : Web Push est
impossible dans Chromium sans affichage (contextes « incognito ») d’où le
carton de notification ; `next start` répond bien 206 aux requêtes `Range`
sur `public/`.

### Le montage

1. **Pistes** : chaque image dure jusqu’à la suivante ; les deux appareils
   partagent le même temps 0, donc restent synchrones à l’image près.
2. **Plans** : fond et corps des appareils, écrans filmés (réduits, jamais
   agrandis), bagues qui arrondissent les angles, légende du plan, cartons.
3. **Film** : carton d’ouverture, plans, carton de fin, en fondus.
4. **Diffusion** : H.264 High yuv420p BT.709 avec `faststart`, VP9, aperçu
   en boucle 960×540, affiches AVIF/WebP/JPEG, format 9:16 pour les réseaux.
   Jusqu’au dernier encodage, tout reste sans perte en RVB (FFV1).

Les cartons sont des pages HTML (`cards/*.html`) rendues par Chromium avec
la **feuille de style compilée du site** (jetons « Le Rang en relief »,
Archivo à axes) : il faut donc avoir lancé `next build`.

### Contrôles

Le montage échoue si une sortie sort de ses budgets (MP4 ≤ 4 Mo, WebM ≤ 3 Mo,
affiches ≤ 60 Ko, aperçu ≤ 600 Ko), n’est pas en H.264 High yuv420p
1920×1080 à 30 i/s, n’a pas `moov` avant `mdat`, ou si sa durée s’écarte de
plus de 0,5 s du plan de montage. `apps/web/tests/videos-manifest.test.ts`
revérifie le manifeste et les fichiers publiés (ffprobe s’il est présent,
sinon lecture directe des en-têtes). À chaque montage, relire
`out/<scénario>/contact.png` (une image toutes les 5 s) et les images clés
de `out/<scénario>/keyframes/`.

## Ajouter un métier

Un scénario n’existe que si le produit livre le parcours à tout nouveau
compte : les métiers à profil (garages, réparation, restaurants, guichets
avec numéro) attendent leur capacité dans `lib/profiles/capabilities.ts`, et
le test du manifeste refuse une vidéo pour un métier dont le socle n’est pas
livré. Ajouter `scenarios/<métier>.mjs` (même forme que `barbiers.mjs`) et sa
scène dans `bench/seed-demo.mjs`.
