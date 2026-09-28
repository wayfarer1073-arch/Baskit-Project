'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SEGMENT_META, SEGMENT_ORDER, type Segment } from '@/lib/segments';
import { SEGMENT_TAB, type SettingsTab } from '@/lib/settings-tabs';

/** 탭마다 "어느 화면에 쓰이는 설정인지"를 한 줄로 밝혀, 설정을 바꾸면 어디가 달라지는지 바로 알 수 있게 한다. */
function ScopeNote({ segment }: { segment: Segment }) {
  const meta = SEGMENT_META[segment];
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/60 px-4 py-2.5 text-sm">
      <span className="text-muted-foreground">
        여기 설정은 <strong className="font-medium text-foreground">{meta.label}</strong> 대시보드에만 쓰여요.
      </span>
      <Link href={meta.dashboardHref} className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline-offset-4 hover:underline">
        대시보드 열기
        <ArrowRight className="size-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

export function SettingsTabs({
  initialTab,
  activeSegment,
  common,
  daily,
  periodic,
  store,
}: {
  initialTab: SettingsTab;
  activeSegment: Segment;
  common: React.ReactNode;
  daily: React.ReactNode;
  periodic: React.ReactNode;
  store: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const panels: Record<SettingsTab, React.ReactNode> = { common, daily, periodic, store };

  return (
    <Tabs defaultValue={initialTab} onValueChange={(v) => router.replace(`${pathname}?tab=${v}`, { scroll: false })} className="gap-5">
      <TabsList aria-label="설정 구분" className="h-auto flex-wrap justify-start">
        <TabsTrigger value="common">공통</TabsTrigger>
        {SEGMENT_ORDER.map((segment) => (
          <TabsTrigger key={segment} value={SEGMENT_TAB[segment]}>
            {SEGMENT_META[segment].label}
            {segment === activeSegment && <span className="size-1.5 rounded-full bg-brand-accent" aria-label="지금 보고 있는 대시보드" title="지금 보고 있는 대시보드" />}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="common" className="space-y-4">
        <p className="text-sm text-muted-foreground">어떤 대시보드를 쓰든 함께 쓰는 워크스페이스 설정이에요.</p>
        {panels.common}
      </TabsContent>
      {SEGMENT_ORDER.map((segment) => (
        <TabsContent key={segment} value={SEGMENT_TAB[segment]} className="space-y-4">
          <ScopeNote segment={segment} />
          {panels[SEGMENT_TAB[segment]]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
