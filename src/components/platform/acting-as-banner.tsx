'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Eye } from 'lucide-react';

/** 운영자가 다른 워크스페이스에 들어가 있는 동안 항상 보이는 경고 띠. 여기서의 수정은 실제 고객 데이터에 반영된다. */
export function ActingAsBanner({ workspaceName }: { workspaceName: string }) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  async function leave() {
    setLeaving(true);
    await fetch('/api/admin/act-as', { method: 'DELETE' });
    router.push('/admin');
    router.refresh();
  }

  return (
    <div role="status" className="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-status-warning px-4 py-2 text-center text-sm font-medium text-white">
      <Eye className="size-4 shrink-0" aria-hidden="true" />
      <span>
        운영자 모드 — <strong>{workspaceName}</strong> 워크스페이스를 관리자 권한으로 보고 있어요. 여기서 바꾼 내용은 실제 데이터에 반영됩니다.
      </span>
      <button type="button" onClick={leave} disabled={leaving} className="rounded-md bg-white/20 px-2.5 py-0.5 text-xs font-semibold transition-colors hover:bg-white/30 disabled:opacity-60">
        {leaving ? '나가는 중…' : '콘솔로 나가기'}
      </button>
    </div>
  );
}
