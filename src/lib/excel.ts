import type ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Product } from '../types';

export type ReportOptions = {
  kitCode?: string;
  title?: string;
  updatedBy?: string;
  checkedBy?: string;
  revision?: string;
};

const DEFAULT_OPTIONS: Required<ReportOptions> = {
  kitCode: 'FACC-GPX-MIPP-01',
  title: 'KIT MIPP – SALA DE PREPARAÇÃO DE TINTAS',
  updatedBy: '',
  checkedBy: '',
  revision: 'A',
};

const EXCEL_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type ReportDeliveryResult = 'shared' | 'downloaded' | 'cancelled';

type ExcelJSRuntime = {
  Workbook: typeof import('exceljs').Workbook;
};

let excelRuntimePromise: Promise<ExcelJSRuntime> | null = null;

const FACC_REPORT_LOGO_BASE64 = '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';

function formatDate(value: string): string {
  if (!value) return '';
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function formatToday(): string {
  return new Intl.DateTimeFormat('pt-BR').format(new Date());
}

function cleanText(value: string): string {
  return value.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeLocation(location: string): string {
  const normalized = cleanText(location).toUpperCase();
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
        cleanText(a.name).localeCompare(cleanText(b.name), 'pt-BR') ||
        a.ecode.localeCompare(b.ecode, 'pt-BR') ||
        a.batch.localeCompare(b.batch, 'pt-BR'),
      ),
    ]);
}

function reportFileName(extension: 'pdf' | 'xlsx'): string {
  const date = new Date().toISOString().slice(0, 10);
  return `controle-materiais-kit-${date}.${extension}`;
}

function downloadFile(file: File): void {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  anchor.style.display = 'none';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function shareOrDownloadFile(file: File): Promise<ReportDeliveryResult> {
  const { Capacitor } = await import('@capacitor/core');

  if (Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import('@capacitor/filesystem'),
      import('@capacitor/share'),
    ]);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';

    for (let start = 0; start < bytes.length; start += 32768) {
      binary += String.fromCharCode(...bytes.subarray(start, start + 32768));
    }

    const savedFile = await Filesystem.writeFile({
      path: file.name,
      data: btoa(binary),
      directory: Directory.Cache,
    });

    try {
      await Share.share({
        title: 'Relatório de estoque do QuimStock',
        files: [savedFile.uri],
        dialogTitle: 'Compartilhar relatório',
      });
    } catch (error) {
      if (error instanceof Error && /share canceled/i.test(error.message)) {
        return 'cancelled';
      }
      throw error;
    }
    return 'shared';
  }

  const shareData: ShareData = {
    title: 'Relatório de estoque do QuimStock',
    files: [file],
  };

  let canShareFile = false;
  try {
    canShareFile = typeof navigator.share === 'function'
      && typeof navigator.canShare === 'function'
      && navigator.canShare({ files: [file] });
  } catch {
    canShareFile = false;
  }

  if (canShareFile) {
    try {
      await navigator.share(shareData);
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return 'cancelled';
      }
    }
  }

  downloadFile(file);
  return 'downloaded';
}

function loadExcelRuntime(): Promise<ExcelJSRuntime> {
  excelRuntimePromise ??= import('exceljs').then(
    (module) => (module as unknown as { default: ExcelJSRuntime }).default,
  );
  return excelRuntimePromise;
}

export function preloadExcelExporter(): void {
  void loadExcelRuntime().catch(() => {
    excelRuntimePromise = null;
  });
}

function drawHeader(doc: jsPDF, options: Required<ReportOptions>): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const left = 8;
  const right = 8;
  const top = 9;
  const headerHeight = 17;
  const kitWidth = 42;
  const contentWidth = pageWidth - left - right;

  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.25);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6.3);

  const updatedBy = options.updatedBy.trim() || '________________';
  const checkedBy = options.checkedBy.trim() || '________________';
  doc.text(
    `ATUALIZADO POR: ${updatedBy} / CHECADO POR: ${checkedBy}`,
    left,
    5.8,
  );
  doc.text(formatToday(), pageWidth - right, 5.8, { align: 'right' });

  doc.rect(left, top, kitWidth, headerHeight);
  doc.rect(left + kitWidth, top, contentWidth - kitWidth, headerHeight);

  doc.setFontSize(7.2);
  doc.text('KIT', left + kitWidth / 2, top + 5.2, { align: 'center' });
  doc.setFontSize(8.2);
  doc.text(options.kitCode, left + kitWidth / 2, top + 11.5, {
    align: 'center',
    maxWidth: kitWidth - 4,
  });

  doc.setFontSize(9.5);
  doc.text(
    options.title,
    left + kitWidth + (contentWidth - kitWidth) / 2,
    top + 10.3,
    { align: 'center', maxWidth: contentWidth - kitWidth - 6 },
  );
}

