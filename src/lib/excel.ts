import * as XLSX from 'xlsx';
import type { Product } from '../types';
import { formatDate, getExpiryLabel } from './expiry';

export function exportProductsToExcel(products: Product[]): void {
  const rows = products.map((product) => ({
    'Ecode/Material': product.ecode,
    Lote: product.batch,
    DV: formatDate(product.expiryDate),
    Produto: product.name,
    Docmat: product.docmat ?? '',
    Quantidade: product.quantity,
    Local: product.location,
    Status: getExpiryLabel(product.expiryDate),
    Observações: product.notes,
    'Atualizado em': new Date(product.updatedAt).toLocaleString('pt-BR'),
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet['!cols'] = [
    { wch: 18 },
    { wch: 18 },
    { wch: 14 },
    { wch: 28 },
    { wch: 18 },
    { wch: 12 },
    { wch: 20 },
    { wch: 22 },
    { wch: 34 },
    { wch: 22 },
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Estoque');
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(workbook, `quimstock-estoque-${date}.xlsx`);
}
