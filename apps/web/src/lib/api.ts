import { NextResponse } from 'next/server';
import { z } from 'zod';
import { AppError, toAppError } from '@/lib/errors';

/** Réponses JSON homogènes pour toutes les routes d'API. */

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json({ ok: true, data }, { status: 200, ...init });
}

export function jsonError(error: unknown): NextResponse {
  const appError = toAppError(error);
  if (appError.status >= 500) {
    console.error('[api]', appError.code, appError.message, appError.details ?? '');
  }
  const headers: Record<string, string> = {};
  if (appError.code === 'rate_limited') {
    const retry = (appError.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
    if (retry) headers['Retry-After'] = String(retry);
  }
  return NextResponse.json(
    { ok: false, error: appError.message, code: appError.code },
    { status: appError.status, headers },
  );
}

/** Analyse et valide le corps JSON d'une requête. */
export async function parseBody<S extends z.ZodTypeAny>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw new AppError('bad_request', 'Corps de requête invalide.', 400);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new AppError(
      'validation',
      first ? `${first.path.join('.') || 'champ'} : ${first.message}` : 'Données invalides.',
      422,
      result.error.issues,
    );
  }
  return result.data;
}

export function parseQuery<S extends z.ZodTypeAny>(request: Request, schema: S): z.infer<S> {
  const url = new URL(request.url);
  const raw = Object.fromEntries(url.searchParams.entries());
  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new AppError(
      'validation',
      first ? `${first.path.join('.') || 'paramètre'} : ${first.message}` : 'Paramètres invalides.',
      422,
    );
  }
  return result.data;
}

/* ------------------------------------------------------------------
   Schémas réutilisés
   ------------------------------------------------------------------ */

export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{1,62}[a-z0-9]$/, 'Identifiant invalide.');

export const publicIdSchema = z
  .string()
  .trim()
  .regex(/^[0-9a-zA-Z]{8,32}$/, 'Identifiant invalide.');

export const uuidSchema = z.string().uuid('Identifiant invalide.');

/** Prénom client : court, sans HTML, jamais obligatoire par défaut. */
export const clientNameSchema = z
  .string()
  .trim()
  .min(1, 'Indiquez un prénom.')
  .max(40, 'Prénom trop long.')
  .regex(/^[^<>{}\\]+$/, 'Caractères non autorisés.');
