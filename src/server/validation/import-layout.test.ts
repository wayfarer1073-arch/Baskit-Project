import { expect, it } from 'vitest';
import { LAYOUT_FIELDS } from '@/domain/excel/layout-types';
import { parseLayoutField } from './import-layout';

it('keeps every layout field, including the extra columns', () => {
  const columns = Object.fromEntries(LAYOUT_FIELDS.map((f) => [f, `col-${f}`]));
  const parsed = parseLayoutField(JSON.stringify({ sheetName: null, headerRowIndex: 0, columns, duplicateMode: 'sum' }));
  expect(parsed?.columns).toEqual(columns);
});