function drawFooter(doc: jsPDF, options: Required<ReportOptions>): void {
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const pageNumber = doc.getNumberOfPages();

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(0, 0, 0);
  doc.text(
    `Controle de Materiais KIT ${options.kitCode} Rev. ${options.revision}`,
    8,
    pageHeight - 4.5,
  );
  doc.text(`Página ${pageNumber}`, pageWidth - 8, pageHeight - 4.5, { align: 'right' });
}

function createProductsPdfDocument(products: Product[], reportOptions: ReportOptions = {}): jsPDF {
  const options = { ...DEFAULT_OPTIONS, ...reportOptions };
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
    compress: true,
  });

  doc.setProperties({
    title: `Controle de Materiais - ${options.kitCode}`,
    subject: 'Controle de materiais do estoque químico',
    author: 'QuimStock',
    creator: 'QuimStock',
  });

  const body: unknown[] = [];
  const groupedProducts = groupProducts(products);

  groupedProducts.forEach(([location, items]) => {
    body.push([
      {
        content: location,
        colSpan: 5,
        styles: {
          fillColor: [220, 220, 220],
          fontStyle: 'bold',
          halign: 'center',
          cellPadding: 1.1,
        },
      },
    ]);

    items.forEach((product) => {
      body.push([
        cleanText(product.ecode),
        cleanText(product.batch),
        cleanText(product.name || `MATERIAL ${product.ecode}`),
        String(product.quantity),
        formatDate(product.expiryDate),
      ]);
    });
  });

  if (!body.length) {
    body.push([
      {
        content: 'NENHUM PRODUTO CADASTRADO',
        colSpan: 5,
        styles: {
          fillColor: [245, 245, 245],
          fontStyle: 'bold',
          halign: 'center',
        },
      },
    ]);
  }

  autoTable(doc, {
    startY: 29,
    margin: { top: 29, right: 8, bottom: 11, left: 8 },
    head: [['CÓD EMB', 'LOTE', 'DESCRIÇÃO', 'VOLUME', 'VALIDADE']],
    body: body as never[],
    theme: 'grid',
    showHead: 'everyPage',
    styles: {
      font: 'helvetica',
      fontSize: 6.5,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.18,
      cellPadding: { top: 1.05, right: 0.8, bottom: 1.05, left: 0.8 },
      valign: 'middle',
      halign: 'center',
      overflow: 'linebreak',
      minCellHeight: 5.1,
    },
    headStyles: {
      fillColor: [242, 242, 242],
      textColor: [0, 0, 0],
      fontStyle: 'bold',
      halign: 'center',
      valign: 'middle',
      lineColor: [0, 0, 0],
      lineWidth: 0.25,
      minCellHeight: 6.2,
      fontSize: 6.7,
    },
    columnStyles: {
      0: { cellWidth: 28 },
      1: { cellWidth: 37 },
      2: { cellWidth: 78 },
      3: { cellWidth: 18 },
      4: { cellWidth: 33 },
    },
    didDrawPage: () => {
      drawHeader(doc, options);
      drawFooter(doc, options);
    },
  });

  return doc;
}

function createProductsPdfFile(products: Product[], reportOptions: ReportOptions = {}): File {
  const document = createProductsPdfDocument(products, reportOptions);
  return new File([document.output('blob')], reportFileName('pdf'), { type: 'application/pdf' });
}

export function exportProductsToPdf(products: Product[], reportOptions: ReportOptions = {}): void {
  downloadFile(createProductsPdfFile(products, reportOptions));
}

