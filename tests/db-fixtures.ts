import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma';
import type { ParsedInventoryRow } from '../src/domain/excel/types';

export function requireTestDatabase() {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error('DATABASE_URL must point to a dedicated local test database.');
  const url = new URL(value);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !url.pathname.endsWith('_test')) {
    throw new Error('DB checks require a local database whose name ends in _test.');
  }
}

export async function createFixture() {
  requireTestDatabase();
  const tag = randomUUID();
  const org = await prisma.organization.create({ data: { name: `DB test ${tag}` } });
  const user = await prisma.user.create({ data: { organizationId: org.id, email: `${tag}@test.invalid`, name: 'DB test', passwordHash: 'not-a-login' } });
  const warehouse = await prisma.warehouse.create({ data: { organizationId: org.id, code: tag, name: 'DB test warehouse' } });
  return { org, user, warehouse };
}

export async function cleanupFixture(fixture: Awaited<ReturnType<typeof createFixture>>) {
  // Delete only the randomly named fixture, never truncate the database.
  const warehouseId = fixture.warehouse.id;
  await prisma.snapshotInbound.deleteMany({ where: { sku: { warehouseId } } });
  await prisma.inventoryEvent.deleteMany({ where: { warehouseId } });
  await prisma.inventorySnapshot.deleteMany({ where: { warehouseId } });
  await prisma.sku.deleteMany({ where: { warehouseId } });
  await prisma.warehouse.delete({ where: { id: warehouseId } });
  await prisma.eventSchedule.deleteMany({ where: { organizationId: fixture.org.id } });
  await prisma.holiday.deleteMany({ where: { organizationId: fixture.org.id } });
  await prisma.settings.deleteMany({ where: { organizationId: fixture.org.id } });
  await prisma.purchaseOrder.deleteMany({ where: { item: { organizationId: fixture.org.id } } });
  await prisma.storeItem.deleteMany({ where: { organizationId: fixture.org.id } });
  await prisma.supplier.deleteMany({ where: { organizationId: fixture.org.id } });
  await prisma.dailySales.deleteMany({ where: { organizationId: fixture.org.id } });
  await prisma.importTemplate.deleteMany({ where: { organizationId: fixture.org.id } });
  await prisma.user.delete({ where: { id: fixture.user.id } });
  await prisma.organization.delete({ where: { id: fixture.org.id } });
}

export function row(productCode: string, normalStock = 100, overrides: Partial<ParsedInventoryRow> = {}): ParsedInventoryRow {
  return {
    rowNumber: 1, productCode, productName: productCode, normalStock, availableStock: normalStock,
    unitCost: 10, totalCost: null, costMissing: false, option: null, barcode: null, location: null,
    category: null, incomingStock: 0, defectiveStock: 0, warningQty: 0, dangerQty: 0, extra: {}, ...overrides,
  };
}
