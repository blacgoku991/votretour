import { readFile } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

function mediaRoot() {
  return process.env.MEDIA_ROOT?.trim() || '/app/data/uploads';
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path: parts } = await context.params;

  if (
    !Array.isArray(parts)
    || parts.length < 2
    || parts.length > 4
    || parts.some((part) => !/^[a-zA-Z0-9._-]+$/.test(part))
  ) {
    return new Response('Introuvable', { status: 404 });
  }

  const root = path.resolve(mediaRoot());
  const target = path.resolve(root, ...parts);

  if (!target.startsWith(root + path.sep)) {
    return new Response('Introuvable', { status: 404 });
  }

  const contentType = MIME[path.extname(target).toLowerCase()];
  if (!contentType) return new Response('Introuvable', { status: 404 });

  try {
    const file = await readFile(target);
    return new Response(new Uint8Array(file), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return new Response('Introuvable', { status: 404 });
  }
}
