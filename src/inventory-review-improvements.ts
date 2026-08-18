import { listProducts, saveProductsBatch } from './lib/db';
import type { Product } from './types';
import './inventory-review-improvements.css';

const STORAGE_KEY = 'quimstock-temporary-inventory-v1';
const BOUND_ATTRIBUTE = 'data-quimstock-review-improved';
let saving = false;

type InventoryRow = {
  productId?: string;
  ecode?: string;
  name?: string;
  batch?: string;
  expiryDate?: string;
  systemQuantity?: number;
  countedQuantity?: number;
};

type InventorySession = {
  status?: string;
  rows?: InventoryRow[];
};

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

function createId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readSession(): InventorySession {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as InventorySession : {};
  } catch {
    return {};
  }
}

function writeSession(session: InventorySession): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function findRow(session: InventorySession, ecode: string, batch: string): InventoryRow | undefined {
  return session.rows?.find((row) => normalize(row.ecode) === normalize(ecode) && normalize(row.batch) === normalize(batch));
}

function setText(element: Element | null, text: string): void {
  if (element && element.textContent !== text) element.textContent = text;
}

function setMessage(text: string): void {
  const windowPanel = document.querySelector<HTMLElement>('.inventory-window');
  if (!windowPanel) return;

  let message = windowPanel.querySelector<HTMLParagraphElement>('.inventory-window-message');
  if (!message) {
    message = document.createElement('p');
    message.className = 'inventory-window-message';
    message.setAttribute('role', 'status');
    windowPanel.querySelector('.inventory-window-actions')?.insertAdjacentElement('beforebegin', message);
  }

  setText(message, text);
  message.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function rowIdentity(rowElement: HTMLTableRowElement): { ecode: string; batch: string } | null {
  const ecode = rowElement.querySelector<HTMLElement>('td[data-label="E-code"]')?.textContent?.trim() ?? '';
  const batch = rowElement.querySelector<HTMLElement>('td[data-label="Lote"]')?.textContent?.trim() ?? '';
  return ecode && batch ? { ecode, batch } : null;
}

function isReviewMode(): boolean {
  const secondary = Array.from(document.querySelectorAll<HTMLElement>('.inventory-window-actions .inventory-secondary-action'));
  return secondary.some((button) => /continuar leitura/i.test(button.textContent ?? ''));
}

function enhanceValidityCells(): void {
  if (!isReviewMode()) return;

  const session = readSession();
  const rows = document.querySelectorAll<HTMLTableRowElement>('.inventory-review-table tbody tr');

  rows.forEach((rowElement) => {
    const identity = rowIdentity(rowElement);
    if (!identity) return;

    const cell = rowElement.querySelector<HTMLTableCellElement>('td[data-label="Validade"]');
    if (!cell || cell.hasAttribute(BOUND_ATTRIBUTE)) return;

    const sessionRow = findRow(session, identity.ecode, identity.batch);
    if (!sessionRow) return;

    cell.setAttribute(BOUND_ATTRIBUTE, 'true');
    cell.textContent = '';

    const wrapper = document.createElement('label');
    wrapper.className = 'inventory-inline-expiry';

    const input = document.createElement('input');
    input.type = 'date';
    input.value = sessionRow.expiryDate ?? '';
    input.setAttribute('aria-label', `Validade do E-code ${identity.ecode}, lote ${identity.batch}`);

    const hint = document.createElement('small');
    hint.textContent = input.value ? 'Toque para alterar' : 'Informe a validade';
    if (!input.value) wrapper.classList.add('missing');

    input.addEventListener('change', () => {
      const latestSession = readSession();
      const latestRow = findRow(latestSession, identity.ecode, identity.batch);
      if (!latestRow) return;

      latestRow.expiryDate = input.value;
      writeSession(latestSession);
      wrapper.classList.toggle('missing', !input.value);
      setText(hint, input.value ? 'Validade preenchida ✓' : 'Informe a validade');
      updateReviewNotice();
    });

    wrapper.append(input, hint);
    cell.append(wrapper);
  });
}

function updateReviewNotice(): void {
  if (!isReviewMode()) return;

  const session = readSession();
  const rows = session.rows ?? [];
  const missingExpiry = rows.filter((row) => !row.expiryDate).length;
  const unregisteredVisible = document.querySelectorAll('.inventory-unregistered-row').length;

  const notice = document.querySelector<HTMLElement>('.inventory-phase-notice');
  if (notice) {
    const title = notice.querySelector('strong');
    const copy = notice.querySelector('span');

    if (missingExpiry > 0) {
      notice.classList.add('inventory-phase-warning');
      setText(title, `${missingExpiry} validade(s) precisam ser informadas`);
      setText(copy, 'Preencha a data diretamente na coluna Validade. Lotes novos de um E-code já conhecido serão cadastrados ao atualizar.');
    } else if (unregisteredVisible > 0) {
      notice.classList.add('inventory-phase-warning');
      setText(title, `${unregisteredVisible} lote(s) novo(s) prontos para cadastro`);
      setText(copy, 'Ao atualizar, o QuimStock cadastrará automaticamente os novos lotes de materiais já conhecidos e aplicará a contagem.');
    } else {
      notice.classList.remove('inventory-phase-warning');
      setText(title, 'Lista pronta para atualização');
      setText(copy, 'Somente os lotes desta lista terão as quantidades e validades atualizadas.');
    }
  }

  const updateButton = document.querySelector<HTMLButtonElement>('.inventory-update-action');
  if (updateButton && !saving) {
    if (updateButton.disabled) updateButton.disabled = false;
    const title = missingExpiry
      ? 'Toque para ver quais validades ainda precisam ser preenchidas'
      : 'Atualizar quantidades, validades e cadastrar novos lotes conhecidos';
    if (updateButton.title !== title) updateButton.title = title;
  }
}

function buildUpdatedProducts(
  rows: InventoryRow[],
  products: Product[],
): { productsToSave: Product[]; newLots: number; unknownRows: InventoryRow[] } {
  const now = new Date().toISOString();
  const productsToSave: Product[] = [];
  const unknownRows: InventoryRow[] = [];
  let newLots = 0;

  rows.forEach((row) => {
    const ecode = normalize(row.ecode);
    const batch = normalize(row.batch);
    const countedQuantity = Math.max(0, Number(row.countedQuantity) || 0);
    const expiryDate = row.expiryDate ?? '';
    const exact = products.find(
      (product) => normalize(product.ecode) === ecode && normalize(product.batch) === batch,
    );

    if (exact) {
      productsToSave.push({
        ...exact,
        quantity: countedQuantity,
        expiryDate,
        updatedAt: now,
      });
      return;
    }

    const template = products.find((product) => normalize(product.ecode) === ecode);
    if (!template) {
      unknownRows.push(row);
      return;
    }

    productsToSave.push({
      id: createId(),
      name: template.name,
      ecode,
      docmat: template.docmat,
      batch,
      expiryDate,
      quantity: countedQuantity,
      lowStockThreshold: template.lowStockThreshold,
      location: template.location ?? '',
      notes: '',
      technicalSheet: template.technicalSheet,
      availabilityStatus: 'stock',
      createdAt: now,
      updatedAt: now,
    });
    newLots += 1;
  });

  return { productsToSave, newLots, unknownRows };
}

async function handleEnhancedUpdate(button: HTMLButtonElement): Promise<void> {
  if (saving) return;

  const session = readSession();
  const rows = Array.isArray(session.rows) ? session.rows : [];
  if (session.status !== 'review' || !rows.length) {
    setMessage('Finalize a leitura antes de atualizar o estoque.');
    return;
  }

  const missingExpiryRows = rows.filter((row) => !row.expiryDate);
  if (missingExpiryRows.length) {
    setMessage(`Falta informar a validade de ${missingExpiryRows.length} lote(s). Preencha a data diretamente na coluna Validade.`);
    const firstMissing = document.querySelector<HTMLInputElement>('.inventory-inline-expiry.missing input');
    firstMissing?.focus();
    firstMissing?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const products = await listProducts();
  const prepared = buildUpdatedProducts(rows, products);
  if (prepared.unknownRows.length) {
    const codes = [...new Set(prepared.unknownRows.map((row) => normalize(row.ecode)).filter(Boolean))];
    setMessage(`Ainda existem ${prepared.unknownRows.length} lote(s) de E-code totalmente novo (${codes.join(', ')}). Cadastre esses materiais uma vez no QuimStock; depois os próximos lotes poderão ser criados pelo inventário.`);
    return;
  }

  const existingCount = prepared.productsToSave.length - prepared.newLots;
  const confirmation = prepared.newLots
    ? `Atualizar ${existingCount} lote(s) existente(s) e cadastrar ${prepared.newLots} lote(s) novo(s) com as quantidades e validades conferidas?`
    : `Atualizar ${existingCount} lote(s) com as quantidades e validades conferidas?`;

  if (!window.confirm(confirmation)) return;

  saving = true;
  button.disabled = true;
  const previousLabel = button.textContent ?? 'Atualizar estoque';
  button.textContent = 'Atualizando...';
  setMessage('Gravando quantidades, validades e novos lotes...');

  try {
    const result = await saveProductsBatch(prepared.productsToSave);
    window.localStorage.removeItem(STORAGE_KEY);

    if (result.syncState === 'synced') {
      setMessage(`${result.saved} lote(s) atualizado(s) e sincronizado(s) com sucesso${prepared.newLots ? `, incluindo ${prepared.newLots} novo(s)` : ''}.`);
    } else if (result.syncState === 'pending') {
      setMessage(`${result.saved} lote(s) salvo(s) neste aparelho. A sincronização com a nuvem ficou pendente e será retomada automaticamente.`);
    } else {
      setMessage(`${result.saved} lote(s) atualizado(s) no banco local com sucesso.`);
    }

    window.dispatchEvent(new CustomEvent('quimstock:products-changed'));
    window.setTimeout(() => window.location.reload(), 1200);
  } catch (error) {
    console.error(error);
    setMessage(error instanceof Error ? error.message : 'Não foi possível atualizar o estoque.');
    saving = false;
    button.disabled = false;
    button.textContent = previousLabel;
  }
}

function enhanceReview(): void {
  enhanceValidityCells();
  updateReviewNotice();
}

const observer = new MutationObserver(enhanceReview);
observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

document.addEventListener('click', (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;

  const button = target.closest<HTMLButtonElement>('.inventory-update-action');
  if (!button || !isReviewMode()) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();
  void handleEnhancedUpdate(button);
}, true);

enhanceReview();
