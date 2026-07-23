import type { Product, TechnicalSheet } from '../types';

const FR2_55_SEMI_GLOSS: TechnicalSheet = {
  manufacturer: 'AkzoNobel',
  partNumber: '55921749B005K',
  sapCode: '5792024',
  color: 'Beige Artic 1478/1749',
  packageWeight: '5 kg',
  hardener: 'FR2-55 Hardener',
  thinner: 'Água: 15 a 25 partes por peso',
  mixingRatio: '100 partes de base + 20 partes de endurecedor + 15 a 25 partes de água',
  dustFree23C: '60 minutos',
  handling23C: '5 horas',
  recoat23C: '4 a 24 horas',
  fullCure23C: '7 dias',
  handling40C: '2,5 horas',
  fullCure40C: '3 dias',
  handling60C: '1 hora',
  recoat60C: '30 minutos a 4 horas',
  fullCure60C: '12 horas',
  storage: 'Armazenar entre 5 °C e 35 °C. Não congelar.',
  notes: 'Tempos de referência sujeitos às condições reais de aplicação, espessura, ventilação, temperatura e umidade. Confirmar sempre a revisão vigente da documentação aprovada antes de liberar a peça.',
  updatedAt: '2026-07-20',
};

const FR2_55_MATT_BLACK: TechnicalSheet = {
  manufacturer: 'AkzoNobel Aerospace Coatings',
  partNumber: '55747038B005K',
  sapCode: '5791757',
  color: 'Preto FS 37038 / AIC 53.30',
  packageWeight: '5 kg',
  hardener: 'FR2-55 Hardener',
  thinner: 'Água: 15 a 25 partes por peso',
  mixingRatio: '100 g de FR2-55 Base + 20 g de FR2-55 Hardener + 15 a 25 g de água',
  dryFilmThickness: '40 µm como referência de cobertura do fabricante',
  storage: 'Armazenar entre 5 °C e 35 °C. Não congelar. Validade indicada no rótulo: 12 meses.',
  technicalDataSheetUrl: 'https://aerospace.akzonobel.com/en/products/topcoat-fr2-55',
  notes: 'Acabamento poliuretano flexível de 3 componentes, à base de água, para interiores aeronáuticos. Versão matte 4–6 GU. Cobertura de referência do fabricante: 9 m²/kg para 40 µm de filme seco. Compatível com FR-M1K, FR-Preprime e primers FR-P1K, FR1-55, FR4-45 ou FRS30. A proporção de mistura, o PN, o SAP, a cor e o armazenamento foram conferidos no rótulo da embalagem. Confirmar sempre a revisão vigente da TDS/SDS antes da aplicação.',
  updatedAt: '2026-07-23',
};

function normalizedIdentity(product: Product): string {
  return [
    product.name,
    product.ecode,
    product.docmat,
    product.qrRaw,
    product.notes,
  ]
    .filter(Boolean)
    .join(' ')
    .toLocaleUpperCase('pt-BR');
}

export function getTechnicalSheet(product: Product): TechnicalSheet | undefined {
  if (product.technicalSheet && Object.values(product.technicalSheet).some(Boolean)) {
    return product.technicalSheet;
  }

  const identity = normalizedIdentity(product);

  if (
    product.ecode === '6570961' ||
    identity.includes('55747038B005K') ||
    identity.includes('5791757') ||
    identity.includes('FR2-55 MATT') ||
    identity.includes('FR2 55 MATT')
  ) {
    return FR2_55_MATT_BLACK;
  }

  if (product.ecode === '7863462' || identity.includes('FR2-55 SEMI-GLOSS')) {
    return FR2_55_SEMI_GLOSS;
  }

  return undefined;
}
