import { NextResponse } from 'next/server';
import { z } from 'zod';
import { forbidViewer, getTenant } from '@/server/tenant';
import { previewReceipt } from '@/server/services/menu-service';
import { OCR_SPACE_MAX_BYTES, ocrSpaceText, ReceiptOcrError, serverOcrAvailable } from '@/server/services/receipt-ocr';

const MAX_TEXT = 20_000;
const textSchema = z.object({ text: z.string().max(MAX_TEXT), engine: z.enum(['browser', 'edited']).default('browser') });

/**
 * 영수증 미리보기 — 사진(서버 OCR, OCR_SPACE_API_KEY가 있을 때) 또는 이미 읽은 글자(브라우저 OCR·직접 고친 글자)를 받아
 * 판매 줄을 뽑고 메뉴를 맞춰 본다. 저장은 하지 않는다.
 */
export async function POST(request: Request) {
  const tenant = await getTenant();
  if (!tenant) return NextResponse.json({ error: '로그인이 필요합니다.' }, { status: 401 });
  const viewerDenied = forbidViewer(tenant);
  if (viewerDenied) return viewerDenied;

  if ((request.headers.get('content-type') ?? '').includes('application/json')) {
    const parsed = textSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: '영수증 글자가 올바르지 않습니다.' }, { status: 400 });
    return NextResponse.json(await previewReceipt(tenant.orgId, parsed.data.text, parsed.data.engine));
  }

  if (!serverOcrAvailable()) return NextResponse.json({ error: '서버 영수증 인식이 설정되지 않았습니다.', fallback: 'browser' }, { status: 503 });
  const form = await request.formData().catch(() => null);
  const image = form?.get('image');
  if (!(image instanceof File)) return NextResponse.json({ error: '사진을 선택하세요.' }, { status: 400 });
  if (!image.type.startsWith('image/')) return NextResponse.json({ error: '사진 파일만 올릴 수 있습니다.' }, { status: 400 });
  if (image.size > OCR_SPACE_MAX_BYTES) return NextResponse.json({ error: '사진이 너무 큽니다(최대 1MB).' }, { status: 400 });
  try {
    const { text, engine } = await ocrSpaceText(image, image.name || 'receipt.jpg');
    return NextResponse.json(await previewReceipt(tenant.orgId, text, `ocr.space-${engine}`));
  } catch (e) {
    const message = e instanceof ReceiptOcrError ? e.message : '영수증을 읽지 못했습니다.';
    return NextResponse.json({ error: message, fallback: 'browser' }, { status: 502 });
  }
}
