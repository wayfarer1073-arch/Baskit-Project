import { normalizeString } from './aoa-reader';

/**
 * 샘플 양식의 작성 방법·예시 행 표시. 헤더 바로 아래 두 줄에 이 말로 시작하는 칸을 넣어 두고,
 * 사용자가 지우지 않고 올려도 파서가 그 행을 건너뛴다(실제 품목으로 저장되지 않도록).
 */
export const EXAMPLE_ROW_MARKERS = ['[작성 방법', '[예시', '[how to', '[example'];

export function isExampleRow(row: string[]): boolean {
  return row.some((cell) => {
    const v = normalizeString(cell).toLowerCase();
    return v.startsWith('[') && EXAMPLE_ROW_MARKERS.some((m) => v.startsWith(m));
  });
}

/** 빈 행과 예시 행을 뺀 데이터 행, 그리고 건너뛴 예시 행 수. */
export function splitDataRows(rows: string[][]): { dataRows: string[][]; exampleRows: number } {
  const nonEmpty = rows.filter((r) => r.some((c) => normalizeString(c) !== ''));
  const dataRows = nonEmpty.filter((r) => !isExampleRow(r));
  return { dataRows, exampleRows: nonEmpty.length - dataRows.length };
}

export const exampleRowsSkippedMessage = (count: number) => `샘플 양식의 작성 방법·예시 행 ${count}개는 읽지 않고 건너뛰었어요.`;
