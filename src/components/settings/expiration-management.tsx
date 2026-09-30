'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Pencil, Check, X, Download, UploadCloud, Trash2, Search, Plus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { InfoTooltip } from '@/components/ui/info-tooltip';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Pagination } from '@/components/ui/pagination';
import { formatKstDate, todayKstDateString } from '@/lib/date';
import { DEFAULT_EXPIRATION_RISK_DAYS } from '@/domain/inventory/types';
import { useI18n } from '@/components/i18n/i18n-provider';
import { format } from '@/lib/i18n/locales';

const PAGE_SIZE = 7;

interface ExpirationLotRow {
  lotId: string;
  skuId: string;
  warehouseId: string;
  warehouseCode: string;
  warehouseName: string;
  productCode: string;
  productName: string;
  lot: string;
  isAutoLot: boolean;
  expirationDate: string;
  expirationRiskDays: number | null;
}

interface SkuSearchResult {
  skuId: string;
  productCode: string;
  productName: string;
}

interface ExpirationManagementProps {
  isAdmin: boolean;
  warehouses: { id: string; code: string; name: string }[];
  initialEntries: ExpirationLotRow[];
}

function daysUntil(dateStr: string): number {
  const today = todayKstDateString();
  const diffMs = Date.parse(`${dateStr}T00:00:00.000Z`) - Date.parse(`${today}T00:00:00.000Z`);
  return Math.round(diffMs / 86_400_000);
}

function expirationBadge(days: number, expiredLabel: string): { label: string; className: string } {
  if (days < 0) return { label: format(expiredLabel, { days: Math.abs(days) }), className: 'bg-status-danger-bg text-status-danger' };
  if (days <= 7) return { label: `D-${days}`, className: 'bg-status-danger-bg text-status-danger' };
  if (days <= 30) return { label: `D-${days}`, className: 'bg-status-warning-bg text-status-warning' };
  return { label: `D-${days}`, className: 'bg-muted text-muted-foreground' };
}

