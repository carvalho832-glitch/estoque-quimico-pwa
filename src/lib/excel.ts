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
  title: 'KIT MIPP - SALA DE PREPARAÇÃO DE TINTAS',
  updatedBy: '',
  checkedBy: '',
  revision: 'A',
};

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

export function exportProductsToPdf(products: Product[], reportOptions: ReportOptions = {}): void {
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

  const date = new Date().toISOString().slice(0, 10);
  doc.save(`controle-materiais-kit-${date}.pdf`);
}
