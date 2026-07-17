import { listProducts } from './lib/db';
import type { Product } from './types';
import './in-use-alert.css';

let closeCurrentModal: (() => void) | null = null;

function isInUse(product: Product): boolean {
  return product.availabilityStatus === 'in-use' && Boolean(product.currentUsage);
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Data não disponível';
  return date.toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function textElement<K extends keyof HTMLElementTagNameMap>(tag: K, text: string, className?: string): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function createUsageItem(product: Product): HTMLElement {
  const usage = product.currentUsage;
  const card = document.createElement('article');
  card.className = 'in-use-item-card';

  const topLine = document.createElement('div');
  topLine.className = 'in-use-item-topline';
  const identity = document.createElement('div');
  identity.append(textElement('strong', product.name), textElement('span', `Ecode ${product.ecode} · Lote ${product.batch}`));
  topLine.append(identity, textElement('span', 'Em uso', 'in-use-item-status'));

  const data = document.createElement('dl');
  data.className = 'in-use-item-data';
  const fields = [
    ['OM', usage?.workOrder || 'Não informada'],
    ['Avião', usage?.aircraft || 'Não informado'],
    ['Operador', usage?.operator || 'Não informado'],
    ['Retirada', usage?.startedAt ? formatDateTime(usage.startedAt) : 'Não disponível'],
    ['Quantidade', String(product.quantity)],
    ['Local de origem', product.location || 'Não informado'],
  ];
  fields.forEach(([label, value]) => {
    const field = document.createElement('div');
    field.append(textElement('dt', label), textElement('dd', value));
    data.append(field);
  });

  card.append(topLine, data);
  return card;
}

async function openInUseModal(): Promise<void> {
  if (document.querySelector('.in-use-items-backdrop')) return;

  const products = (await listProducts()).filter(isInUse).sort((a, b) => {
    const aTime = new Date(a.currentUsage?.startedAt || 0).getTime();
    const bTime = new Date(b.currentUsage?.startedAt || 0).getTime();
    return bTime - aTime;
  });

  const backdrop = document.createElement('div');
  backdrop.className = 'in-use-items-backdrop';
  backdrop.setAttribute('role', 'presentation');

  const modal = document.createElement('section');
  modal.className = 'in-use-items-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'in-use-items-title');

  const header = document.createElement('header');
  header.className = 'in-use-items-header';
  const headerText = document.createElement('div');
  headerText.append(textElement('span', 'MOVIMENTAÇÃO DO ESTOQUE'), textElement('h2', 'Materiais em uso'), textElement('p', `${products.length} material(is) fora do estoque.`));
  headerText.querySelector('h2')?.setAttribute('id', 'in-use-items-title');

  const topCloseButton = textElement('button', '×', 'in-use-items-close');
  topCloseButton.setAttribute('type', 'button');
  topCloseButton.setAttribute('aria-label', 'Fechar materiais em uso');
  header.append(headerText, topCloseButton);

  const list = document.createElement('div');
  list.className = 'in-use-items-list';
  if (products.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'in-use-items-empty';
    empty.append(textElement('strong', 'Nenhum material está em uso agora.'), textElement('span', 'Todos os produtos estão disponíveis no estoque.'));
    list.append(empty);
  } else {
    products.forEach((product) => list.append(createUsageItem(product)));
  }

  const footer = document.createElement('footer');
  footer.className = 'in-use-items-footer';
  const closeButton = textElement('button', 'Fechar');
  closeButton.setAttribute('type', 'button');
  footer.append(closeButton);
  modal.append(header, list, footer);
  backdrop.append(modal);

  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  const close = () => {
    backdrop.remove();
    document.body.style.overflow = previousOverflow;
    window.removeEventListener('keydown', handleKeyDown);
    closeCurrentModal = null;
  };
  const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };

  closeCurrentModal?.();
  closeCurrentModal = close;
  topCloseButton.addEventListener('click', close);
  closeButton.addEventListener('click', close);
  backdrop.addEventListener('mousedown', (event) => { if (event.target === backdrop) close(); });
  window.addEventListener('keydown', handleKeyDown);
  document.body.append(backdrop);
  topCloseButton.focus();
}

function activateInUseCard(card: HTMLElement): void {
  if (card.dataset.inUseInteractive === 'true') return;
  card.dataset.inUseInteractive = 'true';
  card.addEventListener('click', () => {
    const count = Number.parseInt(card.querySelector('strong')?.textContent ?? '0', 10) || 0;
    if (count > 0) void openInUseModal();
  });
  card.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const count = Number.parseInt(card.querySelector('strong')?.textContent ?? '0', 10) || 0;
    if (count <= 0) return;
    event.preventDefault();
    void openInUseModal();
  });
}

function updateInUseCard(): void {
  const card = document.querySelector<HTMLElement>('.stats-grid article:nth-child(3)');
  if (!card) return;
  const count = Number.parseInt(card.querySelector('strong')?.textContent ?? '0', 10) || 0;
  const active = count > 0;

  card.classList.toggle('in-use-card-active', active);
  card.classList.toggle('in-use-card-clickable', active);
  card.classList.toggle('in-use-card-disabled', !active);
  card.setAttribute('role', 'button');
  card.setAttribute('tabindex', active ? '0' : '-1');
  card.setAttribute('aria-disabled', active ? 'false' : 'true');
  card.setAttribute('aria-haspopup', 'dialog');
  card.setAttribute('aria-label', active ? `${count} material(is) em uso. Toque para ver os detalhes.` : 'Nenhum material está em uso');

  let hint = card.querySelector<HTMLElement>('.in-use-card-hint');
  if (active && !hint) {
    hint = textElement('small', 'Toque para ver os materiais', 'in-use-card-hint');
    card.append(hint);
  } else if (!active) {
    hint?.remove();
  }
  activateInUseCard(card);
}

function startInUseCardObserver(): void {
  updateInUseCard();
  const observer = new MutationObserver(() => updateInUseCard());
  observer.observe(document.body, { childList: true, subtree: true, characterData: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startInUseCardObserver, { once: true });
} else {
  startInUseCardObserver();
}
