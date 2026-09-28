/**
 * 서비스 운영자 권한 부여/회수. 앱 화면에서는 이 권한을 줄 수 없고 DB에 직접 접근하는 이 스크립트로만 바꾼다.
 * (가입에 이메일 인증이 없어, 이메일만으로 운영자를 판단하면 그 이메일로 먼저 가입한 사람이 권한을 가져갈 수 있다.)
 *
 * 사용법: npm run db:grant-platform-admin -- --email me@example.com [--revoke]
 * Render 무료 플랜처럼 Shell이 없으면 로컬에서 DATABASE_URL을 Render DB의 External URL로 지정해 실행한다.
 */
import { prisma } from '../src/lib/prisma';

async function main() {
  const i = process.argv.indexOf('--email');
  const email = i === -1 ? undefined : process.argv[i + 1]?.trim().toLowerCase();
  if (!email) {
    console.error('사용법: npm run db:grant-platform-admin -- --email me@example.com [--revoke]');
    process.exit(1);
  }
  const revoke = process.argv.includes('--revoke');
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`계정을 찾을 수 없습니다: ${email} (먼저 /signup으로 가입하세요)`);
    process.exit(1);
  }
  await prisma.user.update({ where: { id: user.id }, data: { isPlatformAdmin: !revoke } });
  console.log(`${email}: 운영자 권한 ${revoke ? '회수' : '부여'} 완료`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
