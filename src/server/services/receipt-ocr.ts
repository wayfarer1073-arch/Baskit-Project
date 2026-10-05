/**
 * 영수증 사진 → 글자. OCR.space 무료 API(월 25,000건, 이미지 1MB 이하)를 쓴다.
 *
 * Render 환경 변수 OCR_SPACE_API_KEY에 무료 키가 있으면 서버에서 읽고, 없으면 화면이 브라우저 안에서
 * 직접 읽는다(tesseract.js — 키 없이 무료, 사진이 밖으로 나가지 않지만 덜 정확하다).
 * 엔진은 OCR_SPACE_ENGINE(기본 3 — 한국어를 포함한 다국어 인식, 무료 월 2,500건)으로 고르고,
 * 실패하면(한도 초과 등) 한국어를 지정한 엔진 1로 한 번 더 시도한다.
 */

const ENDPOINT = 'https://api.ocr.space/parse/image';
const TIMEOUT_MS = 30_000;
/** 무료 등급 이미지 한도 — 화면에서 이보다 작게 줄여 보낸다. */
export const OCR_SPACE_MAX_BYTES = 1024 * 1024;

export class ReceiptOcrError extends Error {}

export function serverOcrAvailable(): boolean {
  return Boolean(process.env.OCR_SPACE_API_KEY);
}

interface OcrSpaceResponse {
  ParsedResults?: { ParsedText?: string; ErrorMessage?: string }[];
  IsErroredOnProcessing?: boolean;
  ErrorMessage?: string | string[];
}

async function callOcrSpace(image: Blob, filename: string, engine: string): Promise<string> {
  const body = new FormData();
  body.append('file', image, filename);
  // 엔진 1은 언어를 정해야 하고, 2·3은 언어를 스스로 알아낸다.
  body.append('language', engine === '1' ? 'kor' : 'auto');
  body.append('OCREngine', engine);
  body.append('isTable', 'true'); // 영수증·표: 한 줄씩 돌려준다
  body.append('scale', 'true');
  body.append('detectOrientation', 'true');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { apikey: process.env.OCR_SPACE_API_KEY ?? '' },
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const data = (await res.json().catch(() => null)) as OcrSpaceResponse | null;
  if (!res.ok || !data) throw new ReceiptOcrError(`OCR 서비스 응답 오류(${res.status})`);
  if (data.IsErroredOnProcessing) {
    const message = Array.isArray(data.ErrorMessage) ? data.ErrorMessage.join(' ') : data.ErrorMessage;
    throw new ReceiptOcrError(message || 'OCR 처리 실패');
  }
  const text = (data.ParsedResults ?? []).map((r) => r.ParsedText ?? '').join('\n');
  if (!text.trim()) throw new ReceiptOcrError('글자를 찾지 못했어요.');
  return text;
}

/** OCR.space로 읽는다 — 정한 엔진이 실패하면 다른 엔진으로 한 번 더. */
export async function ocrSpaceText(image: Blob, filename: string): Promise<{ text: string; engine: string }> {
  const first = process.env.OCR_SPACE_ENGINE && ['1', '2', '3'].includes(process.env.OCR_SPACE_ENGINE) ? process.env.OCR_SPACE_ENGINE : '3';
  const second = first === '1' ? '3' : '1';
  try {
    return { text: await callOcrSpace(image, filename, first), engine: first };
  } catch (e) {
    try {
      return { text: await callOcrSpace(image, filename, second), engine: second };
    } catch {
      throw e instanceof ReceiptOcrError ? e : new ReceiptOcrError('OCR 서비스에 연결하지 못했어요.');
    }
  }
}
