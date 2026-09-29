/** 업로드 파일 최대 크기 — 일반적인 재고 Excel보다 훨씬 넉넉한 상한(동기 파싱 리소스 보호용). */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** 이보다 큰 파일은 응답을 먼저 돌려주고 뒤에서 처리한다(화면은 작업 상태를 조회해 결과를 보여준다). */
export const BACKGROUND_UPLOAD_BYTES = 2 * 1024 * 1024;
