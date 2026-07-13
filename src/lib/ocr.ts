import { createWorker } from 'tesseract.js';
import type { ProductDraft } from '../types';

type ProgressCallback = (progress: number, status: string) => void;

function normalizeDate(raw: string): string {
  const match = raw.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (!match) return '';

  const [, day, month, rawYear] = match;
  const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function extractValue(text: string, labels: string[]): string {
  for (const label of labels) {
    const expression = new RegExp(`${label}\\s*[:#-]?\\s*([A-Z0-9./_-]{3,})`, 'i');
    const match = text.match(expression);
    if (match?.[1]) return match[1].trim();
  }
  return '';
}

function normalizeNumericCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[OQ]/g, '0')
    .replace(/[IL|]/g, '1')
    .replace(/[^0-9]/g, '');
}

function extractCemb(text: string): string {
  // Alguns OCRs confundem o B de CEMB com o número 8 e dígitos com letras.
  const match = text.match(/C\s*E\s*M\s*[B8]\s*[:#-]?\s*([0-9OQIL|]{5,})/i);
  if (!match?.[1]) return '';
  return normalizeNumericCode(match[1]);
}

function extractName(lines: string[]): string {
  const namedLine = lines.find((line) => /^(produto|product|nome)\s*[:#-]/i.test(line));
  if (namedLine) return namedLine.replace(/^(produto|product|nome)\s*[:#-]\s*/i, '').trim();

  return (
    lines.find(
      (line) =>
        line.length >= 4 &&
        !/(lote|lot|batch|ecode|cemb|c[oó]digo|valid|venc|exp|perigo|danger|atenção|warning)/i.test(line) &&
        /[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]/i.test(line),
    ) ?? ''
  );
}

function extractExpiry(text: string, lines: string[]): string {
  const preferred = lines.find((line) => /(validade|vencimento|venc\.?|expiry|exp\.?)/i.test(line));
  const datePattern = /(\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4})/;
  const preferredMatch = preferred?.match(datePattern)?.[1];
  if (preferredMatch) return normalizeDate(preferredMatch);

  const fallback = text.match(datePattern)?.[1];
  return fallback ? normalizeDate(fallback) : '';
}

export function parseLabelText(text: string): Partial<ProductDraft> {
  const cleaned = text.replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').trim();
  const lines = cleaned
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  return {
    name: extractName(lines),
    ecode: extractCemb(cleaned) || extractValue(cleaned, ['C\\s*E\\s*M\\s*B', 'E\\s*CODE', 'ECODE', 'C[ÓO]DIGO']),
    batch: extractValue(cleaned, ['LOTE', 'LOT', 'BATCH']),
    expiryDate: extractExpiry(cleaned, lines),
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
