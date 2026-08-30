import { listProducts } from './lib/db';
import { formatDate, getExpiryLabel, getExpiryLevel } from './lib/expiry';
import type { Product } from './types';
import './shelves-browser.css';

type View = 'shelves' | 'products' | 'details';
const collator = new Intl.Collator('pt-BR', { numeric: true, sensitivity: 'base' });
let closeActive: (() => void) | null = null;

const clean = (value: string) => value.trim().replace(/\s+/g, ' ');
const keyOf = (value: string) => clean(value).toLocaleLowerCase('pt-BR');

function dateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, text = '', className = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

function detailRow(list: HTMLElement, label: string, value?: string | number): void {
  if (value === undefined || value === null || String(value).trim() === '') return;
  const row = el('div', '', 'shelves-detail-row');
  row.append(el('dt', label), el('dd', String(value)));
  list.append(row);
}

function productDetails(product: Product): HTMLElement {
  const wrap = el('div', '', 'shelves-details');
  const identity = el('section', '', 'shelves-details-head');
  identity.append(el('span', 'PRODUTO', 'shelves-kicker'), el('h3', product.name));

  const badges = el('div', '', 'shelves-detail-badges');
  const inUse = product.availabilityStatus === 'in-use' && Boolean(product.currentUsage);
  const availability = el('span', inUse ? 'Em uso' : 'Estoque', `shelves-badge ${inUse ? 'in-use' : 'stock'}`);
  const expiryLevel = getExpiryLevel(product.expiryDate);
  const expiry = el('span', getExpiryLabel(product.expiryDate), `shelves-badge expiry-${expiryLevel}`);
  badges.append(availability, expiry);
  identity.append(badges);

  const data = el('dl', '', 'shelves-detail-grid');
  detailRow(data, 'E-code', product.ecode);
  detailRow(data, 'Lote', product.batch);
  detailRow(data, 'Quantidade', product.quantity);
  detailRow(data, 'Validade', formatDate(product.expiryDate));
  detailRow(data, 'Localização / Prateleira', clean(product.location || '') || 'Não informado');
  detailRow(data, 'Docmat', product.docmat);
  detailRow(data, 'Lote do fornecedor', product.supplierBatch);
  detailRow(data, 'Volume da embalagem', product.packageVolume);
  detailRow(data, 'Limite de estoque baixo', product.lowStockThreshold);
  wrap.append(identity, data);

  if (product.currentUsage) {
    const section = el('section', '', 'shelves-detail-section');
    section.append(el('h4', 'Uso atual'));
    const usage = el('dl', '', 'shelves-detail-grid');
    detailRow(usage, 'Ordem de manutenção', product.currentUsage.workOrder);
    detailRow(usage, 'Aeronave', product.currentUsage.aircraft);
    detailRow(usage, 'Operador', product.currentUsage.operator);
    detailRow(usage, 'Retirado em', dateTime(product.currentUsage.startedAt));
    section.append(usage);
    wrap.append(section);
  }

  if (product.technicalSheet) {
    const sheet = product.technicalSheet;
    const dataSheet = el('dl', '', 'shelves-detail-grid');
    detailRow(dataSheet, 'Fabricante', sheet.manufacturer);
    detailRow(dataSheet, 'Part number', sheet.partNumber);
    detailRow(dataSheet, 'Código SAP', sheet.sapCode);
    detailRow(dataSheet, 'Cor', sheet.color);
    detailRow(dataSheet, 'Armazenamento', sheet.storage);
    if (dataSheet.childElementCount) {
      const section = el('section', '', 'shelves-detail-section');
      section.append(el('h4', 'Ficha técnica'), dataSheet);
      wrap.append(section);
    }
  }

  if ((product.notes || '').trim()) {
    const section = el('section', '', 'shelves-detail-section');
    section.append(el('h4', 'Observações'), el('p', product.notes, 'shelves-detail-notes'));
    wrap.append(section);
  }

  const meta = el('div', '', 'shelves-detail-meta');
  meta.append(el('span', `Cadastrado em ${dateTime(product.createdAt)}`), el('span', `Atualizado em ${dateTime(product.updatedAt)}`));
  wrap.append(meta);
  return wrap;
}

