'use client';

import { usePathname, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SEGMENT_META, type Segment } from '@/lib/segments';
import { SEGMENT_TAB, type SettingsTab } from '@/lib/settings-tabs';
import { useI18n } from '@/components/i18n/i18n-provider';

/** 탭마다 "어느 화면에 쓰이는 설정인지"를 한 줄로 밝혀, 설정을 바꾸면 어디가 달라지는지 바로 알 수 있게 한다. */
function ScopeNote({ segment }: { segment: Segment }) {
  const meta = SEGMENT_META[segment];
  const { m } = useI18n();
  const [before, after] = m.settings.scopeNote.split('{dashboard}');
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/60 px-4 py-2.5 text-sm">
      <span className="text-muted-foreground">
        {before}
        <strong className="font-medium text-foreground">{m.segments[segment].label}</strong>
        {after}
      </span>
      <Link href={meta.dashboardHref} className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline-offset-4 hover:underline">
        {m.settings.openDashboard}
        <ArrowRight className="size-3.5" aria-hidden="true" />
      </Link>
    </div>
  );
}

export function SettingsTabs({
  initialTab,
  activeSegment,
  enabledSegments,
  common,
  daily,
  periodic,
  store,
}: {
  initialTab: SettingsTab;
  activeSegment: Segment;
  enabledSegments: Segment[];
  common: React.ReactNode;
  daily: React.ReactNode;
  periodic: React.ReactNode;
  store: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const panels: Record<SettingsTab, React.ReactNode> = { common, daily, periodic, store };
  const { m } = useI18n();

  return (
    <Tabs defaultValue={initialTab} onValueChange={(v) => router.replace(`${pathname}?tab=${v}`, { scroll: false })} className="gap-5">
      <TabsList aria-label={m.settings.tabsLabel} className="h-auto flex-wrap justify-start">
        <TabsTrigger value="common">{m.settings.commonTab}</TabsTrigger>
        {enabledSegments.map((segment) => (
          <TabsTrigger key={segment} value={SEGMENT_TAB[segment]}>
            {m.segments[segment].label}
            {segment === activeSegment && <span className="size-1.5 rounded-full bg-brand-accent" aria-label={m.settings.activeDashboard} title={m.settings.activeDashboard} />}
          </TabsTrigger>
        ))}
      </TabsList>

      <TabsContent value="common" className="space-y-4">
        <p className="text-sm text-muted-foreground">{m.settings.commonIntro}</p>
        {panels.common}
      </TabsContent>
      {enabledSegments.map((segment) => (
        <TabsContent key={segment} value={SEGMENT_TAB[segment]} className="space-y-4">
          <ScopeNote segment={segment} />
          {panels[SEGMENT_TAB[segment]]}
        </TabsContent>
      ))}
    </Tabs>
  );
}
