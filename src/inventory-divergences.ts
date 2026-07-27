import './inventory-divergences.css';

const STORAGE_KEY = 'quimstock-temporary-inventory-v1';
const boundCards = new WeakSet<HTMLElement>();

 type InventoryDivergenceRow = {
  productId?: string;
  ecode?: string;
  name?: string;
  batch?: string;
  systemQuantity?: number;
  countedQuantity?: number;
};

function readInventoryRows(): InventoryDivergenceRow[] {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const parsed = JSON.parse(stored) as { rows?: unknown };
    return Array.isArray(parsed.rows) ? parsed.rows as InventoryDivergenceRow[] : [];
  } catch (error) {
    console.warn('Não foi possível carregar as divergências do inventário.', error);
    return [];
  }
}

function getDivergences(): InventoryDivergenceRow[] {
  return readInventoryRows().filter((row) => (
    Number(row.systemQuantity) !== Number(row.countedQuantity)
  ));
}

function safeText(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || fallback;
}

function formatDifference(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function createMetric(label: string, value: string, extraClass = ''): HTMLElement {
  const metric = document.createElement('div');
  metric.className = `inventory-divergence-metric ${extraClass}`.trim();

  const metricLabel = document.createElement('span');
  metricLabel.textContent = label;

  const metricValue = document.createElement('strong');
  metricValue.textContent = value;

  metric.append(metricLabel, metricValue);
  return metric;
}

function closeDivergenceModal(): void {
  document.querySelector('.inventory-divergence-backdrop')?.remove();
}

function openDivergenceModal(): void {
  closeDivergenceModal();

  const divergences = getDivergences();
  const missingUnits = divergences.reduce((total, row) => {
    const difference = Number(row.countedQuantity) - Number(row.systemQuantity);
    return difference < 0 ? total + Math.abs(difference) : total;
  }, 0);
  const surplusUnits = divergences.reduce((total, row) => {
    const difference = Number(row.countedQuantity) - Number(row.systemQuantity);
    return difference > 0 ? total + difference : total;
  }, 0);

  const backdrop = document.createElement('div');
  backdrop.className = 'inventory-divergence-backdrop';
  backdrop.setAttribute('role', 'presentation');

  const dialog = document.createElement('section');
  dialog.className = 'inventory-divergence-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'inventory-divergence-title');

  const header = document.createElement('header');
  header.className = 'inventory-divergence-header';

  const heading = document.createElement('div');
  const eyebrow = document.createElement('span');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'CONFERÊNCIA DO INVENTÁRIO';

  const title = document.createElement('h2');
  title.id = 'inventory-divergence-title';
  title.textContent = 'Divergências encontradas';

  const subtitle = document.createElement('p');
  subtitle.textContent = divergences.length
    ? `${divergences.length} lote(s) possuem diferença entre o sistema e a contagem física.`
    : 'Nenhuma diferença foi encontrada na conferência atual.';

  heading.append(eyebrow, title, subtitle);

  const closeButton = document.createElement('button');
  closeButton.className = 'inventory-divergence-close';
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Fechar detalhes das divergências');
  closeButton.textContent = '✕';
  closeButton.addEventListener('click', closeDivergenceModal);

  header.append(heading, closeButton);

  const summary = document.createElement('div');
  summary.className = 'inventory-divergence-summary';
  summary.append(
    createMetric('Lotes divergentes', String(divergences.length)),
    createMetric('Unidades faltando', String(missingUnits), missingUnits ? 'missing' : ''),
    createMetric('Unidades sobrando', String(surplusUnits), surplusUnits ? 'surplus' : ''),
  );

  const content = document.createElement('div');
  content.className = 'inventory-divergence-content';

  if (!divergences.length) {
    const empty = document.createElement('div');
    empty.className = 'inventory-divergence-empty';
    empty.innerHTML = '<strong>Estoque conferido sem diferenças</strong><span>As quantidades físicas estão iguais às quantidades registradas.</span>';
    content.append(empty);
  } else {
    divergences.forEach((row) => {
      const systemQuantity = Number(row.systemQuantity) || 0;
      const countedQuantity = Number(row.countedQuantity) || 0;
      const difference = countedQuantity - systemQuantity;

      const item = document.createElement('article');
      item.className = 'inventory-divergence-item';

      const itemHeader = document.createElement('div');
      itemHeader.className = 'inventory-divergence-item-header';

      const identity = document.createElement('div');
      const ecode = document.createElement('span');
      ecode.className = 'inventory-divergence-ecode';
      ecode.textContent = safeText(row.ecode, 'E-code não informado');

      const productName = document.createElement('strong');
      productName.textContent = safeText(row.name, 'Produto sem nome');
      identity.append(ecode, productName);

      const status = document.createElement('span');
      status.className = `inventory-divergence-status ${difference < 0 ? 'missing' : 'surplus'}`;
      status.textContent = difference < 0
        ? `Faltam ${Math.abs(difference)}`
        : `Sobram ${difference}`;

      itemHeader.append(identity, status);

      const batch = document.createElement('p');
      batch.className = 'inventory-divergence-batch';
      batch.textContent = `Lote: ${safeText(row.batch, 'Não informado')}`;

      const values = document.createElement('div');
      values.className = 'inventory-divergence-values';
      values.append(
        createMetric('Sistema', String(systemQuantity)),
        createMetric('Conferido', String(countedQuantity)),
        createMetric('Diferença', formatDifference(difference), difference < 0 ? 'missing' : 'surplus'),
      );

      item.append(itemHeader, batch, values);
      content.append(item);
    });
  }

  const footer = document.createElement('footer');
  footer.className = 'inventory-divergence-actions';

  const footerButton = document.createElement('button');
  footerButton.type = 'button';
  footerButton.textContent = 'Fechar';
  footerButton.addEventListener('click', closeDivergenceModal);
  footer.append(footerButton);

  dialog.append(header, summary, content, footer);
  backdrop.append(dialog);

  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeDivergenceModal();
  });

  function handleEscape(event: KeyboardEvent) {
    if (event.key !== 'Escape') return;
    closeDivergenceModal();
    window.removeEventListener('keydown', handleEscape);
  }

  window.addEventListener('keydown', handleEscape);
  document.body.append(backdrop);
  closeButton.focus();
}

function bindDivergenceCard(): void {
  const card = document.querySelector<HTMLElement>('.inventory-summary-grid article:nth-child(3)');
  if (!card) return;

  const count = card.querySelector('strong')?.textContent?.trim() || '0';
  const ariaLabel = `${count} divergência(s). Abrir detalhes.`;
  if (card.getAttribute('aria-label') !== ariaLabel) card.setAttribute('aria-label', ariaLabel);

  if (boundCards.has(card)) return;
  boundCards.add(card);

  card.classList.add('inventory-divergence-card');
  card.tabIndex = 0;
  card.setAttribute('role', 'button');
  card.title = 'Toque para visualizar quais produtos estão divergentes';

  card.addEventListener('click', openDivergenceModal);
  card.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openDivergenceModal();
  });
}

const observer = new MutationObserver(bindDivergenceCard);
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
  characterData: true,
});

bindDivergenceCard();
