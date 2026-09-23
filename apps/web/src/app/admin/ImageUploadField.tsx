'use client';

import { useRef, useState } from 'react';
import styles from './ImageUploadField.module.css';

type Purpose = 'logo' | 'cover' | 'event-logo' | 'event-cover';

export function ImageUploadField({
  label,
  value,
  purpose,
  onChange,
  helper,
  compact = false,
}: {
  label: string;
  value: string;
  purpose: Purpose;
  onChange: (url: string) => void;
  helper?: string;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    if (uploading) return;
    setUploading(true);
    setError(null);

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('purpose', purpose);

      const response = await fetch('/api/admin/media', {
        method: 'POST',
        body: form,
      });

      const payload = await response.json() as {
        ok: boolean;
        error?: string;
        data?: { url?: string };
      };

      if (!response.ok || !payload.ok || !payload.data?.url) {
        throw new Error(payload.error || 'Upload impossible.');
      }

      onChange(payload.data.url);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Upload impossible.');
    } finally {
      setUploading(false);
      setDragging(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const acceptDrop = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    void upload(file);
  };

  return (
    <div className={[styles.field, compact ? styles.compact : ''].join(' ')}>
      <div className={styles.labelRow}>
        <span>{label}</span>
        {value && (
          <button type="button" className={styles.remove} onClick={() => onChange('')}>
            Retirer
          </button>
        )}
      </div>

      <div
        className={[
          styles.body,
          styles.dropZone,
          dragging ? styles.dragging : '',
          uploading ? styles.uploading : '',
        ].join(' ')}
        onDragEnter={(event) => {
          event.preventDefault();
          if (!uploading) setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          if (!uploading) setDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDragging(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          acceptDrop(event.dataTransfer.files);
        }}
      >
        <button
          type="button"
          className={[
            styles.preview,
            purpose.includes('cover') ? styles.coverPreview : '',
          ].join(' ')}
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          aria-label={value ? 'Changer cette image' : 'Ajouter une image'}
        >
          {value ? <img src={value} alt="" /> : (
            <span>{uploading ? 'Envoi…' : dragging ? 'Déposez' : 'Image'}</span>
          )}
          {dragging && <i className={styles.dropOverlay}>Déposer ici</i>}
        </button>

        <div className={styles.controls}>
          <input
            ref={inputRef}
            className={styles.hidden}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture={undefined}
            onChange={(event) => acceptDrop(event.target.files)}
          />

          <div className={styles.buttonRow}>
            <button
              type="button"
              className="btn btn--ghost btn--sm"
              disabled={uploading}
              onClick={() => inputRef.current?.click()}
            >
              {uploading ? 'Envoi…' : value ? 'Changer l’image' : 'Choisir une image'}
            </button>
            <span className={styles.dropHint}>ou glisser-déposer</span>
          </div>

          <input
            className="input"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="ou coller une URL https://…"
            inputMode="url"
          />

          <small>
            {helper ?? 'Photo iPhone/Android ou fichier PC · JPG, PNG, WebP · 8 Mo max.'}
          </small>
        </div>
      </div>

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