async function openShelves(opener: HTMLButtonElement): Promise<void> {
  closeActive?.();
  let products: Product[] = [];
  let view: View = 'shelves';
  let shelfKey = '';
  let productId = '';
  let closed = false;

  const backdrop = el('div', '', 'shelves-backdrop');
  const modal = el('section', '', 'shelves-modal');
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'shelves-title');

  const header = el('header', '', 'shelves-header');
  const back = el('button', '‹', 'shelves-back is-hidden');
  back.type = 'button';
  back.setAttribute('aria-label', 'Voltar');
  back.tabIndex = -1;
  const heading = el('div', '', 'shelves-heading');
  const kicker = el('span', 'CONSULTA RÁPIDA', 'shelves-kicker');
  const title = el('h2', 'Prateleiras');
  title.id = 'shelves-title';
  heading.append(kicker, title);
  const close = el('button', '×', 'shelves-close');
  close.type = 'button';
  close.setAttribute('aria-label', 'Fechar prateleiras');
  header.append(back, heading, close);
  const body = el('div', '', 'shelves-body');
  modal.append(header, body);
  backdrop.append(modal);

  const oldOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  document.body.append(backdrop);

  const shelves = () => {
    const values = new Map<string, string>();
    products.forEach((product) => {
      const label = clean(product.location || '');
      if (label && !values.has(keyOf(label))) values.set(keyOf(label), label);
    });
    return [...values.entries()].sort((a, b) => collator.compare(a[1], b[1]));
  };
  const shelfLabel = () => shelves().find(([key]) => key === shelfKey)?.[1];
  const shelfProducts = () => products
    .filter((product) => keyOf(product.location || '') === shelfKey)
    .sort((a, b) => collator.compare(a.name, b.name));

  function setBack(visible: boolean, label = 'Voltar'): void {
    back.classList.toggle('is-hidden', !visible);
    back.tabIndex = visible ? 0 : -1;
    back.setAttribute('aria-label', label);
  }

  function render(): void {
    body.replaceChildren();
    if (view === 'shelves') {
      title.textContent = 'Prateleiras';
      kicker.textContent = 'CONSULTA RÁPIDA';
      setBack(false);
      const locations = shelves();
      if (!locations.length) {
        const empty = el('div', '', 'shelves-empty');
        empty.append(el('span', '📦', 'shelves-empty-icon'), el('strong', 'Nenhuma prateleira encontrada'), el('p', 'Nenhuma prateleira encontrada nos produtos cadastrados.'));
        body.append(empty);
        return;
      }
      const list = el('div', '', 'shelves-list');
      locations.forEach(([key, label]) => {
        const button = el('button', label, 'shelves-list-button');
        button.type = 'button';
        button.addEventListener('click', () => { shelfKey = key; productId = ''; view = 'products'; render(); });
        list.append(button);
      });
      body.append(list);
      return;
    }

    const label = shelfLabel();
    if (!label) { shelfKey = ''; productId = ''; view = 'shelves'; render(); return; }

    if (view === 'products') {
      title.textContent = label;
      kicker.textContent = 'PRATELEIRA';
      setBack(true, 'Voltar para a lista de prateleiras');
      const list = el('div', '', 'shelves-list');
      shelfProducts().forEach((product) => {
        const button = el('button', product.name, 'shelves-product-button');
        button.type = 'button';
        button.addEventListener('click', () => { productId = product.id; view = 'details'; render(); });
        list.append(button);
      });
      body.append(list);
      return;
    }

    const product = shelfProducts().find((item) => item.id === productId);
    if (!product) { productId = ''; view = 'products'; render(); return; }
    title.textContent = product.name;
    kicker.textContent = label.toLocaleUpperCase('pt-BR');
    setBack(true, `Voltar para os produtos de ${label}`);
    body.append(productDetails(product));
  }

  function goBack(): void {
    if (view === 'details') { productId = ''; view = 'products'; }
    else if (view === 'products') { shelfKey = ''; view = 'shelves'; }
    else { closeModal(); return; }
    render();
  }

  function closeModal(): void {
    if (closed) return;
    closed = true;
    backdrop.remove();
    document.body.style.overflow = oldOverflow;
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('quimstock:products-changed', onProductsChanged);
    closeActive = null;
    if (document.contains(opener)) opener.focus();
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    if (view === 'shelves') closeModal(); else goBack();
  }

  async function refresh(): Promise<void> {
    try {
      products = await listProducts();
      if (!closed) render();
    } catch {
      if (closed) return;
      title.textContent = 'Prateleiras';
      kicker.textContent = 'CONSULTA RÁPIDA';
      setBack(false);
      const error = el('div', '', 'shelves-empty error');
      error.append(el('strong', 'Não foi possível carregar as prateleiras.'), el('p', 'Feche esta janela e tente novamente.'));
      body.replaceChildren(error);
    }
  }

  const onProductsChanged = () => { void refresh(); };
  closeActive = closeModal;
  back.addEventListener('click', goBack);
  close.addEventListener('click', closeModal);
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) closeModal(); });
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('quimstock:products-changed', onProductsChanged);
  close.focus();
  await refresh();
}

function launchCard(): HTMLButtonElement {
  const button = el('button', '', 'shelves-launch-card');
  button.type = 'button';
  button.setAttribute('aria-haspopup', 'dialog');
  button.setAttribute('aria-label', 'Abrir consulta por prateleiras');
  const text = el('span', '', 'shelves-launch-text');
  text.append(el('strong', 'Prateleiras'), el('small', 'Consultar produtos por local de armazenamento'));
  button.append(el('span', '📦', 'shelves-launch-icon'), text, el('span', '›', 'shelves-launch-arrow'));
  button.addEventListener('click', () => void openShelves(button));
  return button;
}

function ensureCard(): void {
  const stats = document.querySelector<HTMLElement>('.stats-grid');
  if (!stats) return;
  const card = document.querySelector<HTMLButtonElement>('.shelves-launch-card') ?? launchCard();
  if (card.previousElementSibling !== stats) stats.insertAdjacentElement('afterend', card);
}

function start(): void {
  ensureCard();
  new MutationObserver(ensureCard).observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
