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

export function getTechnicalSheet(product: Product): TechnicalSheet | undefined {
  if (product.technicalSheet && Object.values(product.technicalSheet).some(Boolean)) {
    return product.technicalSheet;
  }

  const normalizedName = product.name.toLocaleUpperCase('pt-BR');
  if (product.ecode === '7863462' || normalizedName.includes('FR2-55 SEMI-GLOSS')) {
    return FR2_55_SEMI_GLOSS;
  }

  return undefined;
}