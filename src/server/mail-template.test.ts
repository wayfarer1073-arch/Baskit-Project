import { describe, expect, it } from 'vitest';
import { escapeHtml, renderMailHtml } from './mail-template';

describe('renderMailHtml', () => {
  const base = {
    lang: 'ko' as const,
    baseUrl: 'https://limenote.cc',
    preheader: '미리보기',
    heading: '이메일 인증을 완료해 주세요',
    paragraphsHtml: ['<strong>홍길동</strong>님, 환영해요.'],
    button: { label: '이메일 인증하기', url: 'https://limenote.cc/verify-email?token=a&b' },
    fallbackLabel: '버튼이 눌리지 않으면',
  };

  it('버튼과 대체 링크에 같은 주소를 넣고, 로고는 서비스 주소에서 불러온다', () => {
    const html = renderMailHtml(base);
    expect(html).toContain('href="https://limenote.cc/verify-email?token=a&amp;b"');
    expect(html.match(/verify-email\?token=a&amp;b/g)).toHaveLength(3);
    expect(html).toContain('src="https://limenote.cc/logo-icon.png"');
    expect(html).toContain('이메일 인증하기');
  });

  it('사용자가 정한 글자는 HTML로 해석되지 않게 바꾼다', () => {
    expect(escapeHtml('<script>"x"&\'y\'</script>')).toBe('&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;');
    const html = renderMailHtml({ ...base, heading: '<b>워크스페이스</b>' });
    expect(html).not.toContain('<b>워크스페이스</b>');
    expect(html).toContain('&lt;b&gt;워크스페이스&lt;/b&gt;');
  });
});
