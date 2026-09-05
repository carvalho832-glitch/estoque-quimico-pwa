import { Workbook, type Cell } from 'exceljs';
import type { Product } from '../types';
import { createCanonicalProductId } from './product-identity';

export type StockImportPreview = {
  products: Product[];
  totalUnits: number;
  locations: Array<{ name: string; products: number; units: number }>;
  warnings: string[];
};

function cleanText(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizedHeader(value: string): string {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
}

function normalizeLocation(value: string): string {
  return cleanText(value).toUpperCase();
}

function numberFromCell(cell: Cell): number {
  if (typeof cell.value === 'number') return cell.value;
  const normalized = cleanText(cell.text).replace(/\./g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function excelSerialToIso(serial: number): string {
  const epoch = Date.UTC(1899, 11, 30);
  const date = new Date(epoch + Math.round(serial * 86400000));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function dateFromCell(cell: Cell): string {
  if (cell.value instanceof Date) {
    return Number.isNaN(cell.value.getTime()) ? '' : cell.value.toISOString().slice(0, 10);
  }

  if (typeof cell.value === 'number') return excelSerialToIso(cell.value);

  const text = cleanText(cell.text);
  if (!text) return '';

  const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) {
    const [, day, month, year] = br;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return iso ? text : '';
}

function isHeaderRow(values: string[]): boolean {
  const headers = values.map(normalizedHeader);
  return headers[0].includes('COD EMB')
    && headers[1].includes('LOTE')
    && headers[2].includes('DESCRICAO')
    && headers[3].includes('VOLUME')
    && headers[4].includes('VALIDADE');
}

export async function parseStockBackupExcel(file: File): Promise<StockImportPreview> {
  if (!/\.xlsx$/i.test(file.name)) {
    throw new Error('Selecione um arquivo Excel no formato .xlsx.');
  }

  const workbook = new Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const worksheet = workbook.worksheets[0];

  if (!worksheet) throw new Error('A planilha não possui nenhuma aba para importar.');

  let currentLocation = '';
  let tableStarted = false;
  const warnings: string[] = [];
  const byId = new Map<string, Product>();
  const now = new Date().toISOString();

  for (let rowNumber = 1; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const texts = [1, 2, 3, 4, 5].map((column) => cleanText(row.getCell(column).text));
    const first = texts[0];

    if (/^PRATELEIRA\b/i.test(first)) {
      currentLocation = normalizeLocation(first);
      continue;
    }

    if (isHeaderRow(texts)) {
      tableStarted = true;
      continue;
    }

    if (!tableStarted || !first) continue;

    const ecode = first;
    const batch = texts[1];
    const name = texts[2];
    const quantity = numberFromCell(row.getCell(4));
    const expiryDate = dateFromCell(row.getCell(5));

    if (!batch || !name) continue;
    if (!currentLocation) {
      warnings.push(`Linha ${rowNumber}: produto ignorado porque não há prateleira definida.`);
      continue;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      warnings.push(`Linha ${rowNumber}: ${ecode} / ${batch} ignorado por quantidade inválida.`);
      continue;
    }
    if (!expiryDate) {
      warnings.push(`Linha ${rowNumber}: ${ecode} / ${batch} está sem validade reconhecida.`);
    }

    const identity = { ecode, batch, name };
    const id = createCanonicalProductId(identity);
    const product: Product = {
      id,
      name,
      ecode,
      batch,
      expiryDate,
      quantity: Math.trunc(quantity),
      location: currentLocation,
      notes: '',
      availabilityStatus: 'stock',
      createdAt: now,
      updatedAt: now,
    };

    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, product);
      continue;
    }

    if (existing.location !== product.location || existing.expiryDate !== product.expiryDate) {
      throw new Error(
        `O mesmo produto aparece com local ou validade diferentes (${ecode} / ${batch} / ${name}). `
        + 'Revise a planilha antes de restaurar.',
      );
    }

    byId.set(id, { ...existing, quantity: existing.quantity + product.quantity, updatedAt: now });
    warnings.push(`Linhas repetidas de ${ecode} / ${batch} / ${name} foram somadas com segurança.`);
  }

  const products = [...byId.values()];
  if (!products.length) {
    throw new Error('Nenhum produto válido foi encontrado no formato de backup do QuimStock.');
  }

  const locationMap = new Map<string, { products: number; units: number }>();
  products.forEach((product) => {
    const current = locationMap.get(product.location) ?? { products: 0, units: 0 };
    current.products += 1;
    current.units += product.quantity;
    locationMap.set(product.location, current);
  });

  const locations = [...locationMap.entries()]
    .map(([name, summary]) => ({ name, ...summary }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

  return {
    products,
    totalUnits: products.reduce((sum, product) => sum + product.quantity, 0),
    locations,
    warnings: [...new Set(warnings)],
  };
}
