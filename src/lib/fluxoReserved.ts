export const FLUXO_RESERVED_PREFIX = '__fluxo_backup_';

export function isFluxoReservedDocument(id: string): boolean {
  return id.startsWith(FLUXO_RESERVED_PREFIX);
}
