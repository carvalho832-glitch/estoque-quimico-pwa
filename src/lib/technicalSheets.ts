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
  flashOff: '1 hora em temperatura ambiente antes da cura forçada a 60 °C',
  dryFilmThickness: '40 µm como referência de cobertura do fabricante',
  dustFree23C: '45 a 60 minutos',
  handling23C: '5 horas',
  recoat23C: '8 a 12 horas',
  fullCure23C: '168 horas (7 dias)',
  handling40C: '3 horas',
  fullCure40C: '72 horas (3 dias)',
  handling60C: '1 hora',
  recoat60C: '1 a 4 horas',
  fullCure60C: '12 horas',
  storage: 'Armazenar entre 5 °C e 35 °C. Não congelar. Validade indicada no rótulo: 12 meses.',
  technicalDataSheetUrl: 'https://aerospace.akzonobel.com/en/products/topcoat-fr2-55',
  notes: 'Acabamento poliuretano flexível de 3 componentes, à base de água, para interiores aeronáuticos. Versão matte 4–6 GU. Cobertura de referência do fabricante: 9 m²/kg para 40 µm de filme seco. Os tempos podem variar conforme espessura aplicada, temperatura, umidade e ventilação. Confirmar sempre a revisão vigente da TDS/SDS antes da aplicação e da liberação da peça.',
  updatedAt: '2026-07-23',
};

const VARNISH_1500_FR_GLOSS: TechnicalSheet = {
  manufacturer: 'AkzoNobel Aerospace Coatings',
  partNumber: '12150700B001L',
  sapCode: '5787525',
  color: 'Transparente / Gloss',
  packageWeight: '1 L',
  hardener: '1500-FR Hardener',
  thinner: 'FRSL Thinner',
  mixingRatio: 'Por peso: 100 partes de base + 50 partes de endurecedor + 0 a 50 partes de thinner. Por volume: 2 partes de base + 1 parte de endurecedor + 0 a 1 parte de thinner.',
  potLife: '3 horas',
  coats: '2 demãos cruzadas',
  flashOff: '30 minutos entre as demãos, até a evaporação do solvente',
  wetFilmThickness: '90 a 130 µm',
  dryFilmThickness: '40 a 60 µm',
  dustFree23C: '1 hora',
  handling23C: '6 horas (seco para mascaramento / dry to tape)',
  fullCure23C: '168 horas (7 dias)',
  handling60C: '2 horas (seco para mascaramento / dry to tape)',
  fullCure60C: '12 horas',
  applicationTemperature: '15 °C a 35 °C',
  maxHumidity: '30% a 75% de umidade relativa',
  storage: 'Armazenar entre 5 °C e 35 °C, na embalagem original cheia e lacrada. Validade: 48 meses para base gloss e thinner; 12 meses para hardener.',
  technicalDataSheetUrl: 'https://msp.images.akzonobel.com/prd/dh/glbars/documents/varnish_1500-fr_tds.pdf',
  notes: 'Verniz poliuretano transparente de 3 componentes, alto sólidos e base solvente, desenvolvido para proteger interiores de cabine. Aplicar sobre FRS40 levemente lixado com abrasivo P400. Cobertura teórica: 9 m²/L para 50 µm de filme seco. Os tempos de secagem foram determinados em corpos de prova com espessura inferior a 2 mm e filme seco de 50 µm. Ficha técnica oficial AkzoNobel/Mapaero TDS nº 10, edição 04/2022, vinculada ao documento oficial na nuvem do fabricante.',
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
    product.ecode === '8679400' ||
    identity.includes('12150700B001L') ||
    identity.includes('5787525') ||
    identity.includes('1500-FR GLOSS') ||
    identity.includes('1500 FR GLOSS') ||
    identity.includes('VARNISH 1500-FR')
  ) {
    return VARNISH_1500_FR_GLOSS;
  }

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
