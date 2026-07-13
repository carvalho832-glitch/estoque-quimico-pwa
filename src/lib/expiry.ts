import type { ExpiryLevel } from '../types';

export function daysUntilExpiry(value: string): number | null {
  if (!value) return null;
  const date = new Date(`${value}T23:59:59`);
  if (Number.isNaN(date.getTime())) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((date.getTime() - today.getTime()) / 86_400_000);
}

export function getExpiryLevel(value: string): ExpiryLevel {
  const days = daysUntilExpiry(value);
  if (days === null) return 'unknown';
  if (days < 0) return 'expired';
  if (days <= 30) return 'critical';
  if (days <= 90) return 'warning';
  return 'valid';
}

export function getExpiryLabel(value: string): string {
  const days = daysUntilExpiry(value);
  if (days === null) return 'Sem validade';
  if (days < 0) return `Vencido há ${Math.abs(days)} dia(s)`;
  if (days === 0) return 'Vence hoje';
  return `Vence em ${days} dia(s)`;
}

export function formatDate(value: string): string {
  if (!value) return 'Não informada';
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}
