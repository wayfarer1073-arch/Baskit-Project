/**
 * 보관 기한 정리를 한 번 실행한다(/api/cron/maintenance와 같은 작업).
 * 사용법: npm run db:maintenance
 * 기한은 UPLOAD_FILE_RETENTION_DAYS 등 환경변수로 바꿀 수 있다(src/server/maintenance/retention.ts).
 */
import { prisma } from '../src/lib/prisma';
import { retentionPolicyFromEnv, runRetention } from '../src/server/maintenance/retention';

async function main() {
  const policy = retentionPolicyFromEnv();
  console.log('보관 기한(일, 0 = 지우지 않음):', policy);
  const report = await runRetention(new Date(), policy);
  console.log('정리한 항목:', report);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
