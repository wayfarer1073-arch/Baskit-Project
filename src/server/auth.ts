import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';

export const { handlers, signIn, signOut, auth } = NextAuth({
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  // Vercel 외 자체 호스팅 배포(Docker 등)에서는 명시적으로 Host 헤더를 신뢰해야 한다.
  trustHost: true,
  providers: [
    Credentials({
      credentials: {
        email: { label: '이메일', type: 'email' },
        password: { label: '비밀번호', type: 'password' },
      },
      authorize: async (credentials) => {
        const email = typeof credentials?.email === 'string' ? credentials.email.trim().toLowerCase() : undefined;
        const password = typeof credentials?.password === 'string' ? credentials.password : undefined;
        if (!email || !password) return null;

        const user = await prisma.user.findUnique({ where: { email }, include: { organization: { select: { suspendedAt: true } } } });
        if (!user || !user.isActive) return null;
        // 정지된 워크스페이스는 로그인할 수 없다(운영자 본인은 예외 — 콘솔에서 해제해야 하므로).
        if (user.organization.suspendedAt && !user.isPlatformAdmin) return null;

        const valid = await bcrypt.compare(password, user.passwordHash);
        if (!valid) return null;

        await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

        return { id: user.id, email: user.email, name: user.name, role: user.role, organizationId: user.organizationId };
      },
    }),
  ],
  callbacks: {
    jwt: async ({ token, user }) => {
      if (user) {
        token.id = user.id;
        token.role = user.role;
        token.organizationId = user.organizationId;
      } else if (token.id && !token.organizationId) {
        // 멀티테넌시 도입 전에 발급된 토큰은 조직 정보가 없다 — 한 번만 DB에서 채워 넣는다.
        const row = await prisma.user.findUnique({ where: { id: token.id }, select: { organizationId: true } });
        if (row) token.organizationId = row.organizationId;
      }
      return token;
    },
    session: async ({ session, token }) => {
      session.user.id = token.id;
      session.user.role = token.role;
      session.user.organizationId = token.organizationId ?? '';
      return session;
    },
  },
});
