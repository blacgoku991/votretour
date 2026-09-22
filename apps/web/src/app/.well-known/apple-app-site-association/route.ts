import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * apple-app-site-association — le fichier qui relie le domaine à
 * l'application et à l'App Clip.
 *
 * Trois sections, trois rôles :
 *
 *  • "appclips"  déclare le bundle de l'App Clip. Sans elle, une URL de
 *    plaque ouvre le site web au lieu de l'App Clip.
 *
 *  • "applinks"  fait ouvrir /e/{code} par l'application complète une
 *    fois installée. Apple exige qu'elle gère TOUTES les invocations que
 *    l'App Clip gère, puisqu'elle le remplace.
 *
 *  • "webcredentials" est volontairement absente : aucun mot de passe
 *    n'est saisi côté client.
 *
 * Contraintes Apple respectées ici :
 *  - servi en application/json, sans extension de fichier ;
 *  - aucune redirection (le chemin est exact) ;
 *  - accessible sans authentification.
 *
 * Le fichier est généré plutôt que statique : les identifiants viennent
 * des variables d'environnement, donc un changement d'équipe Apple ou de
 * bundle ne demande pas de redéploiement de fichier à la main.
 */
export async function GET() {
  const appId = env.apple.appId;
  const clipAppId = env.apple.clipAppId ?? (appId ? `${appId}.Clip` : null);

  const details = appId
    ? [
        {
          appIDs: [appId],
          components: [
            // Le parcours client : une plaque, une URL.
            { '/': '/e/*', comment: 'Rejoindre la file d’un établissement' },
          ],
        },
      ]
    : [];

  const body = {
    applinks: { details },
    appclips: { apps: clipAppId ? [clipAppId] : [] },
  };

  return new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      // Apple met le fichier en cache via son CDN ; on reste court pour
      // pouvoir corriger une erreur de configuration rapidement.
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  });
}
