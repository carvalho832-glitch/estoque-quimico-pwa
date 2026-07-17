import { listProducts } from './lib/db';
import { formatDate, getExpiryLabel, getExpiryLevel } from './lib/expiry';
import type { Product } from './types';
import './components/attention-items-modal.css';

let closeCurrentModal: (() => void) | null = null;

function isAttentionProduct(product: Product): boolean {
  return ['critical', 'warning'].includes(getExpiryLevel(product.expiryDate));
}

function expiryTimestamp(value: string): number {
  const timestamp = new Date(`${value}T12:00:00`).getTime();
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
}

function textElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text: string,
  className?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function createAttentionItem(product: Product): HTMLElement {
  const level = getExpiryLevel(product.expiryDate);
  const critical = level === 'critical';
  const card = document.createElement('article');
  card.className = `attention-item-card ${critical ? 'critical' : 'warning'}`;

  const topLine = document.createElement('div');
  topLine.className = 'attention-item-topline';

  const identity = document.createElement('div');
  identity.append(
    textElement('strong', product.name),
    textElement('span', `Ecode ${product.ecode} · Lote ${product.batch}`),
  );

  const levelBadge = textElement('span', critical ? 'Prazo crítico' : 'Atenção');
  levelBadge.className = `attention-item-level ${critical ? 'critical' : 'warning'}`;
  topLine.append(identity, levelBadge);

  const data = document.createElement('dl');
  data.className = 'attention-item-data';

  const fields = [
    ['Validade', formatDate(product.expiryDate)],
    ['Prazo restante', getExpiryLabel(product.expiryDate)],
    ['Quantidade', String(product.quantity)],
    ['Local', product.location || 'Não informado'],
  ];

  fields.forEach(([label, value]) => {
    const field = document.createElement('div');
    field.append(textElement('dt', label), textElement('dd', value));
    data.append(field);
  });

  card.append(topLine, data);
  return card;
}

async function openAttentionModal(): Promise<void> {
  if (document.querySelector('.attention-items-backdrop')) return;

  const products = (await listProducts())
    .filter(isAttentionProduct)
    .sort((a, b) => expiryTimestamp(a.expiryDate) - expiryTimestamp(b.expiryDate));

  const backdrop = document.createElement('div');
  backdrop.className = 'attention-items-backdrop';
  backdrop.setAttribute('role', 'presentation');

  const modal = document.createElement('section');
  modal.className = 'attention-items-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'attention-items-title');

  const header = document.createElement('header');
  header.className = 'attention-items-header';
  const headerText = document.createElement('div');
  headerText.append(
    textElement('span', 'CONTROLE DE VALIDADE'),
    textElement('h2', 'Itens em atenção'),
    textElement('p', `${products.length} material(is) próximo(s) da validade.`),
  );
  headerText.querySelector('h2')?.setAttribute('id', 'attention-items-title');

  const topCloseButton = textElement('button', '×', 'attention-items-close');
  topCloseButton.setAttribute('type', 'button');
  topCloseButton.setAttribute('aria-label', 'Fechar itens em atenção');
  header.append(headerText, topCloseButton);

  const list = document.createElement('div');
  list.className = 'attention-items-list';

  if (products.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'attention-items-empty';
    empty.append(
      textElement('strong', 'Nenhum item exige atenção agora.'),
      textElement('span', 'Os materiais dentro do prazo seguro não aparecem nesta lista.'),
    );
    list.append(empty);
  } else {
    products.forEach((product) => list.append(createAttentionItem(product)));
  }

  const footer = document.createElement('footer');
  footer.className = 'attention-items-footer';
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

  const handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') close();
  };

  closeCurrentModal?.();
  closeCurrentModal = close;
  topCloseButton.addEventListener('click', close);
  closeButton.addEventListener('click', close);
  backdrop.addEventListener('mousedown', (event) => {
    if (event.target === backdrop) close();
  });
  window.addEventListener('keydown', handleKeyDown);
  document.body.append(backdrop);
  topCloseButton.focus();
}

function activateAttentionCard(attentionCard: HTMLElement): void {
  if (attentionCard.dataset.attentionInteractive === 'true') return;
  attentionCard.dataset.attentionInteractive = 'true';

  attentionCard.addEventListener('click', () => {
    const count = Number.parseInt(attentionCard.querySelector('strong')?.textContent ?? '0', 10) || 0;
    if (count > 0) void openAttentionModal();
  });

  attentionCard.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const count = Number.parseInt(attentionCard.querySelector('strong')?.textContent ?? '0', 10) || 0;
    if (count <= 0) return;
    event.preventDefault();
    void openAttentionModal();
  });
}

function updateAttentionCard(): void {
  const attentionCard = document.querySelector<HTMLElement>('.stats-grid article:nth-child(4)');
  const attentionValue = attentionCard?.querySelector('strong')?.textContent ?? '0';
  const attentionCount = Number.parseInt(attentionValue, 10) || 0;

  if (!attentionCard) return;

  const active = attentionCount > 0;
  attentionCard.classList.toggle('attention-alert-active', active);
  attentionCard.classList.toggle('attention-card-clickable', active);
  attentionCard.classList.toggle('attention-card-disabled', !active);
  attentionCard.setAttribute('role', 'button');
  attentionCard.setAttribute('tabindex', active ? '0' : '-1');
  attentionCard.setAttribute('aria-disabled', active ? 'false' : 'true');
  attentionCard.setAttribute('aria-haspopup', 'dialog');
  attentionCard.setAttribute('aria-label', active
    ? `${attentionCount} produto(s) exigem atenção. Toque para ver os itens.`
    : 'Nenhum produto exige atenção');

  let hint = attentionCard.querySelector<HTMLElement>('.attention-card-hint');
  if (active && !hint) {
    hint = textElement('small', 'Toque para ver os itens', 'attention-card-hint');
    attentionCard.append(hint);
  } else if (!active) {
    hint?.remove();
  }

  activateAttentionCard(attentionCard);
}

function startAttentionCardObserver(): void {
  updateAttentionCard();

  const observer = new MutationObserver(() => updateAttentionCard());
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startAttentionCardObserver, { once: true });
} else {
  startAttentionCardObserver();
}
