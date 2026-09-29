import { isShippingDay } from '@/domain/inventory/shipping-calendar';
import { getSegmentSettings } from '@/server/repositories/settings-repository';
import { listHolidayDateStrings } from '@/server/repositories/holiday-repository';

export const NON_WORKING_DAY_MESSAGE = '휴무일(주말·등록 휴무일)에는 재고 자료를 받지 않도록 설정되어 있어요. 설정 > 공통에서 휴무일 업로드를 켤 수 있어요.';

/**
 * 재고 자료(파일 업로드·실사 입력)를 이 날짜로 받아도 되는지 — 모든 재고 모드에 같은 규칙을 쓴다.
 * 휴무일 업로드가 꺼져 있으면 주말·등록 휴무일은 막는다. 매장 매출·발주 기록에는 쓰지 않는다(주말 영업이 흔하다).
 */
export async function nonWorkingDayRejection(orgId: string, date: string): Promise<string | null> {
  const { allowNonWorkingDayUploads } = await getSegmentSettings(orgId);
  if (allowNonWorkingDayUploads) return null;
  return isShippingDay(date, new Set(await listHolidayDateStrings(orgId))) ? null : NON_WORKING_DAY_MESSAGE;
}
