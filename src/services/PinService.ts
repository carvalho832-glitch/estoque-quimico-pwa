type PinRecord = {
  version: 1;
  algorithm: 'PBKDF2-SHA-256';
  iterations: number;
  salt: string;
  hash: string;
};

const PIN_STORAGE_KEY = 'quimstock:admin-pin:v1';
const DEFAULT_INITIAL_PIN = '1793';
const PBKDF2_ITERATIONS = 210_000;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((value) => { binary += String.fromCharCode(value); });
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function derivePinHash(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(pin),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt,
      iterations,
    },
    keyMaterial,
    256,
  );

  return new Uint8Array(bits);
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

async function createRecord(pin: string): Promise<PinRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePinHash(pin, salt, PBKDF2_ITERATIONS);
  return {
    version: 1,
    algorithm: 'PBKDF2-SHA-256',
    iterations: PBKDF2_ITERATIONS,
    salt: bytesToBase64(salt),
    hash: bytesToBase64(hash),
  };
}

function readRecord(): PinRecord | null {
  const raw = localStorage.getItem(PIN_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Partial<PinRecord>;
    if (
      parsed.version !== 1 ||
      parsed.algorithm !== 'PBKDF2-SHA-256' ||
      typeof parsed.iterations !== 'number' ||
      typeof parsed.salt !== 'string' ||
      typeof parsed.hash !== 'string'
    ) return null;

    return parsed as PinRecord;
  } catch {
    return null;
  }
}

export async function ensurePinInitialized(): Promise<void> {
  if (readRecord()) return;
  const record = await createRecord(DEFAULT_INITIAL_PIN);
  localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(record));
}

export async function verifyPin(pin: string): Promise<boolean> {
  await ensurePinInitialized();
  const record = readRecord();
  if (!record) return false;

  try {
    const candidate = await derivePinHash(pin, base64ToBytes(record.salt), record.iterations);
    return constantTimeEqual(candidate, base64ToBytes(record.hash));
  } catch {
    return false;
  }
}

export async function changePin(currentPin: string, newPin: string, confirmation: string): Promise<void> {
  if (!(await verifyPin(currentPin))) throw new Error('PIN atual inválido.');
  if (!/^\d{4,12}$/.test(newPin)) throw new Error('O novo PIN deve ter entre 4 e 12 números.');
  if (newPin !== confirmation) throw new Error('A confirmação do novo PIN não confere.');

  const record = await createRecord(newPin);
  localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(record));
}

export function hasPinConfigured(): boolean {
  return readRecord() !== null;
}
