import type { Product } from '../types';

function normalizeIdentityPart(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

function hashIdentity(value: string, seed: number): string {
  let hash = seed >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function productIdentityKey(product: Pick<Product, 'ecode' | 'batch' | 'name'>): string {
  return [product.ecode, product.batch, product.name]
    .map(normalizeIdentityPart)
    .join('|');
}

export function createCanonicalProductId(product: Pick<Product, 'ecode' | 'batch' | 'name'>): string {
  const identity = productIdentityKey(product);
  const firstHash = hashIdentity(identity, 2166136261);
  const secondHash = hashIdentity(identity, 0x9e3779b9);
  return `p2-${firstHash}${secondHash}`;
}
