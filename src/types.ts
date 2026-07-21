export type ProductAvailabilityStatus = 'stock' | 'in-use';

export type ProductUsage = {
  workOrder: string;
  aircraft: string;
  operator: string;
  startedAt: string;
  returnedAt?: string;
};

export type TechnicalSheet = {
  manufacturer?: string;
  partNumber?: string;
  sapCode?: string;
  color?: string;
  packageWeight?: string;
  hardener?: string;
  thinner?: string;
  mixingRatio?: string;
  potLife?: string;
  coats?: string;
  flashOff?: string;
  wetFilmThickness?: string;
  dryFilmThickness?: string;
  dustFree23C?: string;
  handling23C?: string;
  recoat23C?: string;
  fullCure23C?: string;
  handling40C?: string;
  fullCure40C?: string;
  handling60C?: string;
  recoat60C?: string;
  fullCure60C?: string;
  applicationTemperature?: string;
  maxHumidity?: string;
  storage?: string;
  technicalDataSheetUrl?: string;
  safetyDataSheetUrl?: string;
  notes?: string;
  updatedAt?: string;
};

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
  technicalSheet?: TechnicalSheet;
  availabilityStatus?: ProductAvailabilityStatus;
  currentUsage?: ProductUsage;
  usageHistory?: ProductUsage[];
  createdAt: string;
  updatedAt: string;
};

export type ProductDraft = Omit<
  Product,
  'id' | 'createdAt' | 'updatedAt' | 'availabilityStatus' | 'currentUsage' | 'usageHistory'
>;

export type ExpiryLevel = 'expired' | 'critical' | 'warning' | 'valid' | 'unknown';

export type InventoryQrData = {
  prefix: string;
  docmat: string;
  batch: string;
  ecode: string;
  supplierBatch: string;
  packageVolume: string;
  expiryDate: string;
  raw: string;
};