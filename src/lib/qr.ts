import jsQR from 'jsqr';
import type { InventoryQrData } from '../types';

function loadImage(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Não foi possível abrir a foto.'));
    };
    image.src = url;
  });
}

function createCanvas(image: HTMLImageElement): HTMLCanvasElement {
  const longestSide = Math.max(image.naturalWidth, image.naturalHeight);
  const scale = Math.min(3, Math.max(1, 2400 / longestSide));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.naturalWidth * scale);
  canvas.height = Math.round(image.naturalHeight * scale);

  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Não foi possível analisar a imagem.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function enhanceImageData(source: ImageData): ImageData {
  const result = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
  const data = result.data;

  for (let index = 0; index < data.length; index += 4) {
    const gray = 0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2];
    const contrasted = Math.max(0, Math.min(255, (gray - 128) * 1.55 + 128));
    data[index] = contrasted;
    data[index + 1] = contrasted;
    data[index + 2] = contrasted;
  }

  return result;
}

function parseOptionalDate(parts: string[]): string {
  for (const part of parts) {
    const value = part.trim();

    const separated = value.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/);
    if (separated) {
      const [, day, month, year] = separated;
      return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    }

    const compactInternational = value.match(/^(20\d{2})(\d{2})(\d{2})$/);
    if (compactInternational) {
      const [, year, month, day] = compactInternational;
      return `${year}-${month}-${day}`;
    }
  }

  return '';
}

export function parseInventoryQr(rawValue: string): InventoryQrData {
  const raw = rawValue.trim();
  const parts = raw.split(';').map((part) => part.trim());

  if (parts.length < 4) {
    throw new Error('O QR Code não possui o formato esperado do estoque.');
  }

  const [prefix = '', docmat = '', batch = '', ecode = '', supplierBatch = '', packageVolume = ''] = parts;

  if (!batch || !ecode) {
    throw new Error('O QR Code não contém Ecode/Material e lote completos.');
  }

  return {
    prefix,
    docmat,
    batch: batch.toUpperCase(),
    ecode: ecode.toUpperCase(),
    supplierBatch: supplierBatch.toUpperCase(),
    packageVolume,
    expiryDate: parseOptionalDate(parts.slice(4)),
    raw,
  };
}

export async function readInventoryQr(file: File): Promise<InventoryQrData> {
  const image = await loadImage(file);
  const canvas = createCanvas(image);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Não foi possível analisar o QR Code.');

  const original = context.getImageData(0, 0, canvas.width, canvas.height);
  const attempts = [original, enhanceImageData(original)];

  for (const imageData of attempts) {
    const result = jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: 'attemptBoth',
    });

    if (result?.data) return parseInventoryQr(result.data);
  }

  throw new Error('QR Code não encontrado. Aproxime a câmera e evite reflexos.');
}
