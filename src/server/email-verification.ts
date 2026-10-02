import { isMailConfigured } from '@/server/mail';

/**
 * 이메일 인증 전에는 앱에 들어가지 못하게 한다. 단, 메일을 보낼 수 없는 환경(메일 서비스 미설정)에서는
 * 인증할 방법이 없으므로 막지 않는다 — 상단 안내 띠만 보인다.
 */
export function mustVerifyEmail(account: { emailVerifiedAt: Date | null }): boolean {
  return !account.emailVerifiedAt && isMailConfigured();
}
