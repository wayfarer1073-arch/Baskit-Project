/**
 * DB에 들어 있는 업로드 원본 파일을 객체 저장소(FILE_STORAGE_*)로 옮기고 DB의 내용 칸을 비운다.
 * 저장소를 새로 설정한 뒤 한 번 실행한다. 여러 번 실행해도 안전하다(이미 옮긴 파일은 건너뛴다).
 * 사용법: npm run db:move-files
 */
import { prisma } from '../src/lib/prisma';
import { getFileStore } from '../src/server/storage/file-store';

const BATCH = 50;

async function main() {
  const store = getFileStore();
  if (!store) throw new Error('FILE_STORAGE_BUCKET 등 객체 저장소 환경변수를 먼저 설정하세요.');
  let moved = 0;
  for (;;) {
    const rows = await prisma.uploadFile.findMany({ where: { storageKey: null, data: { not: null } }, take: BATCH });
    if (rows.length === 0) break;
    for (const r of rows) {
      const key = `uploads/${r.organizationId}/${r.snapshotId}/${r.sha256}`;
      await store.put(key, Buffer.from(r.data!), r.contentType);
      await prisma.uploadFile.update({ where: { id: r.id }, data: { storageKey: key, data: null } });
      moved++;
    }
    console.log(`  ${moved}개 옮김`);
  }
  console.log(`완료: ${moved}개 파일을 저장소로 옮겼습니다. DB 공간을 돌려받으려면 VACUUM (FULL) upload_files 를 실행하세요.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
