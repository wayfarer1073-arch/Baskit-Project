/**
 * POS 마감 정산서(하루치 상품별 매출) 사진의 OCR 글자에서 메뉴 판매 줄을 뽑는다.
 *
 * - 줄 끝의 숫자들을 떼어 내고 수량·금액을 정한다(상품명 수량 금액, 단가가 함께 찍혀 있으면 단가 × 수량 ≈ 금액으로 수량을 찾는다).
 * - 좁은 영수증처럼 이름만 있는 줄 다음에 숫자만 있는 줄이 오면 한 줄로 합친다.
 * - 합계·부가세·결제수단·사업자 정보·시간대별 매출·[분류] 소계 같은 줄은 건너뛴다.
 * OCR이 흔히 틀리는 숫자(O→0, l→1, 4.500→4500)는 숫자 자리에서만 바로잡는다.
 */
import { isDateString } from '@/lib/date';

export interface ReceiptLine {
  name: string;
  code: string | null;
  quantity: number;
  amount: number | null;
}

export interface ParsedReceipt {
  /** 영수증에 찍힌 날짜(없으면 null). */
  date: string | null;
  lines: ReceiptLine[];
  /** 숫자는 있지만 판매 줄로 읽지 못한 줄 수. */
  skipped: number;
}

const SKIP =
  /합\s*계|총\s*(액|금액|매출|수량|판매)|소\s*계|부\s*가\s*세|과\s*세|면\s*세|받\s*을|받\s*은|결\s*제|카\s*드|현\s*금|거스름|잔\s*돈|승\s*인|사업자|대\s*표|전\s*화|tel|주\s*소|영수증|할\s*인|포인트|적\s*립|봉사료|단\s*가|수\s*량|금\s*액|상품명|품\s*명|pos|테이블|주문\s*번호|일\s*시|가맹|회\s*원|쿠\s*폰|담\s*당|캐셔|감사|이용|교환|환불|신용|체크|현금영수증|번\s*호|no\.|객\s*수|객단가|건\s*수|순\s*매출|실\s*매출|공급가|에누리|반\s*품|취\s*소/i;
/** 시간대별 매출(10시, 10시~11시)과 [분류]·<분류> 소계 줄. */
const TIME_BAND = /^\d{1,2}\s*시/;
const SECTION = /^[\[<【(].*[\]>】)]$/;
const HANGUL_OR_LETTER = /[가-힣A-Za-z]/;

