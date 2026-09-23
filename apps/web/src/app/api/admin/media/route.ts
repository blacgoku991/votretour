import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertPlatformAdmin } from '@/server/auth';
import { env } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const purposeSchema = z.enum(['logo', 'cover', 'event-logo', 'event-cover']);
const MAX_BYTES = 8 * 1024 * 1024;

const TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

function mediaRoot() {
  return process.env.MEDIA_ROOT?.trim() || '/app/data/uploads';
}

export async function POST(request: Request) {
  try {
    await assertPlatformAdmin();

    const form = await request.formData();
    const file = form.get('file');
    const purpose = purposeSchema.safeParse(form.get('purpose') || 'logo');

    if (!purpose.success) {
      return NextResponse.json({ ok: false, error: 'Type de média invalide.' }, { status: 422 });
    }

    if (!(file instanceof File)) {
      return NextResponse.json({ ok: false, error: 'Aucun fichier reçu.' }, { status: 400 });
    }

    if (!TYPES[file.type]) {
      return NextResponse.json(
        { ok: false, error: 'Format accepté : JPG, PNG ou WebP.' },
        { status: 415 },
      );
    }

    if (file.size <= 0 || file.size > MAX_BYTES) {
      return NextResponse.json(
        { ok: false, error: 'Image trop volumineuse. Maximum : 8 Mo.' },
        { status: 413 },
      );
    }

    const now = new Date();
    const folder = [
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, '0'),
    ].join('/');

    const extension = TYPES[file.type]!;
    const filename = `${purpose.data}-${randomUUID()}.${extension}`;
    const root = mediaRoot();
    const directory = path.join(root, folder);
    await mkdir(directory, { recursive: true });

    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(directory, filename), bytes, { flag: 'wx' });

    const relative = `${folder}/${filename}`;
    return NextResponse.json({
      ok: true,
      data: {
        url: `${env.siteUrl}/media/${relative}`,
        size: file.size,
        type: file.type,
      },
    });
  } catch (error) {
    console.error('[admin-media]', error);
    return NextResponse.json(
      { ok: false, error: 'Impossible d’enregistrer cette image.' },
      { status: 500 },
    );
  }
}
