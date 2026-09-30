/** 업로드 파일 최대 크기 — 일반적인 재고 Excel보다 훨씬 넉넉한 상한(동기 파싱 리소스 보호용). */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** 이보다 큰 파일은 응답을 먼저 돌려주고 뒤에서 처리한다(화면은 작업 상태를 조회해 결과를 보여준다). */
export const BACKGROUND_UPLOAD_BYTES = 2 * 1024 * 1024;

/** 한 번에 올릴 수 있는 데이터 행 수(헤더 행 제외, 빈 행 제외). 재고·소비기한·상품 추가 정보·매출 업로드 모두 같다. */
export const MAX_UPLOAD_DATA_ROWS = 500;

/**
 * 시트에서 실제로 읽는 최대 행 수. 헤더 위의 제목 줄·중간의 빈 줄을 감안해 넉넉히 두고, 그 뒤는 읽지 않는다 —
 * 수십만 행짜리 파일을 끝까지 풀어 메모리를 쓰지 않도록. 이보다 길면 "500행 초과"로 거절된다.
 */
export const MAX_SHEET_ROWS_READ = MAX_UPLOAD_DATA_ROWS + 100;

/** 엑셀(xlsx = zip) 안의 파일들을 풀었을 때 합계 상한. 작은 파일이 풀리면서 수 GB가 되는 압축 폭탄을 막는다. */
export const MAX_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
