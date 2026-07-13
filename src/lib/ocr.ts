import { createWorker } from 'tesseract.js';
import type { ProductDraft } from '../types';

type ProgressCallback = (progress: number, status: string) => void;

type ParsedFields = Partial<ProductDraft>;

const NEXT_LABEL_PATTERN = /\s+(?=(?:C\s*E\s*M\s*[B8]|MATERIAL|PART\s*NUMBER|P\s*\/?\s*N|DESCRI[CÇ][AÃ]O|DESC(?:RI[CÇ][AÃ]O)?|LOTE|LOT|BATCH|VALIDADE|VENCIMENTO|EXPIRY|EXP\.?|QUANTIDADE|QTY|VAL)\s*[:#-])/i;

function cleanCandidate(raw: string): string {
  return raw
    .split(NEXT_LABEL_PATTERN)[0]
    .replace(/^[\s:=#"'`´-]+/, '')
    .replace(/[|]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function normalizeNumericCode(raw: string): string {
  return cleanCandidate(raw)
    .toUpperCase()
    .replace(/[OQ]/g, '0')
    .replace(/[IL|]/g, '1')
    .replace(/[^0-9]/g, '');
}

function normalizeDate(raw: string): string {
  const value = cleanCandidate(raw);

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

function isLikelyLabel(line: string): boolean {
  return /^(?:C\s*E\s*M\s*[B8]|MATERIAL|PART\s*NUMBER|P\s*\/?\s*N|DESCRI[CÇ][AÃ]O|DESC(?:RI[CÇ][AÃ]O)?|LOTE|LOT|BATCH|VALIDADE|VENCIMENTO|EXPIRY|EXP\.?|QUANTIDADE|QTY|VAL)\b/i.test(line.trim());
}

function findValueAfterLabels(lines: string[], labels: RegExp[], maxFollowingLines = 2): string {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    for (const label of labels) {
      const match = line.match(label);
      if (!match || match.index === undefined) continue;

      const afterLabel = cleanCandidate(line.slice(match.index + match[0].length));
      if (afterLabel) return afterLabel;

      for (let offset = 1; offset <= maxFollowingLines; offset += 1) {
        const candidate = lines[index + offset]?.trim();
        if (!candidate) continue;
        if (isLikelyLabel(candidate)) break;
        return cleanCandidate(candidate);
      }
    }
  }

  return '';
}

function extractCode(lines: string[]): string {
  const cemb = findValueAfterLabels(lines, [/C\s*E\s*M\s*[B8]\s*[:#-]?/i]);
  const normalizedCemb = normalizeNumericCode(cemb);
  if (normalizedCemb.length >= 5) return normalizedCemb;

  // Algumas etiquetas usam MATERIAL como o código equivalente ao CEMB.
  const material = findValueAfterLabels(lines, [/\bMATERIAL\s*[:#-]?/i, /\bMAT(?:ERIAL)?\.?\s*[:#-]?/i]);
  const normalizedMaterial = normalizeNumericCode(material);
  return normalizedMaterial.length >= 5 ? normalizedMaterial : '';
}

function isValidName(value: string): boolean {
  const cleaned = cleanCandidate(value);
  return cleaned.length >= 4 && /[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]/i.test(cleaned) && !/^[-='"\s]+$/.test(cleaned);
}

function extractName(lines: string[]): string {
  const partNumber = findValueAfterLabels(lines, [
    /\bPART\s*NUMBER\s*[:#-]?/i,
    /\bP\s*\/?\s*N\s*[:#-]?/i,
    /\bPN\s*[:#-]?/i,
  ]);
  if (isValidName(partNumber)) return cleanCandidate(partNumber).toUpperCase();

  const productName = findValueAfterLabels(lines, [/\bPRODUTO\s*[:#-]?/i, /\bPRODUCT\s*[:#-]?/i, /\bNOME\s*[:#-]?/i]);
  if (isValidName(productName)) return cleanCandidate(productName).toUpperCase();

  const description = findValueAfterLabels(lines, [
    /\bDESCRI[CÇ][AÃ]O\s*[:#-]?/i,
    /\bDESC(?:RI[CÇ][AÃ]O)?\s*[:#-]?/i,
  ]);
  if (isValidName(description)) return cleanCandidate(description).toUpperCase();

  return '';
}

function extractBatch(lines: string[]): string {
  const raw = findValueAfterLabels(lines, [
    /\bLOTE\b(?!\s*(?:FOR|FORN))\s*[:#-]?/i,
    /\bBATCH\s*[:#-]?/i,
    /\bLOT\s*[:#-]?/i,
  ]);
  const match = cleanCandidate(raw).match(/[A-Z0-9][A-Z0-9./_-]{3,}/i);
  return match?.[0]?.toUpperCase() ?? '';
}

function extractExpiry(lines: string[]): string {
  const raw = findValueAfterLabels(lines, [
    /\b(?:DT\.?\s*)?VALIDADE\s*[:#-]?/i,
    /\bVENCIMENTO\s*[:#-]?/i,
    /\bVENC\.?\s*[:#-]?/i,
    /\bEXPIRY\s*[:#-]?/i,
    /\bEXP\.?\s*[:#-]?/i,
  ]);
  return raw ? normalizeDate(raw) : '';
}

function extractDescription(lines: string[]): string {
  const description = findValueAfterLabels(lines, [
    /\bDESCRI[CÇ][AÃ]O\s*[:#-]?/i,
    /\bDESC(?:RI[CÇ][AÃ]O)?\s*[:#-]?/i,
  ]);
  return isValidName(description) ? `Descrição do rótulo: ${cleanCandidate(description).toUpperCase()}` : '';
}

export function parseLabelText(text: string): ParsedFields {
  const lines = text
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);

  return {
    name: extractName(lines),
    ecode: extractCode(lines),
    batch: extractBatch(lines),
    expiryDate: extractExpiry(lines),
    notes: extractDescription(lines),
  };
}

async function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível preparar a imagem para leitura.'));
    };
    image.src = url;
  });
}

async function preprocessImage(file: File): Promise<HTMLCanvasElement> {
  const image = await loadImage(file);
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = Math.min(2.5, Math.max(1, 2200 / longestSide));

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Não foi possível processar a imagem.');

  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const contrast = 1.35;

  for (let index = 0; index < data.length; index += 4) {
    const gray = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
    const adjusted = Math.max(0, Math.min(255, (gray - 128) * contrast + 128));
    data[index] = adjusted;
    data[index + 1] = adjusted;
    data[index + 2] = adjusted;
  }

  context.putImageData(imageData, 0, 0);
  return canvas;
}

export async function readLabel(file: File, onProgress: ProgressCallback): Promise<{ text: string; fields: ParsedFields }> {
  onProgress(0.02, 'Melhorando imagem');
  const preparedImage = await preprocessImage(file);

  const worker = await createWorker('por+eng', 1, {
    logger: (message) => {
      const progress = typeof message.progress === 'number' ? message.progress : 0;
      onProgress(progress, message.status ?? 'Processando imagem');
    },
  });

  try {
    const result = await worker.recognize(preparedImage);
    return { text: result.data.text, fields: parseLabelText(result.data.text) };
  } finally {
    await worker.terminate();
  }
}
