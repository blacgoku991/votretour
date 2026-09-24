'use client';

import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from '@/components/motion/useMotionPreference';
import type { DemoVideoFiles } from './manifest';
import { previewAllowed, readConnection } from './preview';
import styles from './DemoVideo.module.css';

/**
 * L'ÎLOT CLIENT DE LA VIDÉO — l'affiche, puis la vidéo, au clic.
 *
 * Trois états, dans cet ordre seulement :
 *  - `poster` (rendu serveur) : une image et un bouton. AUCUN élément
 *    <video>, aucune source, aucun préchargement : la vidéo ne coûte rien
 *    tant qu'on ne la demande pas ;
 *  - `preview` : l'aperçu muet en boucle, seulement si `previewAllowed()`
 *    (mouvement permis, lecteur à l'écran, pas d'économie de données, pas
 *    de 2G). Un bouton Pause est toujours visible (WCAG 2.2.2), et
 *    l'aperçu s'arrête dès qu'il sort de l'écran ;
 *  - `full` : la vidéo complète, avec ses commandes natives, lancée par le
 *    geste du visiteur (lecture automatique permise : il vient de cliquer).
 *
 * Pas de lecteur tiers : des fichiers locaux, servis par le site.
 */

export interface DemoVideoPlayerProps {
  files: DemoVideoFiles;
  width: number;
  height: number;
  /** « Voir la démo · 52 s » */
  buttonLabel: string;
  /** Nom accessible de la vidéo (« Démonstration filmée : barbiers »). */
  videoLabel: string;
}

type Mode = 'poster' | 'preview' | 'full';

function Sources({ mp4, webm }: { mp4: string; webm?: string }) {
  // WebM (VP9) d'abord, plus léger ; MP4 (H.264) ensuite, lu partout.
  return (
    <>
      {webm && <source src={webm} type="video/webm; codecs=vp9" />}
      <source src={mp4} type="video/mp4" />
    </>
  );
}

export function DemoVideoPlayer({ files, width, height, buttonLabel, videoLabel }: DemoVideoPlayerProps) {
  const reduced = useReducedMotion();
  const [mode, setMode] = useState<Mode>('poster');
  const [visible, setVisible] = useState(false);
  const [paused, setPaused] = useState(false);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const fullRef = useRef<HTMLVideoElement | null>(null);
  const hasTeaser = Boolean(files.teaser);

  // Visibilité, suivie tant qu'un aperçu est possible. Sans
  // IntersectionObserver, on ne sait pas si le lecteur est à l'écran : on
  // ne lance donc rien (l'inverse de useInViewOnce, qui suppose « vu »).
  useEffect(() => {
    if (!hasTeaser || mode === 'full') return;
    const el = frameRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      (entries) => {
        const last = entries[entries.length - 1];
        if (last) setVisible(last.isIntersecting && last.intersectionRatio >= 0.5);
      },
      { threshold: [0, 0.5, 1] },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasTeaser, mode]);

  // Démarrage de l'aperçu, une fois toutes les conditions réunies ; retour
  // à l'affiche si le visiteur active « réduire les animations » en route.
  useEffect(() => {
    if (mode === 'poster') {
      const connection = readConnection(typeof navigator === 'undefined' ? null : navigator);
      if (previewAllowed({ hasTeaser, reducedMotion: reduced, visible, ...connection })) setMode('preview');
    } else if (mode === 'preview' && reduced) {
      setMode('poster');
    }
  }, [mode, reduced, visible, hasTeaser]);

  // L'aperçu ne tourne qu'à l'écran, et jamais après un appui sur Pause.
  useEffect(() => {
    const video = previewRef.current;
    if (mode !== 'preview' || !video) return;
    if (!visible || paused) video.pause();
    else void video.play().catch(() => setPaused(true));
  }, [mode, visible, paused]);

  // La vidéo complète prend le focus : le clavier atteint ses commandes.
  useEffect(() => {
    if (mode === 'full') fullRef.current?.focus();
  }, [mode]);

  const poster = files.poster.jpg;

  return (
    <div ref={frameRef} className={styles.frame} data-mode={mode} style={{ aspectRatio: `${width} / ${height}` }}>
      {mode === 'full' ? (
        <video
          ref={fullRef}
          className={styles.video}
          controls
          playsInline
          autoPlay
          muted
          preload="auto"
          poster={poster}
          width={width}
          height={height}
          aria-label={videoLabel}
        >
          <Sources mp4={files.mp4} webm={files.webm} />
        </video>
      ) : (
        <>
          {mode === 'preview' && files.teaser ? (
            <video
              ref={previewRef}
              className={styles.video}
              muted
              loop
              playsInline
              autoPlay
              preload="auto"
              poster={poster}
              width={width}
              height={height}
              aria-hidden="true"
              tabIndex={-1}
            >
              <Sources mp4={files.teaser.mp4} webm={files.teaser.webm} />
            </video>
          ) : (
            <picture className={styles.poster}>
              {files.poster.avif && <source srcSet={files.poster.avif} type="image/avif" />}
              {files.poster.webp && <source srcSet={files.poster.webp} type="image/webp" />}
              {/* Décorative : le bouton et la légende disent ce qu'elle montre. */}
              <img src={poster} alt="" width={width} height={height} loading="lazy" decoding="async" />
            </picture>
          )}
          <button type="button" className={styles.play} onClick={() => setMode('full')}>
            <span className={styles.playKey} aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false">
                <path d="M8 5.5v13l10.5-6.5z" />
              </svg>
            </span>
            <span className={styles.playLabel}>{buttonLabel}</span>
          </button>
          {mode === 'preview' && (
            <button
              type="button"
              className={styles.pause}
              onClick={() => setPaused((p) => !p)}
            >
              <span className={styles.pauseGlyph} data-paused={paused ? '1' : undefined} aria-hidden="true" />
              {paused ? 'Reprendre l’aperçu' : 'Pause'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
