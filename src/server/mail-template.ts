/**
 * 서비스 메일(가입 인증·비밀번호 재설정·팀 초대)의 HTML 양식.
 *
 * 메일 프로그램은 CSS 지원이 제각각이라 표(table)와 인라인 스타일로만 만든다(Gmail·Outlook·애플 메일·네이버 메일).
 * 이름·워크스페이스 이름처럼 사용자가 정한 글자는 반드시 escapeHtml을 거친다.
 */

const BRAND = {
  lime: '#afe343',
  limeText: '#161d0e',
  ink: '#111418',
  muted: '#6b7280',
  line: '#e5e7eb',
  page: '#f4f5f7',
  header: '#111419',
};
const FONT = "'Apple SD Gothic Neo','Malgun Gothic','Noto Sans KR',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export interface MailLayout {
  /** 받은편지함 목록에서 제목 옆에 미리 보이는 한 줄(본문에는 보이지 않는다). */
  preheader: string;
  heading: string;
  /** 본문 문단 — 이미 escape된 HTML(굵게 표시용 <strong>만 허용해서 만든다). */
  paragraphsHtml: string[];
  button: { label: string; url: string };
  /** 버튼 아래 작은 안내(유효 기간 등). */
  note?: string;
  /** 버튼이 안 눌릴 때 링크를 복사하라는 안내. */
  fallbackLabel: string;
  /** 맨 아래 회색 안내(본인이 요청하지 않았다면 무시 등). */
  footnote?: string;
  /** 서비스 주소 — 로고 이미지와 하단 링크에 쓴다. */
  baseUrl: string;
  lang: 'ko' | 'en';
}

export function renderMailHtml(layout: MailLayout): string {
  const { button, baseUrl } = layout;
  const url = escapeHtml(button.url);
  const site = escapeHtml(baseUrl);
  const host = escapeHtml(baseUrl.replace(/^https?:\/\//, ''));
  const p = (html: string) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.7;color:${BRAND.ink};">${html}</p>`;

  return `<!doctype html>
<html lang="${layout.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${escapeHtml(layout.heading)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.page};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${escapeHtml(layout.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.page};">
  <tr>
    <td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;font-family:${FONT};">
        <tr>
          <td style="background:${BRAND.header};border-radius:14px 14px 0 0;padding:20px 28px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="vertical-align:middle;padding-right:10px;"><img src="${site}/logo-icon.png" width="32" height="32" alt="" style="display:block;border:0;border-radius:8px;"></td>
                <td style="vertical-align:middle;font-size:18px;font-weight:700;letter-spacing:-0.2px;color:#ffffff;">Limenote</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;padding:32px 28px 28px;border-left:1px solid ${BRAND.line};border-right:1px solid ${BRAND.line};">
            <h1 style="margin:0 0 18px;font-size:22px;line-height:1.4;font-weight:700;color:${BRAND.ink};">${escapeHtml(layout.heading)}</h1>
            ${layout.paragraphsHtml.map(p).join('\n            ')}
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 10px;">
              <tr>
                <td style="border-radius:10px;background:${BRAND.lime};">
                  <a href="${url}" target="_blank" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:${BRAND.limeText};text-decoration:none;border-radius:10px;">${escapeHtml(button.label)}</a>
                </td>
              </tr>
            </table>
            ${layout.note ? `<p style="margin:0 0 22px;font-size:13px;color:${BRAND.muted};">${escapeHtml(layout.note)}</p>` : ''}
            <p style="margin:0 0 6px;font-size:12px;color:${BRAND.muted};">${escapeHtml(layout.fallbackLabel)}</p>
            <p style="margin:0;font-size:12px;line-height:1.6;word-break:break-all;"><a href="${url}" target="_blank" style="color:${BRAND.ink};">${url}</a></p>
          </td>
        </tr>
        <tr>
          <td style="background:#ffffff;border:1px solid ${BRAND.line};border-top:1px solid ${BRAND.line};border-radius:0 0 14px 14px;padding:18px 28px;">
            ${layout.footnote ? `<p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:${BRAND.muted};">${escapeHtml(layout.footnote)}</p>` : ''}
            <p style="margin:0;font-size:12px;color:${BRAND.muted};">Limenote · <a href="${site}" target="_blank" style="color:${BRAND.muted};">${host}</a></p>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
