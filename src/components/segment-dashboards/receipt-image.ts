/**
 * 영수증 사진 다루기(브라우저) — 올리기 전에 줄이고, 서버 OCR이 없으면 브라우저 안에서 글자를 읽는다.
 */

/** OCR.space 무료 등급 한도(1MB)보다 작게 — 긴 변 2000px, JPEG 품질을 낮춰 가며 맞춘다. */
export async function shrinkImage(file: Blob, maxBytes = 950_000, maxSide = 2000): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    let scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    for (let attempt = 0; attempt < 6; attempt++) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('canvas');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', attempt < 3 ? 0.85 - attempt * 0.1 : 0.6));
      if (blob && blob.size <= maxBytes) return blob;
      if (attempt >= 2) scale *= 0.8;
    }
    throw new Error('too_large');
  } finally {
    bitmap.close();
  }
}

/**
 * 브라우저 안에서 읽기(tesseract.js) — 키 없이 무료이고 사진이 밖으로 나가지 않는다.
 * 처음 한 번은 한국어 인식 데이터(약 7MB)를 내려받고, 그 뒤로는 브라우저에 남아 있다.
 */
export async function readInBrowser(image: Blob, onProgress: (percent: number) => void): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('kor', 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress(Math.round(m.progress * 100));
    },
  });
  try {
    await worker.setParameters({ preserve_interword_spaces: '1' });
    const { data } = await worker.recognize(image);
    return data.text;
  } finally {
    await worker.terminate();
  }
}
