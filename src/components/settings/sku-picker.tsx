'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { OptionList, useOptionListOpen } from '@/components/ui/option-list';

export interface PickedSku {
  skuId: string;
  productCode: string;
  productName: string;
  warehouseId: string;
}

/** 창고를 고르고 상품명·코드로 검색해 품목 하나를 고른다. */
export function SkuPicker({
  id,
  label,
  warehouseLabel,
  placeholder,
  warehouses,
  value,
  onChange,
}: {
  id: string;
  label: string;
  warehouseLabel: string;
  placeholder: string;
  warehouses: { id: string; name: string }[];
  value: PickedSku | null;
  onChange: (value: PickedSku | null) => void;
}) {
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState<Omit<PickedSku, 'warehouseId'>[]>([]);
  const list = useOptionListOpen();

  useEffect(() => {
    if (!warehouseId || query.trim().length < 1 || value) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/sku/search?warehouseId=${encodeURIComponent(warehouseId)}&q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((res) => (res.ok ? res.json() : { results: [] }))
        .then((data) => setOptions(data.results ?? []))
        .catch(() => undefined);
    }, 200);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [warehouseId, query, value]);

  return (
    <div className="grid items-start gap-2 sm:grid-cols-[auto_minmax(0,1fr)]">
      <div className="space-y-1">
        <Label className="text-xs">{warehouseLabel}</Label>
        <Select
          value={warehouseId}
          onValueChange={(v) => {
            setWarehouseId(v);
            onChange(null);
            setOptions([]);
          }}
        >
          <SelectTrigger className="h-9 w-full sm:w-32" aria-label={warehouseLabel}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {warehouses.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor={id} className="text-xs">
          {label}
        </Label>
        <Input
          id={id}
          autoComplete="off"
          placeholder={placeholder}
          value={value ? `${value.productCode} · ${value.productName}` : query}
          onChange={(e) => {
            onChange(null);
            setQuery(e.target.value);
          }}
          aria-autocomplete="list"
          aria-controls={`${id}-options`}
          {...list.inputProps}
        />
        {list.focused && !value && options.length > 0 && query.trim() && (
          <OptionList id={`${id}-options`}>
            {options.map((o) => (
              <li key={o.skuId} role="option" aria-selected={false}>
                <button
                  type="button"
                  className="w-full px-3 py-1.5 text-left text-sm hover:bg-muted"
                  {...list.optionProps}
                  onClick={() => {
                    onChange({ ...o, warehouseId });
                    setOptions([]);
                    setQuery('');
                    list.close();
                  }}
                >
                  <code className="text-xs">{o.productCode}</code> {o.productName}
                </button>
              </li>
            ))}
          </OptionList>
        )}
      </div>
    </div>
  );
}
