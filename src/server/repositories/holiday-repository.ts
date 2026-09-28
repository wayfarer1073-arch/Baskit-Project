import { prisma } from '@/lib/prisma';
import { dateOnlyToString } from '@/lib/date';

export interface HolidayRow {
  id: string;
  date: string; // yyyy-MM-dd
  name: string;
}

export async function listHolidays(orgId: string): Promise<HolidayRow[]> {
  const holidays = await prisma.holiday.findMany({ where: { organizationId: orgId }, orderBy: { date: 'asc' } });
  return holidays.map((h) => ({ id: h.id, date: dateOnlyToString(h.date), name: h.name }));
}

/** KPI 계산·업로드 캘린더 차단 판단에 쓰는 날짜 문자열 집합만 가볍게 가져온다. */
export async function listHolidayDateStrings(orgId: string): Promise<string[]> {
  const holidays = await prisma.holiday.findMany({ where: { organizationId: orgId }, select: { date: true } });
  return holidays.map((h) => dateOnlyToString(h.date));
}

function toDateOnly(dateStr: string): Date {
  return new Date(`${dateStr}T00:00:00.000Z`);
}

export type AddHolidayResult = { ok: true; holiday: HolidayRow } | { ok: false; error: string };

export async function addHoliday(orgId: string, date: string, name: string): Promise<AddHolidayResult> {
  try {
    const created = await prisma.holiday.create({ data: { organizationId: orgId, date: toDateOnly(date), name } });
    return { ok: true, holiday: { id: created.id, date: dateOnlyToString(created.date), name: created.name } };
  } catch {
    return { ok: false, error: '이미 등록된 날짜입니다.' };
  }
}

export async function deleteHoliday(orgId: string, id: string): Promise<boolean> {
  const result = await prisma.holiday.deleteMany({ where: { id, organizationId: orgId } });
  return result.count > 0;
}
