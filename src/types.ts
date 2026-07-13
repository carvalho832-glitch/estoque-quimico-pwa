export type Product = {
  id: string;
  name: string;
  ecode: string;
  batch: string;
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
