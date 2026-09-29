/** 한국어 사전과 같은 모양(같은 키)을 가진 다른 언어 사전 타입. */
export type Dictionary<T> = { [K in keyof T]: T[K] extends string ? string : Dictionary<T[K]> };
