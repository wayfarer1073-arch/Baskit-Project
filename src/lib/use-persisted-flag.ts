'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * 브라우저에 기억해 두는 켜기/끄기 값(보는 사람 기기별 화면 설정). 저장소를 쓸 수 없으면 메모리 값만 쓴다.
 * 서버 렌더링 때는 기본값으로 그린 뒤 브라우저에서 저장된 값으로 맞춘다.
 */
const memory = new Map<string, boolean>();
const listeners = new Map<string, Set<() => void>>();

function read(key: string, fallback: boolean): boolean {
  try {
    const saved = window.localStorage.getItem(key);
    return saved === null ? (memory.get(key) ?? fallback) : saved !== '0';
  } catch {
    return memory.get(key) ?? fallback;
  }
}

function write(key: string, value: boolean) {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // 저장할 수 없으면 메모리 값만 쓴다.
  }
  listeners.get(key)?.forEach((listener) => listener());
}

export function usePersistedFlag(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
  const subscribe = useCallback(
    (listener: () => void) => {
      const set = listeners.get(key) ?? new Set();
      set.add(listener);
      listeners.set(key, set);
      const onStorage = (e: StorageEvent) => {
        if (e.key === key) listener();
      };
      window.addEventListener('storage', onStorage);
      return () => {
        set.delete(listener);
        window.removeEventListener('storage', onStorage);
      };
    },
    [key],
  );
  const value = useSyncExternalStore(
    subscribe,
    () => read(key, fallback),
    () => fallback,
  );
  const setValue = useCallback((next: boolean) => write(key, next), [key]);
  return [value, setValue];
}
