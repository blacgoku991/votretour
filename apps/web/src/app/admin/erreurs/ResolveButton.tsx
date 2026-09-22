'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { resolveSystemError } from '@/server/actions/admin';

export function ResolveButton({ errorId }: { errorId: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button type="button" className="btn btn--ghost btn--sm" disabled={pending}
      onClick={() => startTransition(async () => {
        await resolveSystemError(errorId);
        router.refresh();
      })}>
      {pending ? '…' : 'Marquer résolu'}
    </button>
  );
}
