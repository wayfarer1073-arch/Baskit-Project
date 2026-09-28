'use client';

import type { useRouter } from 'next/navigation';

/** 운영자 콘솔 공통 요청 헬퍼. 실패하면 서버가 준 메시지로 오류를 던진다. */
export async function adminRequest<T = unknown>(url: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? '요청에 실패했습니다.');
  return data as T;
}

/** 워크스페이스에 들어간 뒤 그 워크스페이스의 기본 대시보드로 이동한다(레이아웃도 새 조직 기준으로 다시 그린다). */
export async function enterWorkspace(id: string, router: ReturnType<typeof useRouter>) {
  await adminRequest(`/api/admin/workspaces/${id}/enter`, 'POST');
  router.push('/');
  router.refresh();
}
