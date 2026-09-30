import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { buildGuideRows, buildTemplateSheet, GUIDE_SHEET_NAME, type TemplateType } from '@/domain/excel/templates';

/** 설정/업로드 화면의 "샘플파일 다운로드" 버튼이 쓰는 공용 응답 빌더. 첫 시트는 업로드 양식, 둘째 시트는 작성 가이드. */
export function templateDownloadResponse(type: TemplateType): NextResponse {
  const sheet = buildTemplateSheet(type);
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([sheet.headers, ...sheet.rows]);
  ws['!cols'] = sheet.columnWidths.map((wch) => ({ wch }));
  // 상품코드·바코드처럼 앞자리 0이 있는 값이 숫자로 바뀌지 않도록 글자 칸은 텍스트 서식으로 둔다.
  for (const address of Object.keys(ws)) {
    const cell = ws[address] as XLSX.CellObject | undefined;
    if (!address.startsWith('!') && cell?.t === 's') cell.z = '@';
  }
  XLSX.utils.book_append_sheet(wb, ws, sheet.sheetName);
  const guide = XLSX.utils.aoa_to_sheet(buildGuideRows(sheet));
  guide['!cols'] = [{ wch: 16 }, { wch: 10 }, { wch: 60 }, { wch: 18 }];
  XLSX.utils.book_append_sheet(wb, guide, GUIDE_SHEET_NAME);
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  return new NextResponse(buffer as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="template.xlsx"; filename*=UTF-8''${encodeURIComponent(sheet.fileName)}`,
    },
  });
}
