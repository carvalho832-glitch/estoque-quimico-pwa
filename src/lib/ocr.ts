import { createWorker } from 'tesseract.js';
import type { ProductDraft } from '../types';

type ProgressCallback = (progress: number, status: string) => void;

function normalizeNumericCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[OQ]/g, '0')
    .replace(/[IL|]/g, '1')
    .replace(/[^0-9]/g, '');
}

function normalizeDate(raw: string): string {
  const value = raw.trim();

  const brazilian = value.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (brazilian) {
    const [, day, month, rawYear] = brazilian;
    const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const international = value.match(/(20\d{2})[\/.\-](\d{1,2})[\/.\-](\d{1,2})/);
  if (international) {
    const [, year, month, day] = international;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const compact = value.match(/\b(20\d{2})(\d{2})(\d{2})\b/);
  if (compact) {
    const [, year, month, day] = compact;
    return `${year}-${month}-${day}`;
  }

  return '';
}

function valueAfterLabel(lines: string[], label: RegExp, maxFollowingLines = 2): string {
  const index = lines.findIndex((line) => label.test(line));
  if (index < 0) return '';

  const sameLine = lines[index].replace(label, '').replace(/^\s*[:#-]?\s*/, '').trim();
  if (sameLine) return sameLine;

  for (let offset = 1; offset <= maxFollowingLines; offset += 1) {
    const candidate = lines[index + offset]?.trim();
    if (candidate) return candidate;
  }

  return '';
}

function extractCemb(lines: string[]): string {
  // No rótulo padrão, o valor correto aparece logo abaixo de CEMB.
  const raw = valueAfterLabel(lines, /^\s*C\s*E\s*M\s*[B8]\s*/i);
  const code = normalizeNumericCode(raw);
  return code.length >= 5 ? code : '';
}

function extractName(lines: string[]): string {
  const description = valueAfterLabel(lines, /^\s*DESCRI[CÇ][AÃ]O\s*/i);
  if (description) return description;

  const productName = valueAfterLabel(lines, /^\s*(PRODUTO|PRODUCT|NOME)\s*/i);
  if (productName) return productName;

  return (
    lines.find(
      (line) =>
        line.length >= 4 &&
        !/(pem|cemb|lote|lot|batch|ecode|c[oó]digo|valid|venc|exp|quantidade|part number|perigo|danger|atenção|warning)/i.test(line) &&
        /[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]/i.test(line),
    ) ?? ''
  );
}

function extractBatch(lines: string[]): string {
  const raw = valueAfterLabel(lines, /^\s*(LOTE|LOT|BATCH)\s*/i);
  const match = raw.match(/[A-Z0-9./_-]{4,}/i);
  return match?.[0]?.toUpperCase() ?? '';
}

function extractExpiry(lines: string[]): string {
  const raw = valueAfterLabel(lines, /^\s*(DT\.?\s*)?(VALIDADE|VENCIMENTO|VENC\.?|EXPIRY|EXP\.?)\s*/i, 2);
  return raw ? normalizeDate(raw) : '';
}

export function parseLabelText(text: string): Partial<ProductDraft> {
  const lines = text
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);

  return {
    name: extractName(lines),
    ecode: extractCemb(lines),
    batch: extractBatch(lines),
    expiryDate: extractExpiry(lines),
  };
}

export async function readLabel(file: File, onProgress: ProgressCallback): Promise<{ text: string; fields: Partial<ProductDraft> }> {
  const worker = await createWorker('por+eng', 1, {
    logger: (message) => {
      const progress = typeof message.progress === 'number' ? message.progress : 0;
      onProgress(progress, message.status ?? 'Processando imagem');
    },
  });

  try {
    const result = await worker.recognize(file);
    return { text: result.data.text, fields: parseLabelText(result.data.text) };
  } finally {
    await worker.terminate();
  }
}
