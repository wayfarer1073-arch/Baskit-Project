import { describe, expect, it } from 'vitest';
import { applyCodeAliases, assignAutoCodes, convertStockUnit } from './normalize';
import type { ParsedInventoryRow } from './types';

const row = (productCode: string, normalStock: number, unitCost: number | null = 100): ParsedInventoryRow => ({
  rowNumber: 1,
  productCode,
  productName: productCode,
  option: null,
  barcode: null,
  unitCost: unitCost ?? 0,
  totalCost: null,
  normalStock,
  availableStock: normalStock,
  incomingStock: 0,
  defectiveStock: 0,
  warningQty: 0,
  dangerQty: 0,
  location: null,
  category: null,
  extra: {},
  costMissing: unitCost === null,
});

describe('applyCodeAliases', () => {
  it('renames linked codes to the existing SKU and merges when both appear', () => {
    const { rows, aliased } = applyCodeAliases([row('8801', 3), row('P1', 2), row('X', 1)], new Map([['8801', 'P1']]));
    expect(aliased).toBe(1);
    expect(rows.map((r) => [r.productCode, r.normalStock])).toEqual([
      ['P1', 5],
      ['X', 1],
    ]);
  });
  it('leaves rows untouched without aliases', () => {
    const input = [row('A', 1)];
    expect(applyCodeAliases(input, new Map()).rows).toBe(input);
  });
});

describe('convertStockUnit', () => {
  const factors = new Map([
    ['A', { eaPerBox: 24, eaPerPallet: 480 }],
    ['B', { eaPerBox: null, eaPerPallet: null }],
  ]);
  it('multiplies box counts by units per box and divides the per-box cost', () => {
    const { rows, issues } = convertStockUnit([row('A', 2, 4800)], 'BOX', factors);
    expect(rows[0]).toMatchObject({ normalStock: 48, availableStock: 48, unitCost: 200 });
    expect(issues).toEqual([]);
  });
  it('skips items without a known pack size instead of storing box counts as units', () => {
    const { rows, issues } = convertStockUnit([row('A', 1), row('B', 3), row('C', 1)], 'PLT', factors);
    expect(rows.map((r) => [r.productCode, r.normalStock])).toEqual([['A', 480]]);
    expect(issues[0]).toMatchObject({ level: 'WARNING', code: 'UNIT_FACTOR_MISSING' });
  });
  it('does nothing for EA', () => {
    const input = [row('A', 1)];
    expect(convertStockUnit(input, 'EA', factors).rows).toBe(input);
  });
});

describe('assignAutoCodes', () => {
  const auto = (name: string) => ({ ...row(`\u0000name:${name}`, 1), productName: name, autoCode: true });
  it('reuses the code of a same-named item and numbers new names after the largest auto code', () => {
    const { rows, assigned } = assignAutoCodes([auto('사과'), auto('배'), auto('귤')], new Map([['사과', 'P-1']]), new Set(['P-1', 'A0007', 'A12']));
    expect(rows.map((r) => r.productCode)).toEqual(['P-1', 'A0008', 'A0009']);
    expect(assigned).toBe(2);
    expect(rows.every((r) => !r.autoCode)).toBe(true);
  });
  it('leaves rows that already have a code alone', () => {
    const plain = row('X', 1);
    expect(assignAutoCodes([plain], new Map(), new Set()).rows[0]).toBe(plain);
  });
});
