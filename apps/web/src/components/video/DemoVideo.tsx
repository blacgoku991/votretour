import { DemoVideoPlayer } from './DemoVideoPlayer';
import { formatVideoDuration, type DemoVideoEntry } from './manifest';
import styles from './DemoVideo.module.css';

/**
 * LA DÉMO EN VRAI — une vidéo filmée sur le vrai produit, avec un
 * commerce fictif ([SEO § 10]).
 *
 * Composant serveur : la figure, sa légende et la liste de ce que montre
 * la vidéo sont du HTML statique (la vidéo n'a pas de son : la légende sert
 * autant à l'accessibilité qu'au référencement). Seul le lecteur
 * (`DemoVideoPlayer`, ≈ 2 Ko) est un îlot client, et il ne télécharge rien
 * avant un clic, sauf l'aperçu permis par `previewAllowed()`.
 */

export interface DemoVideoProps {
  video: DemoVideoEntry;
  /** « Barbiers » : nomme la vidéo pour les lecteurs d'écran. */
  subject: string;
  className?: string;
}

export function DemoVideo({ video, subject, className }: DemoVideoProps): React.JSX.Element {
  const duration = formatVideoDuration(video.duration);
  return (
    <figure className={[styles.figure, className].filter(Boolean).join(' ')}>
      <DemoVideoPlayer
        files={video.files}
        width={video.width}
        height={video.height}
        buttonLabel={`Voir la démo · ${duration}`}
        videoLabel={`Démonstration filmée sur Rangvia : ${subject}, commerce fictif, sans son`}
      />
      <figcaption className={styles.caption}>
        {video.chapters.length > 0 && (
          <>
            <p className="t-label">Ce que montre la vidéo</p>
            <ol className={styles.chapters}>
              {video.chapters.map((chapter, i) => (
                <li key={`${i}-${chapter}`}>
                  <span className={styles.chapterNum} aria-hidden="true">
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  {chapter}
                </li>
              ))}
            </ol>
          </>
        )}
        <p className={`t-micro t-muted ${styles.honest}`}>
          Filmée sur le vrai produit, avec un commerce fictif. Sans son, {duration}.
        </p>
      </figcaption>
    </figure>
  );
}
