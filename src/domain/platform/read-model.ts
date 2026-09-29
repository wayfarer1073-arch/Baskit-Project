import type { Segment } from '@/lib/segments';

export interface WorkspaceSummary {
  id: string;
  name: string;
  segment: Segment;
  isDemo: boolean;
  suspendedAt: string | null;
  createdAt: string;
  ownerEmail: string | null;
  ownerName: string | null;
  userCount: number;
  warehouseCount: number;
  skuCount: number;
  snapshotCount: number;
  storeItemCount: number;
  orderCount: number;
  salesDays: number;
  /** 업로드·발주·매출·이벤트 입력·로그인 중 가장 최근 시각. */
  lastActivityAt: string | null;
  lastLoginAt: string | null;
  hasPlatformAdmin: boolean;
  /** 사용량: 최근 30일 파일 업로드 수(교체 포함), 최근 30일 로그인한 사용자 수, 저장된 재고 행 수, 대기 중 초대 수. */
  uploads30d: number;
  activeUsers30d: number;
  storedRows: number;
  pendingInvites: number;
}

export interface PlatformMetrics {
  workspaceCount: number;
  userCount: number;
  signups7d: number;
  signups30d: number;
  active7d: number;
  suspendedCount: number;
  demoCount: number;
  bySegment: Record<Segment, number>;
  signupsByDay: { date: string; count: number }[];
}

export interface WorkspaceUserRow {
  id: string;
  email: string;
  name: string;
  role: 'VIEWER' | 'MEMBER' | 'ADMIN';
  isActive: boolean;
  isPlatformAdmin: boolean;
  createdAt: string;
  lastLoginAt: string | null;
}

export interface WorkspaceWarehouseRow {
  id: string;
  code: string;
  name: string;
  isArchived: boolean;
  skuCount: number;
  lastSnapshotDate: string | null;
}

export interface AuditLogRow {
  id: string;
  actorEmail: string;
  action: string;
  organizationId: string | null;
  organizationName: string | null;
  detail: unknown;
  createdAt: string;
}

/** 감사 로그 action 코드 → 화면 표시명. */
export const AUDIT_ACTION_LABEL: Record<string, string> = {
  'workspace.enter': '워크스페이스 들어가기',
  'workspace.suspend': '워크스페이스 정지',
  'workspace.unsuspend': '워크스페이스 정지 해제',
  'workspace.update': '워크스페이스 정보 변경',
  'workspace.delete': '워크스페이스 삭제',
  'demo.create': '데모 워크스페이스 생성',
  'user.deactivate': '사용자 비활성화',
  'user.activate': '사용자 활성화',
  'user.reset_password': '임시 비밀번호 발급',
};
