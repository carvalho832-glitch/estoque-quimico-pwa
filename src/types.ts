export type Product = {
  id: string;
  name: string;
  ecode: string;
  docmat?: string;
  batch: string;
  supplierBatch?: string;
  packageVolume?: string;
  qrPrefix?: string;
  qrRaw?: string;
  expiryDate: string;
  quantity: number;
  location: string;
  notes: string;
  imageName?: string;
  createdAt: string;
  updatedAt: string;
};

export type ProductDraft = Omit<Product, 'id' | 'createdAt' | 'updatedAt'>;

export type ExpiryLevel = 'expired' | 'critical' | 'warning' | 'valid' | 'unknown';

export type InventoryQrData = {
  prefix: string;
  docmat: string;
  batch: string;
  ecode: string;
  supplierBatch: string;
  packageVolume: string;
  raw: string;
};
