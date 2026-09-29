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

