import type { DefaultSession } from '@auth/core/types';

declare module '@auth/core/types' {
  interface Session {
    user: {
      id: string;
      role: 'MEMBER' | 'ADMIN';
      organizationId: string;
    } & DefaultSession['user'];
  }

  interface User {
    id: string;
    role: 'MEMBER' | 'ADMIN';
    organizationId: string;
  }
}

declare module '@auth/core/jwt' {
  interface JWT {
    id: string;
    role: 'MEMBER' | 'ADMIN';
    organizationId?: string;
  }
}
