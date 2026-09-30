import { prisma } from '@/lib/prisma';
import { removeStoredFile } from '@/server/repositories/upload-file-repository';

/**
 * 쌓이기만 하는 기록을 보관 기한에 맞춰 정리한다. 하루 한 번 /api/cron/maintenance(또는 npm run db:maintenance)로 돌린다.
 * 재고 수량·메모·발주·매출처럼 분석에 쓰는 데이터는 건드리지 않고, 다시 볼 일이 거의 없는 부산물만 지운다.
 * 각 기한은 환경변수로 바꿀 수 있고, 0이면 그 항목은 지우지 않는다.
 */
export interface RetentionPolicy {
  /** 업로드 원본 파일(분석에는 쓰지 않고 내려받기용). */
  uploadFileDays: number;
  /** 끝난 백그라운드 업로드 작업 기록. */
  uploadJobDays: number;
  /** 만료되거나 사용한 로그인·인증 토큰. */
  authTokenDays: number;
  /** 수락하지 않고 만료된 팀 초대. */
  invitationDays: number;
  /** 운영자 콘솔 작업 기록. */
  auditLogDays: number;
}

export const DEFAULT_RETENTION: RetentionPolicy = {
  uploadFileDays: 180,
  uploadJobDays: 30,
  authTokenDays: 7,
  invitationDays: 30,
  auditLogDays: 730,
};

function envDays(name: string, fallback: number) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
}

export function retentionPolicyFromEnv(): RetentionPolicy {
  return {
    uploadFileDays: envDays('UPLOAD_FILE_RETENTION_DAYS', DEFAULT_RETENTION.uploadFileDays),
    uploadJobDays: envDays('UPLOAD_JOB_RETENTION_DAYS', DEFAULT_RETENTION.uploadJobDays),
    authTokenDays: envDays('AUTH_TOKEN_RETENTION_DAYS', DEFAULT_RETENTION.authTokenDays),
    invitationDays: envDays('INVITATION_RETENTION_DAYS', DEFAULT_RETENTION.invitationDays),
    auditLogDays: envDays('AUDIT_LOG_RETENTION_DAYS', DEFAULT_RETENTION.auditLogDays),
  };
}

export interface RetentionReport {
  uploadFiles: number;
  storedObjects: number;
  uploadJobs: number;
  authTokens: number;
  invitations: number;
  auditLogs: number;
}

const daysBefore = (now: Date, days: number) => new Date(now.getTime() - days * 86_400_000);

/** 한 번에 너무 많은 파일을 붙잡지 않도록 나눠서 지운다. */
const FILE_BATCH = 200;

export async function runRetention(now: Date = new Date(), policy: RetentionPolicy = retentionPolicyFromEnv()): Promise<RetentionReport> {
  const report: RetentionReport = { uploadFiles: 0, storedObjects: 0, uploadJobs: 0, authTokens: 0, invitations: 0, auditLogs: 0 };

  if (policy.uploadFileDays > 0) {
    const cutoff = daysBefore(now, policy.uploadFileDays);
    let afterId: string | undefined;
    for (;;) {
      const batch = await prisma.uploadFile.findMany({
        where: { createdAt: { lt: cutoff }, ...(afterId ? { id: { gt: afterId } } : {}) },
        orderBy: { id: 'asc' },
        select: { id: true, storageKey: true },
        take: FILE_BATCH,
      });
      if (batch.length === 0) break;
      afterId = batch.at(-1)!.id;
      // 저장소 내용을 먼저 지우고, 지운 것만 행을 지운다 — 저장소 오류로 남은 파일은 다음 실행에서 다시 시도한다.
      const done: string[] = [];
      for (const file of batch) {
        if (!file.storageKey) done.push(file.id);
        else if (await removeStoredFile(file.storageKey)) {
          done.push(file.id);
          report.storedObjects++;
        }
      }
      if (done.length > 0) report.uploadFiles += (await prisma.uploadFile.deleteMany({ where: { id: { in: done } } })).count;
      if (batch.length < FILE_BATCH) break;
    }
  }

  if (policy.uploadJobDays > 0) {
    const r = await prisma.uploadJob.deleteMany({ where: { status: { in: ['SUCCEEDED', 'FAILED'] }, createdAt: { lt: daysBefore(now, policy.uploadJobDays) } } });
    report.uploadJobs = r.count;
  }

  if (policy.authTokenDays > 0) {
    const cutoff = daysBefore(now, policy.authTokenDays);
    const r = await prisma.authToken.deleteMany({ where: { OR: [{ expiresAt: { lt: cutoff } }, { usedAt: { lt: cutoff } }] } });
    report.authTokens = r.count;
  }

  if (policy.invitationDays > 0) {
    const r = await prisma.invitation.deleteMany({ where: { acceptedAt: null, expiresAt: { lt: daysBefore(now, policy.invitationDays) } } });
    report.invitations = r.count;
  }

  if (policy.auditLogDays > 0) {
    const r = await prisma.platformAuditLog.deleteMany({ where: { createdAt: { lt: daysBefore(now, policy.auditLogDays) } } });
    report.auditLogs = r.count;
  }

  return report;
}
