import { afterEach, describe, expect, it, vi } from 'vitest';
import { ocrSpaceText, ReceiptOcrError, serverOcrAvailable } from './receipt-ocr';

const ok = (text: string) => new Response(JSON.stringify({ ParsedResults: [{ ParsedText: text }], IsErroredOnProcessing: false }), { status: 200 });
const failed = (message: string) => new Response(JSON.stringify({ IsErroredOnProcessing: true, ErrorMessage: [message] }), { status: 200 });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('OCR.space receipt reading', () => {
  it('is available only with a key', () => {
    vi.stubEnv('OCR_SPACE_API_KEY', '');
    expect(serverOcrAvailable()).toBe(false);
    vi.stubEnv('OCR_SPACE_API_KEY', 'k');
    expect(serverOcrAvailable()).toBe(true);
  });

  it('sends the image as a receipt table with the key header (engine 3 by default)', async () => {
    vi.stubEnv('OCR_SPACE_API_KEY', 'test-key');
    const fetchMock = vi.fn().mockResolvedValue(ok('아메리카노\t4,500\t2\t9,000'));
    vi.stubGlobal('fetch', fetchMock);
    const result = await ocrSpaceText(new Blob(['x'], { type: 'image/jpeg' }), 'r.jpg');
    expect(result).toEqual({ text: '아메리카노\t4,500\t2\t9,000', engine: '3' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.ocr.space/parse/image');
    expect(init.headers).toEqual({ apikey: 'test-key' });
    const body = init.body as FormData;
    expect([body.get('OCREngine'), body.get('language'), body.get('isTable'), body.get('scale')]).toEqual(['3', 'auto', 'true', 'true']);
    expect(body.get('file')).toBeInstanceOf(Blob);
  });

  it('retries with engine 1 in Korean when the first engine fails, and reports the first error if both fail', async () => {
    vi.stubEnv('OCR_SPACE_API_KEY', 'test-key');
    const fetchMock = vi.fn().mockResolvedValueOnce(failed('E3 limit')).mockResolvedValueOnce(ok('카페라떼 1 5,000'));
    vi.stubGlobal('fetch', fetchMock);
    expect(await ocrSpaceText(new Blob(['x']), 'r.jpg')).toEqual({ text: '카페라떼 1 5,000', engine: '1' });
    const body = fetchMock.mock.calls[1][1].body as FormData;
    expect([body.get('OCREngine'), body.get('language')]).toEqual(['1', 'kor']);

    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(failed('E3 limit')).mockRejectedValueOnce(new Error('network')));
    await expect(ocrSpaceText(new Blob(['x']), 'r.jpg')).rejects.toThrow(new ReceiptOcrError('E3 limit'));
  });
});
