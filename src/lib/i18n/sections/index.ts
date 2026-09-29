/**
 * 화면 영역별 문구. 영역마다 파일을 나눠 messages.ts가 너무 커지지 않게 한다.
 * 각 파일은 { ko, en }을 내보내고, en은 ko와 같은 키·자리표시자를 가져야 한다(테스트로 확인).
 */
import * as dashboard from './dashboard';
import * as domain from './domain';
import * as inventory from './inventory';
import * as work from './work';

export const ko = {
  dashboard: dashboard.ko,
  domain: domain.ko,
  inventory: inventory.ko,
  work: work.ko,
};

export const en = {
  dashboard: dashboard.en,
  domain: domain.en,
  inventory: inventory.en,
  work: work.en,
};
