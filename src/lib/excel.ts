import ExcelJS from 'exceljs';
import type { Product } from '../types';

export type ReportOptions = {
  kitCode: string;
  title: string;
  updatedBy: string;
  checkedBy: string;
};

const THIN_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF000000' } },
  left: { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } },
  right: { style: 'thin', color: { argb: 'FF000000' } },
};

function formatReportDate(date: Date): string {
  return new Intl.DateTimeFormat('pt-BR').format(date);
}

function toExcelDate(value: string): Date | null {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day, 12, 0, 0);
}

function normalizeLocation(location: string): string {
  const normalized = location.trim().replace(/\s+/g, ' ').toUpperCase();
  return normalized || 'SEM LOCAL DEFINIDO';
}

function locationOrder(location: string): number {
  const match = location.match(/PRATELEIRA\s*(\d+)/i);
  return match ? Number(match[1]) : 9999;
}

function groupProducts(products: Product[]): Array<[string, Product[]]> {
  const groups = new Map<string, Product[]>();

  products.forEach((product) => {
    const location = normalizeLocation(product.location);
    const current = groups.get(location) ?? [];
    current.push(product);
    groups.set(location, current);
  });

  return [...groups.entries()]
    .sort(([locationA], [locationB]) => {
      const orderDifference = locationOrder(locationA) - locationOrder(locationB);
      return orderDifference || locationA.localeCompare(locationB, 'pt-BR');
    })
    .map(([location, items]) => [
      location,
      items.sort((a, b) =>
        a.name.localeCompare(b.name, 'pt-BR') ||
        a.ecode.localeCompare(b.ecode, 'pt-BR') ||
        a.batch.localeCompare(b.batch, 'pt-BR'),
      ),
    ]);
}

function styleTableCell(cell: ExcelJS.Cell, options?: { bold?: boolean; fill?: string; alignment?: ExcelJS.Alignment }) {
  cell.font = {
    name: 'Arial',
    size: 9,
    bold: options?.bold ?? false,
    color: { argb: 'FF000000' },
  };
  cell.border = THIN_BORDER;
  cell.alignment = options?.alignment ?? {
    horizontal: 'center',
    vertical: 'middle',
    wrapText: true,
  };

  if (options?.fill) {
    cell.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: options.fill },
    };
  }
}

function downloadWorkbook(buffer: ExcelJS.Buffer, filename: string): void {
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export async function exportProductsToExcel(products: Product[], options: ReportOptions): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'QuimStock';
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet('Controle de Materiais', {
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      horizontalCentered: true,
      verticalCentered: false,
      margins: {
        left: 0.25,
        right: 0.25,
        top: 0.35,
        bottom: 0.35,
        header: 0.1,
        footer: 0.1,
      },
    },
    properties: {
      defaultRowHeight: 18,
    },
  });

  worksheet.columns = [
    { key: 'ecode', width: 16 },
    { key: 'batch', width: 19 },
    { key: 'description', width: 55 },
    { key: 'volume', width: 11 },
    { key: 'expiryDate', width: 17 },
  ];
  worksheet.views = [{ state: 'frozen', ySplit: 4 }];
  worksheet.pageSetup.printTitlesRow = '1:4';

  worksheet.mergeCells('A1:E1');
  const metadataCell = worksheet.getCell('A1');
  metadataCell.value = `ATUALIZADO POR: ${options.updatedBy.trim() || '________________'} / CHECADO POR: ${options.checkedBy.trim() || '________________'}   ${formatReportDate(new Date())}`;
  metadataCell.font = { name: 'Arial', size: 9, bold: true };
  metadataCell.alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getRow(1).height = 22;

  worksheet.mergeCells('A2:B3');
  const kitCell = worksheet.getCell('A2');
  kitCell.value = `KIT\n${options.kitCode.trim() || 'FACC-GPX-MIPP-01'}`;
  styleTableCell(kitCell, { bold: true });

  worksheet.mergeCells('C2:E3');
  const titleCell = worksheet.getCell('C2');
  titleCell.value = options.title.trim() || 'KIT MIPP - SALA DE PREPARAÇÃO DE TINTAS';
  styleTableCell(titleCell, { bold: true });
  titleCell.font = { name: 'Arial', size: 12, bold: true };
  worksheet.getRow(2).height = 24;
  worksheet.getRow(3).height = 24;

  const headerRow = worksheet.getRow(4);
  headerRow.values = ['CÓD EMB', 'LOTE', 'DESCRIÇÃO', 'VOLUME', 'VALIDADE'];
  headerRow.height = 22;
  headerRow.eachCell((cell) => styleTableCell(cell, { bold: true, fill: 'FFF2F2F2' }));

  let currentRow = 5;
  const groupedProducts = groupProducts(products);

  groupedProducts.forEach(([location, items]) => {
    worksheet.mergeCells(`A${currentRow}:E${currentRow}`);
    const groupCell = worksheet.getCell(`A${currentRow}`);
    groupCell.value = location;
    styleTableCell(groupCell, { bold: true, fill: 'FFD9D9D9' });
    worksheet.getRow(currentRow).height = 19;
    currentRow += 1;

    items.forEach((product) => {
      const row = worksheet.getRow(currentRow);
      row.values = [
        product.ecode,
        product.batch,
        product.name || `MATERIAL ${product.ecode}`,
        product.quantity,
        toExcelDate(product.expiryDate),
      ];
      row.height = 20;

      row.eachCell((cell, columnNumber) => {
        styleTableCell(cell, {
          alignment: {
            horizontal: columnNumber === 3 ? 'center' : 'center',
            vertical: 'middle',
            wrapText: true,
          },
        });
      });

      row.getCell(1).numFmt = '@';
      row.getCell(2).numFmt = '@';
      row.getCell(4).numFmt = '0';
      row.getCell(5).numFmt = 'dd/mm/yyyy';
      currentRow += 1;
    });
  });

  if (!groupedProducts.length) {
    worksheet.mergeCells(`A${currentRow}:E${currentRow}`);
    const emptyCell = worksheet.getCell(`A${currentRow}`);
    emptyCell.value = 'NENHUM PRODUTO CADASTRADO';
    styleTableCell(emptyCell, { bold: true, fill: 'FFF2F2F2' });
    currentRow += 1;
  }

  worksheet.mergeCells(`A${currentRow + 1}:E${currentRow + 1}`);
  const footerCell = worksheet.getCell(`A${currentRow + 1}`);
  footerCell.value = `Controle de Materiais KIT ${options.kitCode.trim() || 'FACC-GPX-MIPP-01'} Rev. A`;
  footerCell.font = { name: 'Arial', size: 8 };
  footerCell.alignment = { horizontal: 'left', vertical: 'middle' };
  worksheet.getRow(currentRow + 1).height = 20;

  worksheet.autoFilter = {
    from: 'A4',
    to: `E${Math.max(4, currentRow - 1)}`,
  };
  worksheet.pageSetup.printArea = `A1:E${currentRow + 1}`;

  const buffer = await workbook.xlsx.writeBuffer();
  const date = new Date().toISOString().slice(0, 10);
  downloadWorkbook(buffer, `controle-materiais-kit-${date}.xlsx`);
}