export async function exportOrShareProductsToPdf(
  products: Product[],
  reportOptions: ReportOptions = {},
): Promise<ReportDeliveryResult> {
  return shareOrDownloadFile(createProductsPdfFile(products, reportOptions));
}

function parseExcelDate(value: string): Date | string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return cleanText(value);

  const [, year, month, day] = match;
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
}

function applyReportGrid(cell: ExcelJS.Cell): void {
  const border = { style: 'medium' as const, color: { argb: 'FF000000' } };
  cell.border = {
    top: border,
    left: border,
    bottom: border,
    right: border,
  };
  cell.alignment = {
    horizontal: 'center',
    vertical: 'middle',
    wrapText: true,
  };
}

function styleReportRow(row: ExcelJS.Row, kind: 'header' | 'location' | 'product'): void {
  row.height = 14.25;

  for (let column = 1; column <= 5; column += 1) {
    const cell = row.getCell(column);
    applyReportGrid(cell);

    if (kind === 'header') {
      cell.font = { name: 'Arial', size: 8, bold: true, color: { argb: 'FF000000' } };
    } else if (kind === 'location') {
      cell.font = { name: 'Arial', size: 7, bold: true, color: { argb: 'FF000000' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD0D0D0' } };
    } else {
      cell.font = {
        name: 'Arial',
        size: 7,
        bold: column <= 2,
        italic: column <= 2,
        color: { argb: 'FF000000' },
      };
    }
  }
}

function createProductsExcelFile(buffer: ExcelJS.Buffer): File {
  return new File([buffer as BlobPart], reportFileName('xlsx'), { type: EXCEL_MIME_TYPE });
}

export async function createProductsExcelBuffer(
  products: Product[],
  reportOptions: ReportOptions = {},
): Promise<ExcelJS.Buffer> {
  const options = { ...DEFAULT_OPTIONS, ...reportOptions };
  const ExcelJSRuntime = await loadExcelRuntime();
  const workbook = new ExcelJSRuntime.Workbook();
  workbook.creator = 'QuimStock';
  workbook.lastModifiedBy = 'QuimStock';
  workbook.title = `Controle de Materiais - ${options.kitCode}`;
  workbook.subject = 'Controle de materiais do estoque químico';
  workbook.company = 'FACC';
  workbook.created = new Date();
  workbook.modified = new Date();

  const worksheet = workbook.addWorksheet('Sheet1', {
    properties: {
      defaultColWidth: 14.43,
      defaultRowHeight: 15,
    },
    views: [{ showGridLines: false }],
    pageSetup: {
      paperSize: 9,
      orientation: 'portrait',
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: {
        left: 0.2362204724409449,
        right: 0.1968503937007874,
        top: 0.7480314960629921,
        bottom: 0.7480314960629921,
        header: 0,
        footer: 0,
      },
    },
  });

  [9.86, 11.43, 59, 8.43, 21.14].forEach((width, index) => {
    worksheet.getColumn(index + 1).width = width;
  });

  const updatedBy = cleanText(options.updatedBy) || '________________';
  const checkedBy = cleanText(options.checkedBy) || '________________';
  worksheet.getRow(1).height = 14.25;
  worksheet.getCell('C1').value = `ATUALIZADO POR: ${updatedBy} /  CHECADO POR:   ${checkedBy}   ${formatToday()}`;
  worksheet.getCell('C1').font = { name: 'Aptos Narrow', size: 11, color: { argb: 'FF000000' } };
  worksheet.getCell('C1').alignment = { horizontal: 'center', vertical: 'middle' };
  worksheet.getRow(2).height = 14.25;

  worksheet.mergeCells('A3:B4');
  worksheet.getCell('A3').value = `KIT\n${options.kitCode}`;
  worksheet.getCell('A3').font = { name: 'Aptos Narrow', size: 11, color: { argb: 'FF000000' } };
  worksheet.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD0D0D0' } };
  worksheet.getCell('A3').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

  worksheet.mergeCells('C3:D4');
  worksheet.getCell('C3').value = options.title;
  worksheet.getCell('C3').font = { name: 'Aptos Narrow', size: 12, color: { argb: 'FF000000' } };
  worksheet.getCell('C3').alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };

  for (const address of ['A3', 'B3', 'A4', 'B4', 'C3', 'D3', 'C4', 'D4', 'E3', 'E4']) {
    applyReportGrid(worksheet.getCell(address));
  }
  worksheet.getCell('A3').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD0D0D0' } };
  worksheet.getRow(3).height = 14.25;
  worksheet.getRow(4).height = 27;

  const logoId = workbook.addImage({ base64: FACC_REPORT_LOGO_BASE64, extension: 'jpeg' });
  worksheet.addImage(logoId, {
    tl: {
      nativeCol: 4,
      nativeColOff: 800100,
      nativeRow: 2,
      nativeRowOff: 9525,
    } as unknown as { col: number; row: number },
    ext: { width: 58, height: 51 },
    editAs: 'oneCell',
  });

  worksheet.getRow(5).height = 3.75;
  worksheet.getRow(6).values = ['CÓD EMB', 'LOTE', 'DESCRIÇÃO', 'VOLUME', 'VALIDADE'];
  styleReportRow(worksheet.getRow(6), 'header');
  worksheet.autoFilter = 'A6:E6';

  let rowNumber = 7;
  const groupedProducts = groupProducts(products);

  if (!groupedProducts.length) {
    worksheet.mergeCells(rowNumber, 1, rowNumber, 5);
    worksheet.getCell(rowNumber, 1).value = 'NENHUM PRODUTO CADASTRADO';
    styleReportRow(worksheet.getRow(rowNumber), 'location');
    rowNumber += 1;
  } else {
    groupedProducts.forEach(([location, items]) => {
      worksheet.mergeCells(rowNumber, 1, rowNumber, 5);
      worksheet.getCell(rowNumber, 1).value = location;
      styleReportRow(worksheet.getRow(rowNumber), 'location');
      rowNumber += 1;

      items.forEach((product) => {
        const row = worksheet.getRow(rowNumber);
        row.values = [
          cleanText(product.ecode),
          cleanText(product.batch),
          cleanText(product.name || `MATERIAL ${product.ecode}`),
          Number(product.quantity) || 0,
          parseExcelDate(product.expiryDate),
        ];
        styleReportRow(row, 'product');
        row.getCell(4).numFmt = '0';
        row.getCell(5).numFmt = 'mm-dd-yy';
        rowNumber += 1;
      });
    });
  }

  const lastTableRow = rowNumber - 1;
  worksheet.addConditionalFormatting({
    ref: `E7:E${lastTableRow}`,
    rules: [
      {
        type: 'cellIs',
        operator: 'equal',
        formulae: ['TODAY()'],
        priority: 1,
        style: {
          font: { bold: true, color: { argb: 'FF9C5700' } },
          fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEB9C' } },
        },
      },
      {
        type: 'cellIs',
        operator: 'lessThan',
        formulae: ['TODAY()'],
        priority: 2,
        style: {
          font: { bold: true, color: { argb: 'FF9C0006' } },
          fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } },
        },
      },
    ],
  });

  const footerRow = rowNumber + 1;
  const footerKitCode = options.kitCode.replace('-GPX-', '-');
  worksheet.getCell(footerRow, 1).value = `Controle de Materiais KIT ${footerKitCode} Rev. ${options.revision}`;
  worksheet.getCell(footerRow, 1).font = { name: 'Calibri', size: 9, color: { argb: 'FF000000' } };
  worksheet.getRow(footerRow).height = 14.25;
  worksheet.pageSetup.printArea = `A1:E${footerRow}`;

  return workbook.xlsx.writeBuffer();
}

export async function exportProductsToExcel(
  products: Product[],
  reportOptions: ReportOptions = {},
): Promise<void> {
  const buffer = await createProductsExcelBuffer(products, reportOptions);
  downloadFile(createProductsExcelFile(buffer));
}

export async function exportOrShareProductsToExcel(
  products: Product[],
  reportOptions: ReportOptions = {},
): Promise<ReportDeliveryResult> {
  const buffer = await createProductsExcelBuffer(products, reportOptions);
  return shareOrDownloadFile(createProductsExcelFile(buffer));
}
