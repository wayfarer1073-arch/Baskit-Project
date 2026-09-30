import { describe, expect, it } from 'vitest';
import { dataReliabilityText, humanizeTag, humanizeTagText, localizeReason, riskLabelText } from './status';
import { MESSAGES } from '@/lib/i18n/messages';

const ko = MESSAGES.ko.domain;
const en = MESSAGES.en.domain;

const TAGS = [
  '[관측 2026-09-01]',
  '[최근 14일 중 9출고일]',
  '[재고 정체 12출고일]',
  '[재고 정체 5일]',
  '[입고 보정 추정·반품/조정 미분리]',
  '[품절]',
  '[특수 관리 개별 판단]',
  '[자료 갱신 필요]',
  '[소비기한 확인 필요]',
  '[위험수량 이하]',
];

describe('humanizeTagText', () => {
  it('한국어 화면에서는 기존 humanizeTag와 같은 문구를 낸다', () => {
    for (const tag of TAGS.filter((t) => t !== '[재고 정체 5일]')) expect(humanizeTagText(tag, ko)).toBe(humanizeTag(tag));
    // 달력일 기준 정체 태그는 예전 함수가 원문 그대로 두던 것 — 이제는 같은 문구로 풀어 쓴다.
    expect(humanizeTagText('[재고 정체 5일]', ko)).toBe('[5일째 재고 변화 없음]');
  });

  it('영어 화면에서는 태그를 영어로 바꾸고 숫자·날짜를 그대로 옮긴다', () => {
    expect(humanizeTagText('[관측 2026-09-01]', en)).toBe('[Data as of 2026-09-01]');
    expect(humanizeTagText('[최근 14일 중 9출고일]', en)).toBe('[9 data days in the last 14]');
    expect(humanizeTagText('[재고 정체 12출고일]', en)).toBe('[No change for 12 days]');
    expect(humanizeTagText('[품절]', en)).toBe('[Sold out]');
    for (const tag of TAGS) expect(humanizeTagText(tag, en)).not.toMatch(/[가-힣]/);
  });

  it('모르는 태그는 그대로 둔다', () => {
    expect(humanizeTagText('[사용자 태그]', en)).toBe('[사용자 태그]');
  });
});

describe('localizeReason / riskLabelText / dataReliabilityText', () => {
  it('계산 사유를 화면 언어로 바꾸고 모르는 사유는 그대로 둔다', () => {
    expect(localizeReason('위험수량 이하', en)).toBe('Below danger level');
    expect(localizeReason('위험수량 이하', ko)).toBe('위험수량 이하');
    expect(localizeReason('직접 입력한 사유', en)).toBe('직접 입력한 사유');
  });

  it('위험 단계와 신뢰도 라벨을 언어별로 낸다', () => {
    expect(riskLabelText('DANGER', en)).not.toMatch(/[가-힣]/);
    expect(dataReliabilityText('HIGH', en)).toMatch(/^Reliability /);
  });
});
