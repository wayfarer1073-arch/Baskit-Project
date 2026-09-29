export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/** 개발·테스트에서 보낸 메일을 확인하는 곳(메일 서비스가 설정되지 않았을 때만 쌓인다). */
const outbox: MailMessage[] = [];
export function devOutbox(): readonly MailMessage[] {
  return outbox;
}

export function isMailConfigured(): boolean {
  return !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

/**
 * 메일 발송. RESEND_API_KEY·MAIL_FROM이 있으면 Resend HTTP API로 보내고, 없으면(개발 환경) 서버 로그와 메모리 보관함에만 남긴다.
 * 실패해도 호출한 요청을 깨뜨리지 않는다 — 가입·재설정 요청 자체는 성공하고, 메일은 다시 보내기로 복구한다.
 */
export async function sendMail(message: MailMessage): Promise<boolean> {
  if (!isMailConfigured()) {
    outbox.push(message);
    if (outbox.length > 50) outbox.shift();
    if (process.env.NODE_ENV !== 'test') console.info(`[mail:dev] to=${message.to} subject=${message.subject}\n${message.text}`);
    return true;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to: [message.to], subject: message.subject, text: message.text }),
    });
    if (!res.ok) console.error(`[mail] send failed: ${res.status}`);
    return res.ok;
  } catch (e) {
    console.error('[mail] send failed', e);
    return false;
  }
}

/** 메일 링크에 쓸 서비스 주소. APP_URL(권장) → AUTH_URL → 요청 주소 순. */
export function appUrl(request?: Request): string {
  const configured = process.env.APP_URL ?? process.env.AUTH_URL;
  if (configured) return configured.replace(/\/$/, '');
  if (request) return new URL(request.url).origin;
  return 'http://localhost:3000';
}
