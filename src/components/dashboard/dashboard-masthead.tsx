import Link from 'next/link';
import { UploadCloud } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DateRangeControl } from '@/components/dashboard/date-range-control';
import { todayKstDateString } from '@/lib/date';

interface DashboardMastheadProps {
  segment: 'DAILY_SYNC' | 'PERIODIC_COUNT' | 'ORDER_CYCLE';
  title: string;
  segmentLabel: string;
  /** '… 기준 재고 상태입니다.' 또는 기간 비교 문구. */
  description: string;
  asOfDate: string;
  fromDate: string | null;
}

/**
 * 세 대시보드(일일 재고 연동·비정기 실사·매장 발주 예측)가 함께 쓰는 머리글 — 같은 제목 옆에 방식 태그를 달고,
 * 오른쪽에 오늘/어제/특정 날짜/기간 비교 조회를 둔다. 태그는 버튼처럼 보이지만 누를 수 없는 표시다.
 */
export function DashboardMasthead({ segment, title, segmentLabel, description, asOfDate, fromDate }: DashboardMastheadProps) {
  return (
    <div className="flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <h1 className="text-[28px] font-semibold tracking-tight sm:text-[32px]">{title}</h1>
          <span data-segment={segment} className="inline-flex h-7 cursor-default select-none items-center rounded-md bg-brand-accent px-2.5 text-xs font-semibold text-black">
            {segmentLabel}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <DateRangeControl key={`${fromDate ?? 'day'}-${asOfDate}`} asOfDate={asOfDate} fromDate={fromDate} maxDate={todayKstDateString()} />
    </div>
  );
}

/** 대시보드에 보여 줄 기록이 없을 때 — 입력하러 가는 버튼 하나를 둔 점선 카드. */
export function DashboardEmptyState({ title, body, href, cta }: { title: string; body: string; href: string; cta: string }) {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-2xl border border-dashed bg-card p-10 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted">
          <UploadCloud className="size-6 text-muted-foreground" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{body}</p>
        </div>
        <Button asChild>
          <Link href={href}>
            <UploadCloud className="size-4" /> {cta}
          </Link>
        </Button>
      </div>
    </div>
  );
}
