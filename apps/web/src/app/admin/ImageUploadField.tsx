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
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
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
      if (inputRef.current) inputRef.current.value = '';
    }
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

      <div className={styles.body}>
        <div className={[styles.preview, purpose.includes('cover') ? styles.coverPreview : ''].join(' ')}>
          {value ? <img src={value} alt="" /> : <span>Image</span>}
        </div>

        <div className={styles.controls}>
          <input
            ref={inputRef}
            className={styles.hidden}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
            }}
          />

          <button
            type="button"
            className="btn btn--ghost btn--sm"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? 'Envoi…' : value ? 'Changer l’image' : 'Choisir une image'}
          </button>

          <input
            className="input"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="ou coller une URL https://…"
            inputMode="url"
          />

          <small>{helper ?? 'JPG, PNG ou WebP · 8 Mo max.'}</small>
        </div>
      </div>

      {error && <p className={styles.error}>{error}</p>}
    </div>
  );
}