/** 숫자 앞뒤에 OCR이 흔히 붙이는 잡티(_ . ] | ' 등). */
const JUNK_EDGE = /^[_.,'"`~:;|\[\]{}]+|[_.,'"`~:;|\[\]{}]+$/g;
/** 잡티만으로 된 토큰 — 숫자 사이에 끼어 있으면 버린다. */
const JUNK_TOKEN = /^[_.,'"`~:;|\[\]{}\-–—=*]+$/;
/** 혼자 있으면 1로 읽히는 글자(ㅣ | l I !). */
const ONE_ALIKE = /^[ㅣ|lI!i]$/;

/** OCR 숫자 토큰을 숫자로 — 숫자가 하나도 없거나 다른 글자가 섞이면 null. */
export function receiptNumber(token: string): number | null {
  let s = token.trim();
  if (ONE_ALIKE.test(s)) return 1;
  s = s.replace(JUNK_EDGE, '');
  if (ONE_ALIKE.test(s)) return 1;
  if (!/\d/.test(s) || !/^[-−(]?[\d,.OoIlㅣ|]+\)?$/.test(s)) return null;
  const negative = /^[-−(]/.test(s);
  s = s
    .replace(/^[-−(]|\)$/g, '')
    .replace(/[Oo]/g, '0')
    .replace(/[Ilㅣ|]/g, '1');
  // 천 단위 구분 — 쉼표는 늘, 점은 뒤에 정확히 세 자리가 올 때만(4.500 → 4500).
  s = s.replace(/,/g, '');
  if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.01);
const isQty = (n: number) => Number.isInteger(n) && Math.abs(n) >= 1 && Math.abs(n) <= 9999;

/** 줄 끝 숫자들로 수량·금액을 정한다. 정할 수 없으면 null. */
function quantityOf(numbers: number[]): { quantity: number; amount: number | null } | null {
  if (numbers.length === 0) return null;
  const amount = numbers[numbers.length - 1];
  const rest = numbers.slice(0, -1);
  // 단가 × 수량 ≈ 금액(할인 열이 끼어 있어도 찾는다).
  for (let i = 0; i < rest.length; i++)
    for (let j = 0; j < rest.length; j++) {
      if (i === j) continue;
      const [price, qty] = [rest[i], rest[j]];
      if (isQty(qty) && Math.abs(price) >= Math.abs(qty) && near(price * qty, amount)) return { quantity: qty, amount };
    }
  if (numbers.length === 2) {
    const [a, b] = numbers;
    if (Math.abs(a) >= 100 && isQty(b) && Math.abs(b) <= 99) return { quantity: b, amount: a * b }; // 단가 수량
    if (isQty(a) && Math.abs(a) < Math.abs(b)) return { quantity: a, amount: b }; // 수량 금액(정산서)
    return null;
  }
  if (numbers.length >= 3 && isQty(numbers[numbers.length - 2])) return { quantity: numbers[numbers.length - 2], amount };
  return null;
}

/** 줄을 이름 부분과 끝 숫자들로 나눈다. */
function splitLine(line: string): { name: string; numbers: number[] } {
  const tokens = line.split(/\s+/).filter(Boolean);
  const numbers: number[] = [];
  while (tokens.length > 0) {
    const last = tokens[tokens.length - 1];
    if (JUNK_TOKEN.test(last) && last !== '-') {
      tokens.pop();
      continue;
    }
    const n = receiptNumber(last);
    if (n === null) break;
    numbers.unshift(n);
    tokens.pop();
  }
  return { name: tokens.join(' '), numbers };
}

/** 이름 앞 번호·상품코드와 장식 글자를 떼어 낸다. */
function cleanName(raw: string): { name: string; code: string | null } {
  let name = raw.replace(/^[*#•·\-–—>\]\[|:.]+/, '').trim();
  let code: string | null = null;
  const lead = name.match(/^([A-Za-z]?\d{1,8})[.)]?\s+(.+)$/);
  if (lead && HANGUL_OR_LETTER.test(lead[2])) {
    if (lead[1].length >= 3) code = lead[1];
    name = lead[2];
  }
  name = name
    .replace(/[|]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s:·.]+$/, '')
    .trim();
  return { name, code };
}

function findDate(text: string): string | null {
  for (const m of text.matchAll(/(20\d{2})\s*[-./년]\s*(\d{1,2})\s*[-./월]\s*(\d{1,2})/g)) {
    const date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    if (isDateString(date)) return date;
  }
  return null;
}

export function parseReceiptText(text: string): ParsedReceipt {
  const rawLines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\t/g, ' ').trim())
    .filter((l) => l && !/^[-=_*~.\s]+$/.test(l));
  const lines: ReceiptLine[] = [];
  let skipped = 0;
  let pendingName: string | null = null;
  for (const line of rawLines) {
    if (SKIP.test(line)) {
      pendingName = null;
      continue;
    }
    const split = splitLine(line);
    const numbers = split.numbers;
    let name = split.name;
    if (numbers.length === 0) {
      // 이름만 있는 줄 — 다음 줄이 숫자만이면 합친다.
      pendingName = HANGUL_OR_LETTER.test(name) ? name : null;
      continue;
    }
    if (!HANGUL_OR_LETTER.test(name) && pendingName) name = `${pendingName} ${name}`.trim();
    pendingName = null;
    if (SECTION.test(name.trim()) || TIME_BAND.test(name.trim())) continue;
    const cleaned = cleanName(name);
    const qty = quantityOf(numbers);
    if (!HANGUL_OR_LETTER.test(cleaned.name) || !qty || qty.quantity === 0) {
      skipped++;
      continue;
    }
    lines.push({ name: cleaned.name, code: cleaned.code, quantity: qty.quantity, amount: qty.amount });
  }
  return { date: findDate(text), lines, skipped };
}

/** 미리보기·저장 흐름을 그대로 쓰도록 영수증 줄을 표(머리글 + 줄)로 바꾼다. */
export const RECEIPT_HEADERS = ['상품코드', '상품명', '판매수량', '실매출액'] as const;
export const RECEIPT_LAYOUT = { headerRowIndex: 0, columns: { menuCode: '상품코드', menuName: '상품명', quantity: '판매수량', amount: '실매출액' } };

export function receiptToAoa(receipt: ParsedReceipt): string[][] {
  return [[...RECEIPT_HEADERS], ...receipt.lines.map((l) => [l.code ?? '', l.name, String(l.quantity), l.amount === null ? '' : String(l.amount)])];
}
