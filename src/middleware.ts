import { NextResponse } from 'next/server';
import { auth } from '@/server/auth';

const PUBLIC_PATHS = ['/forgot-password', '/reset-password', '/verify-email', '/invite', '/terms', '/privacy'];

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const path = req.nextUrl.pathname;
  const isLoginPage = path.startsWith('/login') || path.startsWith('/signup');
  // 로그인 없이 열리는 화면(메일 링크·약관). 로그인한 상태에서도 그대로 보여준다.
  const isPublicPage = PUBLIC_PATHS.some((p) => path === p || path.startsWith(`${p}/`));
  if (isPublicPage) return NextResponse.next();

  if (!isLoggedIn && !isLoginPage) {
    const loginUrl = new URL('/login', req.nextUrl.origin);
    loginUrl.searchParams.set('callbackUrl', req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }
  // 세션은 살아 있지만 계정 비활성화·워크스페이스 정지로 앱에서 막힌 경우(reason=blocked)에는 로그인 화면을
  // 그대로 보여준다 — 여기서 다시 /로 보내면 레이아웃이 /login으로 돌려보내 무한 리다이렉트가 된다.
  if (isLoggedIn && isLoginPage && req.nextUrl.searchParams.get('reason') !== 'blocked') {
    return NextResponse.redirect(new URL('/', req.nextUrl.origin));
  }
  return NextResponse.next();
});

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpe?g|webp|gif|ico)$).*)'],
};
