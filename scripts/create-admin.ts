/**
 * 최초 관리자 계정 생성 스크립트.
 * 사용법: npm run db:create-admin -- --email admin@company.com --password secret123 --name 관리자
 * 이미 존재하는 이메일의 비밀번호를 바꾸려면 --reset-existing 플래그를 명시해야 한다.
 * 새 계정은 --org-id로 지정한 워크스페이스에, 없으면 --org 이름으로 새 워크스페이스를 만들어 넣는다.
 * (일반 사용자는 /signup 화면에서 워크스페이스와 관리자 계정을 함께 만든다.)
 */
import { hashPassword } from '../src/lib/password';
import { prisma } from '../src/lib/prisma';

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function main() {
  const email = (getArg('email') ?? 'admin@company.com').trim().toLowerCase();
  const password = getArg('password');
  const name = getArg('name') ?? '관리자';
  const resetExisting = hasFlag('reset-existing');

  if (!password) {
    console.error('--password는 필수입니다 (기본 비밀번호로 자동 설정하지 않습니다).');
    console.error('사용법: npm run db:create-admin -- --email admin@company.com --password <8자 이상> --name 관리자');
    process.exit(1);
  }
  if (password.length < 8) {
    console.error('비밀번호는 8자 이상이어야 합니다.');
    process.exit(1);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing && !resetExisting) {
    console.error(`이미 존재하는 계정입니다: ${email}. 비밀번호를 바꾸려면 --reset-existing 플래그를 추가하세요.`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);

  if (existing) {
    const user = await prisma.user.update({ where: { email }, data: { passwordHash, name, role: 'ADMIN' } });
    console.log(`관리자 계정이 준비되었습니다: ${user.email} (role=${user.role})`);
    return;
  }

  const orgId = getArg('org-id');
  const organization = orgId
    ? await prisma.organization.findUniqueOrThrow({ where: { id: orgId } })
    : await prisma.organization.create({ data: { name: getArg('org') ?? '기본 워크스페이스' } });
  const user = await prisma.user.create({
    data: { organizationId: organization.id, email, passwordHash, name, role: 'ADMIN' },
  });
  console.log(`워크스페이스: ${organization.name} (${organization.id})`);

  console.log(`관리자 계정이 준비되었습니다: ${user.email} (role=${user.role})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
