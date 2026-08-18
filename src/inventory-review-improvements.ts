import { listProducts, saveProductsBatch } from './lib/db';
import type { Product } from './types';
import './inventory-review-improvements.css';

const STORAGE_KEY = 'quimstock-temporary-inventory-v1';
const EXPIRY_BOUND_ATTRIBUTE = 'data-quimstock-expiry-improved';
const PRODUCT_BOUND_ATTRIBUTE = 'data-quimstock-product-improved';
let saving = false;

type InventoryRow = {
  productId?: string;
  ecode?: string;
  name?: string;
  batch?: string;
  expiryDate?: string;
  systemQuantity?: number;
  countedQuantity?: number;
  registerProduct?: boolean;
};

type InventorySession = {
  status?: string;
  rows?: InventoryRow[];
};

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

function isPlaceholderProductName(value: string | undefined): boolean {
  const normalized = normalize(value);
  return !normalized || normalized === 'PRODUTO NÃO CADASTRADO' || normalized === 'PRODUTO NAO CADASTRADO';
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

function enhanceProductCells(): void {
  if (!isReviewMode()) return;

  const session = readSession();
  const rows = document.querySelectorAll<HTMLTableRowElement>('.inventory-review-table tbody tr');

  rows.forEach((rowElement) => {
    const identity = rowIdentity(rowElement);
    if (!identity) return;

    const cell = rowElement.querySelector<HTMLTableCellElement>('td[data-label="Produto"]');
    if (!cell || cell.hasAttribute(PRODUCT_BOUND_ATTRIBUTE)) return;

    const sessionRow = findRow(session, identity.ecode, identity.batch);
    if (!sessionRow) return;

    const isUnregistered = rowElement.classList.contains('inventory-unregistered-row');
    const hadPlaceholderName = isPlaceholderProductName(sessionRow.name);

    cell.setAttribute(PRODUCT_BOUND_ATTRIBUTE, 'true');
    cell.textContent = '';

    const wrapper = document.createElement('div');
    wrapper.className = 'inventory-inline-product';
    if (isUnregistered) wrapper.classList.add('unregistered');

    const input = document.createElement('input');
    input.type = 'text';
    input.value = hadPlaceholderName ? '' : (sessionRow.name ?? '');
    input.placeholder = isUnregistered ? 'Nome do produto' : 'Produto';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', `Produto do E-code ${identity.ecode}, lote ${identity.batch}`);

    const hint = document.createElement('small');
    if (isUnregistered) {
      hint.textContent = sessionRow.registerProduct
        ? 'Cadastro preparado ✓'
        : 'Informe o nome para cadastrar';
    } else {
      hint.textContent = 'Toque para editar';
    }

    input.addEventListener('input', () => {
      const latestSession = readSession();
      const latestRow = findRow(latestSession, identity.ecode, identity.batch);
      if (!latestRow) return;

      latestRow.name = input.value.trim();
      writeSession(latestSession);
      wrapper.classList.toggle('missing', !input.value.trim());

      if (isUnregistered) {
        setText(hint, latestRow.registerProduct ? 'Cadastro preparado ✓' : 'Informe o nome para cadastrar');
      } else {
        setText(hint, input.value.trim() ? 'Nome será atualizado ✓' : 'Informe o nome do produto');
      }
      updateReviewNotice();
    });

    wrapper.append(input, hint);

    if (isUnregistered && hadPlaceholderName) {
      const registerButton = document.createElement('button');
      registerButton.type = 'button';
      registerButton.className = 'inventory-inline-register-product';
      registerButton.textContent = sessionRow.registerProduct ? 'Cadastro preparado ✓' : 'Cadastrar produto';
      registerButton.disabled = Boolean(sessionRow.registerProduct);

      registerButton.addEventListener('click', () => {
        const name = input.value.trim();
        if (!name) {
          wrapper.classList.add('missing');
          setMessage(`Informe o nome do produto do E-code ${identity.ecode} antes de preparar o cadastro.`);
          input.focus();
          return;
        }

        const latestSession = readSession();
        const latestRow = findRow(latestSession, identity.ecode, identity.batch);
        if (!latestRow) return;

        latestRow.name = name;
        latestRow.registerProduct = true;
        writeSession(latestSession);
        wrapper.classList.remove('missing');
        registerButton.textContent = 'Cadastro preparado ✓';
        registerButton.disabled = true;
        setText(hint, 'Será gravado ao atualizar estoque');
        setMessage(`Produto “${name}” preparado para cadastro. Nada foi alterado no estoque oficial ainda.`);
        updateReviewNotice();
      });

      wrapper.append(registerButton);
    } else if (isUnregistered) {
      const badge = document.createElement('span');
      badge.className = 'inventory-inline-new-lot';
      badge.textContent = 'Novo lote';
      wrapper.append(badge);
    }

    if (!input.value.trim()) wrapper.classList.add('missing');
    cell.append(wrapper);
  });
}

function enhanceValidityCells(): void {
  if (!isReviewMode()) return;

  const session = readSession();
  const rows = document.querySelectorAll<HTMLTableRowElement>('.inventory-review-table tbody tr');

  rows.forEach((rowElement) => {
    const identity = rowIdentity(rowElement);
    if (!identity) return;

    const cell = rowElement.querySelector<HTMLTableCellElement>('td[data-label="Validade"]');
    if (!cell || cell.hasAttribute(EXPIRY_BOUND_ATTRIBUTE)) return;

    const sessionRow = findRow(session, identity.ecode, identity.batch);
    if (!sessionRow) return;

    cell.setAttribute(EXPIRY_BOUND_ATTRIBUTE, 'true');
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
  const unnamedProducts = rows.filter((row) => isPlaceholderProductName(row.name)).length;
  const unregisteredVisible = document.querySelectorAll('.inventory-unregistered-row').length;

  const notice = document.querySelector<HTMLElement>('.inventory-phase-notice');
  if (notice) {
    const title = notice.querySelector('strong');
    const copy = notice.querySelector('span');

    if (unnamedProducts > 0) {
      notice.classList.add('inventory-phase-warning');
      setText(title, `${unnamedProducts} produto(s) precisam de identificação`);
      setText(copy, 'Edite o nome diretamente na coluna Produto e use “Cadastrar produto” quando o material ainda não existir no QuimStock.');
    } else if (missingExpiry > 0) {
      notice.classList.add('inventory-phase-warning');
      setText(title, `${missingExpiry} validade(s) precisam ser informadas`);
      setText(copy, 'Preencha a data diretamente na coluna Validade antes de atualizar o estoque.');
    } else if (unregisteredVisible > 0) {
      notice.classList.add('inventory-phase-warning');
      setText(title, `${unregisteredVisible} lote(s) novo(s) prontos para cadastro`);
      setText(copy, 'Os novos produtos/lotes preparados serão cadastrados somente quando você tocar em Atualizar estoque.');
    } else {
      notice.classList.remove('inventory-phase-warning');
      setText(title, 'Lista pronta para atualização');
      setText(copy, 'Nomes, quantidades e validades desta lista serão gravados ao confirmar.');
    }
  }

  const updateButton = document.querySelector<HTMLButtonElement>('.inventory-update-action');
  if (updateButton && !saving) {
    if (updateButton.disabled) updateButton.disabled = false;
    let title = 'Atualizar nomes, quantidades, validades e novos cadastros';
    if (unnamedProducts) title = 'Toque para localizar os produtos que ainda precisam de nome';
    else if (missingExpiry) title = 'Toque para localizar as validades que ainda precisam ser preenchidas';
    if (updateButton.title !== title) updateButton.title = title;
  }
}

function buildUpdatedProducts(
  rows: InventoryRow[],
  products: Product[],
): { productsToSave: Product[]; newLots: number; newProducts: number; unknownRows: InventoryRow[] } {
  const now = new Date().toISOString();
  const productsToSave: Product[] = [];
  const unknownRows: InventoryRow[] = [];
  let newLots = 0;
  let newProducts = 0;

  rows.forEach((row) => {
    const ecode = normalize(row.ecode);
    const batch = normalize(row.batch);
    const countedQuantity = Math.max(0, Number(row.countedQuantity) || 0);
    const expiryDate = row.expiryDate ?? '';
    const editedName = row.name?.trim() ?? '';
    const exact = products.find(
      (product) => normalize(product.ecode) === ecode && normalize(product.batch) === batch,
    );

    if (exact) {
      productsToSave.push({
        ...exact,
        name: editedName || exact.name,
        quantity: countedQuantity,
        expiryDate,
        updatedAt: now,
      });
      return;
    }

    const template = products.find((product) => normalize(product.ecode) === ecode);
    if (template) {
      productsToSave.push({
        id: createId(),
        name: editedName || template.name,
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
      return;
    }

    if (row.registerProduct && editedName && !isPlaceholderProductName(editedName)) {
      productsToSave.push({
        id: createId(),
        name: editedName,
        ecode,
        batch,
        expiryDate,
        quantity: countedQuantity,
        location: '',
        notes: 'Cadastrado durante a conferência de inventário.',
        availabilityStatus: 'stock',
        createdAt: now,
        updatedAt: now,
      });
      newProducts += 1;
      return;
    }

    unknownRows.push(row);
  });

  return { productsToSave, newLots, newProducts, unknownRows };
}

async function handleEnhancedUpdate(button: HTMLButtonElement): Promise<void> {
  if (saving) return;

  const session = readSession();
  const rows = Array.isArray(session.rows) ? session.rows : [];
  if (session.status !== 'review' || !rows.length) {
    setMessage('Finalize a leitura antes de atualizar o estoque.');
    return;
  }

  const unnamedRows = rows.filter((row) => isPlaceholderProductName(row.name));
  if (unnamedRows.length) {
    setMessage(`Falta identificar ${unnamedRows.length} produto(s). Digite o nome diretamente na coluna Produto.`);
    const firstMissing = document.querySelector<HTMLInputElement>('.inventory-inline-product.missing input');
    firstMissing?.focus();
    firstMissing?.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
    setMessage(`Ainda existem ${prepared.unknownRows.length} produto(s) não cadastrado(s). Use “Cadastrar produto” na coluna Produto para prepará-los antes de atualizar.`);
    const firstRegister = document.querySelector<HTMLButtonElement>('.inventory-inline-register-product:not(:disabled)');
    firstRegister?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const existingCount = prepared.productsToSave.length - prepared.newLots - prepared.newProducts;
  const parts = [`${existingCount} lote(s) existente(s)`];
  if (prepared.newLots) parts.push(`${prepared.newLots} lote(s) novo(s)`);
  if (prepared.newProducts) parts.push(`${prepared.newProducts} produto(s) novo(s)`);

  const confirmation = `Atualizar ${parts.join(', ')} com os nomes, quantidades e validades conferidos?`;
  if (!window.confirm(confirmation)) return;

  saving = true;
  button.disabled = true;
  const previousLabel = button.textContent ?? 'Atualizar estoque';
  button.textContent = 'Atualizando...';
  setMessage('Gravando produtos, quantidades, validades e novos cadastros...');

  try {
    const result = await saveProductsBatch(prepared.productsToSave);
    window.localStorage.removeItem(STORAGE_KEY);

    if (result.syncState === 'synced') {
      const extras = [
        prepared.newLots ? `${prepared.newLots} lote(s) novo(s)` : '',
        prepared.newProducts ? `${prepared.newProducts} produto(s) novo(s)` : '',
      ].filter(Boolean).join(' e ');
      setMessage(`${result.saved} item(ns) atualizado(s) e sincronizado(s) com sucesso${extras ? `, incluindo ${extras}` : ''}.`);
    } else if (result.syncState === 'pending') {
      setMessage(`${result.saved} item(ns) salvo(s) neste aparelho. A sincronização com a nuvem ficou pendente e será retomada automaticamente.`);
    } else {
      setMessage(`${result.saved} item(ns) atualizado(s) no banco local com sucesso.`);
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
  enhanceProductCells();
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