export function ExpirationManagement({ isAdmin, warehouses, initialEntries }: ExpirationManagementProps) {
  const { m } = useI18n();
  const c = m.settingsScreens.common;
  const tx = m.settingsScreens.expiration;
  const [entries, setEntries] = useState(initialEntries);
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [editingLotId, setEditingLotId] = useState<string | null>(null);
  const [editingDateValue, setEditingDateValue] = useState('');
  const [editingLotValue, setEditingLotValue] = useState('');
  const [editingRiskDaysValue, setEditingRiskDaysValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [deletingLotId, setDeletingLotId] = useState<string | null>(null);
  const [selectedSkuIds, setSelectedSkuIds] = useState<Set<string>>(new Set());
  const [bulkRiskDaysInput, setBulkRiskDaysInput] = useState('');
  const [bulkApplying, setBulkApplying] = useState(false);
  const [warehouseFilter, setWarehouseFilter] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const [addWarehouseId, setAddWarehouseId] = useState(warehouses[0]?.id ?? '');
  const [addQuery, setAddQuery] = useState('');
  const [addResults, setAddResults] = useState<SkuSearchResult[]>([]);
  const [addSearching, setAddSearching] = useState(false);
  const [addSelected, setAddSelected] = useState<SkuSearchResult | null>(null);
  const [addLotValue, setAddLotValue] = useState('');
  const [addDateValue, setAddDateValue] = useState('');
  const [addSubmitting, setAddSubmitting] = useState(false);

  const warehouseFiltered = warehouseFilter === 'ALL' ? entries : entries.filter((e) => e.warehouseId === warehouseFilter);
  const filteredEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return warehouseFiltered;
    return warehouseFiltered.filter((e) => e.productName.toLowerCase().includes(q) || e.productCode.toLowerCase().includes(q));
  }, [warehouseFiltered, search]);
  const totalPages = Math.max(1, Math.ceil(filteredEntries.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filteredEntries.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const allSelected = filteredEntries.length > 0 && filteredEntries.every((e) => selectedSkuIds.has(e.skuId));

  useEffect(() => {
    const q = addQuery.trim();
    const timer = setTimeout(async () => {
      if (!q || !addWarehouseId) {
        setAddResults([]);
        return;
      }
      setAddSearching(true);
      try {
        const res = await fetch(`/api/sku/search?warehouseId=${addWarehouseId}&q=${encodeURIComponent(q)}`);
        if (res.ok) {
          const body = await res.json();
          setAddResults(body.results ?? []);
        }
      } finally {
        setAddSearching(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [addQuery, addWarehouseId]);

  function changeWarehouseFilter(value: string) {
    setWarehouseFilter(value);
    setPage(1);
  }

  function changeSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  function toggleSelect(skuId: string, checked: boolean) {
    setSelectedSkuIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(skuId);
      else next.delete(skuId);
      return next;
    });
  }

  function toggleSelectAll(checked: boolean) {
    setSelectedSkuIds((prev) => {
      const next = new Set(prev);
      for (const e of filteredEntries) {
        if (checked) next.add(e.skuId);
        else next.delete(e.skuId);
      }
      return next;
    });
  }

  async function refreshEntries() {
    const res = await fetch('/api/expiration');
    if (res.ok) {
      const body = await res.json();
      setEntries(body.entries ?? []);
    }
  }

  async function handleUpload() {
    if (!warehouseId || !file) {
      toast.error(c.pickWarehouseAndFile);
      return;
    }
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('warehouseId', warehouseId);
      formData.append('file', file);
      const res = await fetch('/api/expiration', { method: 'POST', body: formData });
      const body = await res.json();
      if (!res.ok) {
        toast.error(body.error ?? body.issues?.[0]?.message ?? c.uploadFailed);
        return;
      }
      const unmatchedText = body.unmatchedProductCodes.length > 0 ? format(c.unmatchedCodes, { count: body.unmatchedProductCodes.length }) : '';
      toast.success(format(c.uploadResult, { count: body.updatedCount }) + unmatchedText);
      await refreshEntries();
      setFile(null);
    } catch {
      toast.error(c.uploadNetworkFailed);
    } finally {
      setUploading(false);
    }
  }

  function startEdit(entry: ExpirationLotRow) {
    setEditingLotId(entry.lotId);
    setEditingDateValue(entry.expirationDate);
    setEditingLotValue(entry.isAutoLot ? '' : entry.lot);
    setEditingRiskDaysValue(String(entry.expirationRiskDays ?? DEFAULT_EXPIRATION_RISK_DAYS));
  }

  async function saveEdit(entry: ExpirationLotRow) {
    if (!editingDateValue) {
      toast.error(tx.dateRequired);
      return;
    }
    const riskDays = Number(editingRiskDaysValue);
    if (!Number.isInteger(riskDays) || riskDays < 0) {
      toast.error(tx.riskDaysInvalid);
      return;
    }
    setSaving(true);
    try {
      const lotRes = await fetch(`/api/expiration/lots/${entry.lotId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lot: editingLotValue.trim() || null, expirationDate: editingDateValue }),
      });
      const lotBody = await lotRes.json().catch(() => ({}));
      if (!lotRes.ok) {
        toast.error(lotBody.error ?? c.updateFailed);
        return;
      }
      const riskRes = await fetch(`/api/expiration/${entry.skuId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expirationRiskDays: riskDays }),
      });
      if (!riskRes.ok) throw new Error();
      toast.success(tx.updated);
      setEditingLotId(null);
      await refreshEntries();
    } catch {
      toast.error(c.updateNetworkFailed);
    } finally {
      setSaving(false);
    }
  }

  async function applyBulkRiskDays() {
    const riskDays = Number(bulkRiskDaysInput);
    if (!Number.isInteger(riskDays) || riskDays < 0) {
      toast.error(tx.riskDaysInvalid);
      return;
    }
    setBulkApplying(true);
    try {
      const res = await fetch('/api/expiration', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skuIds: [...selectedSkuIds], expirationRiskDays: riskDays }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? tx.bulkFailed);
        return;
      }
      setEntries((prev) => prev.map((e) => (selectedSkuIds.has(e.skuId) ? { ...e, expirationRiskDays: riskDays } : e)));
      toast.success(format(tx.bulkApplied, { count: body.updatedCount }));
      setSelectedSkuIds(new Set());
      setBulkRiskDaysInput('');
    } catch {
      toast.error(tx.bulkNetworkFailed);
    } finally {
      setBulkApplying(false);
    }
  }

  async function deleteLot(entry: ExpirationLotRow) {
    if (!confirm(format(tx.deleteConfirm, { name: entry.productName, lot: entry.lot }))) return;

    setDeletingLotId(entry.lotId);
    try {
      const res = await fetch(`/api/expiration/lots/${entry.lotId}`, { method: 'DELETE' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? c.deleteFailed);
        return;
      }
      if (editingLotId === entry.lotId) setEditingLotId(null);
      toast.success(tx.deleted);
      await refreshEntries();
    } catch {
      toast.error(c.deleteNetworkFailed);
    } finally {
      setDeletingLotId(null);
    }
  }

  function selectAddResult(result: SkuSearchResult) {
    setAddSelected(result);
    setAddQuery(`${result.productCode} · ${result.productName}`);
    setAddResults([]);
  }

  async function submitAddLot() {
    if (!addSelected) {
      toast.error(tx.pickProduct);
      return;
    }
    if (!addDateValue) {
      toast.error(tx.expiryRequired);
      return;
    }
    setAddSubmitting(true);
    try {
      const res = await fetch('/api/expiration/lots', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skuId: addSelected.skuId, lot: addLotValue.trim() || null, expirationDate: addDateValue }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error ?? c.addFailed);
        return;
      }
      toast.success(tx.lotAdded);
      setAddSelected(null);
      setAddQuery('');
      setAddLotValue('');
      setAddDateValue('');
      await refreshEntries();
    } catch {
      toast.error(c.addNetworkFailed);
    } finally {
      setAddSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-1.5">
          <CardTitle>{tx.title}</CardTitle>
          <InfoTooltip tone="header">
            {tx.description}
            <br />
            <br />
            {tx.riskHelp}
          </InfoTooltip>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isAdmin && (
          <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-muted/20 p-3">
            <div className="space-y-1.5">
              <Label htmlFor="expiration-warehouse">{c.warehouse}</Label>
              <Select value={warehouseId} onValueChange={setWarehouseId}>
                <SelectTrigger id="expiration-warehouse" className="w-32">
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
            <div className="space-y-1.5">
              <Label htmlFor="expiration-file">{tx.file}</Label>
              <Input id="expiration-file" type="file" accept=".xls,.xlsx,.csv,.tsv,.txt" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="max-w-xs" />
            </div>
            <Button onClick={handleUpload} disabled={uploading || !file}>
              <UploadCloud className="size-4" />
              {uploading ? c.uploading : c.upload}
            </Button>
            <Button variant="outline" size="sm" className="text-foreground hover:text-brand-accent" asChild>
              <a href="/api/templates/expiration">
                <Download className="size-3.5" />
                {c.sample}
              </a>
            </Button>
          </div>
        )}

        {isAdmin && (
          <div className="space-y-2 rounded-lg border bg-muted/20 p-3">
            <Label>{tx.addLot}</Label>
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="add-lot-warehouse" className="text-[11px] text-muted-foreground">{c.warehouse}</Label>
                <Select
                  value={addWarehouseId}
                  onValueChange={(v) => {
                    setAddWarehouseId(v);
                    setAddSelected(null);
                    setAddQuery('');
                  }}
                >
                  <SelectTrigger id="add-lot-warehouse" className="w-28">
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
              <div className="relative space-y-1.5">
                <Label htmlFor="add-lot-search" className="text-[11px] text-muted-foreground">{tx.product}</Label>
                <div className="relative">
                  <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    id="add-lot-search"
                    value={addQuery}
                    onChange={(e) => {
                      setAddQuery(e.target.value);
                      setAddSelected(null);
                    }}
                    placeholder={tx.searchToPick}
                    className="h-8 w-56 pl-7 text-xs"
                  />
                </div>
                {!addSelected && addQuery.trim() !== '' && (
                  <div className="absolute top-full left-0 z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-md border bg-popover shadow-md">
                    {addSearching ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground">{c.searching}</div>
                    ) : addResults.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-muted-foreground">{c.noMatch}</div>
                    ) : (
                      addResults.map((r) => (
                        <button
                          key={r.skuId}
                          type="button"
                          className="block w-full truncate px-3 py-1.5 text-left text-xs hover:bg-muted"
                          onClick={() => selectAddResult(r)}
                        >
                          {r.productCode} · {r.productName}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-lot-label" className="text-[11px] text-muted-foreground">{tx.lotLabel}</Label>
                <Input
                  id="add-lot-label"
                  value={addLotValue}
                  onChange={(e) => setAddLotValue(e.target.value)}
                  placeholder={tx.lotPlaceholder}
                  className="h-8 w-24 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-lot-date" className="text-[11px] text-muted-foreground">{tx.expiry}</Label>
                <Input id="add-lot-date" type="date" value={addDateValue} onChange={(e) => setAddDateValue(e.target.value)} className="h-8 w-36 text-xs" />
              </div>
              <Button size="sm" className="h-8 text-xs" onClick={submitAddLot} disabled={addSubmitting || !addSelected || !addDateValue}>
                <Plus className="size-3.5" />
                {c.add}
              </Button>
            </div>
          </div>
        )}

        {entries.length === 0 ? (
          <p className="text-xs text-muted-foreground">{tx.empty}</p>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Tabs value={warehouseFilter} onValueChange={changeWarehouseFilter}>
                <TabsList>
                  <TabsTrigger value="ALL">{c.all}</TabsTrigger>
                  {warehouses.map((w) => (
                    <TabsTrigger key={w.id} value={w.id}>
                      {w.name}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
              <div className="relative">
                <Search className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input
                  value={search}
                  onChange={(e) => changeSearch(e.target.value)}
                  placeholder={tx.searchPlaceholder}
                  aria-label={tx.searchAria}
                  className="h-8 w-52 pl-7 text-xs"
                />
              </div>
            </div>

            {isAdmin && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 p-2.5">
                <label className="flex items-center gap-2 text-xs font-medium">
                  <Checkbox checked={allSelected} onCheckedChange={(checked) => toggleSelectAll(checked === true)} aria-label={tx.selectAll} />
                  {tx.selectAll}
                </label>
                {selectedSkuIds.size > 0 && (
                  <>
                    <span className="text-xs text-muted-foreground">{format(tx.selected, { count: selectedSkuIds.size })}</span>
                    <Input
                      value={bulkRiskDaysInput}
                      onChange={(e) => setBulkRiskDaysInput(e.target.value)}
                      placeholder={tx.riskDaysPlaceholder}
                      inputMode="numeric"
                      className="h-8 w-32 text-xs"
                    />
                    <Button size="sm" className="h-8 text-xs" onClick={applyBulkRiskDays} disabled={bulkApplying || !bulkRiskDaysInput}>
                      {tx.applySelected}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setSelectedSkuIds(new Set())} disabled={bulkApplying}>
                      {tx.clearSelection}
                    </Button>
                  </>
                )}
              </div>
            )}

            {filteredEntries.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {search.trim() ? tx.noResults : tx.emptyWarehouse}
              </p>
            )}

            {pageRows.map((entry) => {
              const isEditing = editingLotId === entry.lotId;
              const badge = expirationBadge(daysUntil(entry.expirationDate), tx.expired);
              const riskDaysLabel = format(tx.riskDays, { days: entry.expirationRiskDays ?? DEFAULT_EXPIRATION_RISK_DAYS });
              return (
                <div key={entry.lotId} className="flex flex-col gap-2 rounded-md border px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    {isAdmin && (
                      <Checkbox
                        checked={selectedSkuIds.has(entry.skuId)}
                        onCheckedChange={(checked) => toggleSelect(entry.skuId, checked === true)}
                        aria-label={format(tx.selectAria, { name: entry.productName })}
                        className="shrink-0"
                      />
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className="shrink-0 text-[11px]">
                          {entry.warehouseCode}
                        </Badge>
                        <span className="truncate font-medium">{entry.productName}</span>
                        <Badge variant="secondary" className="shrink-0 text-[11px]">
                          {format(tx.lot, { lot: entry.lot })}
                        </Badge>
                        {entry.isAutoLot && <span className="shrink-0 text-[10px] text-muted-foreground">{tx.auto}</span>}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">{entry.productCode}</div>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                    {isEditing ? (
                      <>
                        <Input
                          value={editingLotValue}
                          onChange={(e) => setEditingLotValue(e.target.value)}
                          placeholder={tx.lotAutoPlaceholder}
                          className="h-8 w-20 text-xs"
                          aria-label={tx.lotAria}
                        />
                        <Input type="date" value={editingDateValue} onChange={(e) => setEditingDateValue(e.target.value)} className="h-8 w-36 text-xs" />
                        <Input
                          value={editingRiskDaysValue}
                          onChange={(e) => setEditingRiskDaysValue(e.target.value)}
                          placeholder={tx.riskDaysShort}
                          inputMode="numeric"
                          className="h-8 w-20 text-xs"
                          aria-label={tx.riskDaysAria}
                        />
                        <Button size="icon" variant="ghost" className="size-7" disabled={saving} onClick={() => saveEdit(entry)} aria-label={c.save}>
                          <Check className="size-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="size-7" disabled={saving} onClick={() => setEditingLotId(null)} aria-label={c.cancel}>
                          <X className="size-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${badge.className}`}>{badge.label}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">{formatKstDate(entry.expirationDate)}</span>
                        <span className="text-[11px] text-muted-foreground">{riskDaysLabel}</span>
                        {isAdmin && (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-7"
                              disabled={deletingLotId === entry.lotId}
                              onClick={() => startEdit(entry)}
                              aria-label={format(tx.editAria, { name: entry.productName, lot: entry.lot })}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-7 text-destructive hover:bg-destructive/10 hover:text-destructive"
                              disabled={deletingLotId === entry.lotId}
                              onClick={() => deleteLot(entry)}
                              aria-label={format(tx.deleteAria, { name: entry.productName, lot: entry.lot })}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}

            <Pagination page={currentPage} totalPages={totalPages} onChange={setPage} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}
