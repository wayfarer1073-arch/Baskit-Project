/**
 * CSV·TSV 같은 텍스트 표 파일의 글자 인코딩을 판별해 문자열로 바꾼다.
 * 국내 ERP·엑셀의 "CSV로 저장"은 EUC-KR(CP949)인 경우가 많아, UTF-8로 그대로 읽으면 한글이 깨진다.
 * 엑셀 통합문서(.xlsx=zip, .xls=OLE)나 HTML 표는 텍스트 표가 아니므로 null을 돌려준다.
 */
export type TextEncodingName = 'utf-8' | 'utf-16le' | 'utf-16be' | 'euc-kr';

export function isBinaryWorkbook(buffer: Buffer): boolean {
  // zip(xlsx) 'PK\x03\x04', OLE 복합문서(xls) D0 CF 11 E0
  return (buffer[0] === 0x50 && buffer[1] === 0x4b) || (buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0);
}

export function detectTextEncoding(buffer: Buffer): TextEncodingName {
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) return 'utf-8';
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return 'utf-16le';
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return 'utf-16be';
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    return 'utf-8';
  } catch {
    // UTF-8로 읽을 수 없는 바이트가 있으면 국내 환경의 기본값인 EUC-KR(CP949 포함)로 본다.
    return 'euc-kr';
  }
}

/** 텍스트 표 파일이면 BOM을 뺀 문자열, 엑셀 통합문서·HTML 표면 null. */
export function decodeTextTable(buffer: Buffer): { text: string; encoding: TextEncodingName } | null {
  if (buffer.length === 0 || isBinaryWorkbook(buffer)) return null;
  const encoding = detectTextEncoding(buffer);
  let text: string;
  if (encoding === 'utf-16be') {
    // TextDecoder는 utf-16be를 지원하지 않는 환경이 있어 바이트를 뒤집어 LE로 읽는다.
    const swapped = Buffer.from(buffer);
    swapped.swap16();
    text = new TextDecoder('utf-16le').decode(swapped);
  } else {
    text = new TextDecoder(encoding).decode(buffer);
  }
  text = text.replace(/^﻿/, '');
  const head = text.slice(0, 2048).toLowerCase();
  if (head.includes('<html') || head.includes('<table')) return null;
  return { text, encoding };
}
