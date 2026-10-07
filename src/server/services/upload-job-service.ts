import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { processUpload, type UploadRequest, type UploadResult } from '@/server/services/upload-service';
import { runPeriodUpload, type PeriodUploadInput } from '@/server/services/period-upload-service';

/** 서버가 재시작되면 처리 중이던 작업은 끝나지 않는다 — 이 시간이 지나도록 끝나지 않은 작업은 실패로 본다. */
const STALE_JOB_MS = 15 * 60_000;

export async function createUploadJob(input: { orgId: string; userId: string; warehouseId: string; snapshotDate: Date; fileName: string; fileSize: number }) {
  return prisma.uploadJob.create({
    data: {
      organizationId: input.orgId,
      userId: input.userId,
      warehouseId: input.warehouseId,
      snapshotDate: input.snapshotDate,
      fileName: input.fileName,
      fileSize: input.fileSize,
    },
    select: { id: true },
  });
}

/** 작업을 실행하고 결과를 남긴다. 예외도 삼켜서 작업 상태(FAILED)로 남긴다 — 응답 뒤에 도는 코드라 던질 곳이 없다. */
export async function runUploadJob(jobId: string, request: UploadRequest): Promise<void> {
  await prisma.uploadJob.update({ where: { id: jobId }, data: { status: 'RUNNING', startedAt: new Date() } });
  try {
    const result: UploadResult = await processUpload(request);
    await prisma.uploadJob.update({
      where: { id: jobId },
      data: { status: 'SUCCEEDED', result: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue, finishedAt: new Date() },
    });
  } catch (e) {
    console.error('[upload-job] failed', jobId, e);
    await prisma.uploadJob
      .update({ where: { id: jobId }, data: { status: 'FAILED', error: '파일을 처리하지 못했습니다. 다시 올려 주세요.', finishedAt: new Date() } })
      .catch(() => undefined);
  }
}

/** 기간 일괄 업로드 작업 — 처리 중에는 result에 진행 상황({ progress: { done, total } })을 남긴다. */
export async function runPeriodUploadJob(jobId: string, input: PeriodUploadInput): Promise<void> {
  await prisma.uploadJob.update({ where: { id: jobId }, data: { status: 'RUNNING', startedAt: new Date() } });
  try {
    const result = await runPeriodUpload(input, async (done, total) => {
      await prisma.uploadJob.update({ where: { id: jobId }, data: { result: { progress: { done, total } } } });
    });
    await prisma.uploadJob.update({
      where: { id: jobId },
      data: { status: 'SUCCEEDED', result: JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue, finishedAt: new Date() },
    });
  } catch (e) {
    console.error('[upload-job] period upload failed', jobId, e);
    await prisma.uploadJob
      .update({
        where: { id: jobId },
        data: { status: 'FAILED', error: '기간 업로드를 끝내지 못했습니다. 이미 저장된 날짜는 남아 있으니, 같은 파일로 다시 올리면 나머지 날짜만 채워요.', finishedAt: new Date() },
      })
      .catch(() => undefined);
  }
}

export async function getUploadJob(orgId: string, jobId: string) {
  const job = await prisma.uploadJob.findFirst({
    where: { id: jobId, organizationId: orgId },
    select: { id: true, status: true, result: true, error: true, createdAt: true, fileName: true },
  });
  if (!job) return null;
  if ((job.status === 'QUEUED' || job.status === 'RUNNING') && Date.now() - job.createdAt.getTime() > STALE_JOB_MS) {
    await prisma.uploadJob.update({
      where: { id: job.id },
      data: { status: 'FAILED', error: '처리 시간이 너무 오래 걸려 중단되었습니다. 다시 올려 주세요.', finishedAt: new Date() },
    });
    return { ...job, status: 'FAILED' as const, error: '처리 시간이 너무 오래 걸려 중단되었습니다. 다시 올려 주세요.' };
  }
  return job;
}
