import type { NextConfig } from "next";

/**
 * 모든 응답에 붙이는 보안 헤더.
 * - 다른 사이트가 이 앱을 iframe으로 띄워 클릭을 유도하지 못하게 한다(frame-ancestors, X-Frame-Options).
 * - 브라우저가 파일 형식을 추측해 실행하지 않게 하고(nosniff), 다른 사이트로 넘어갈 때 주소 전체를 넘기지 않는다.
 * - HTTPS로 한 번 접속하면 이후 1년간 HTTPS만 쓰게 한다(HSTS — http://localhost에서는 브라우저가 무시한다).
 * 스크립트 출처를 제한하는 CSP(script-src)는 Next.js 인라인 스크립트에 nonce가 필요해 여기서는 걸지 않는다.
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  agentRules: false,
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
