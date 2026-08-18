const STORAGE_KEY = 'quimstock-temporary-inventory-v1';
const PRODUCT_SELECTOR = '.inventory-inline-product';

type InventoryRow = {
  ecode?: string;
  batch?: string;
  name?: string;
  registerProduct?: boolean;
};

type InventorySession = {
  status?: string;
  rows?: InventoryRow[];
};

function normalize(value: string | undefined): string {
  return (value ?? '').trim().toUpperCase();
}

function isPlaceholder(value: string | undefined): boolean {
  const normalized = normalize(value);
  return !normalized || normalized === 'PRODUTO NÃO CADASTRADO' || normalized === 'PRODUTO NAO CADASTRADO';
}

function readSession(): InventorySession {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) as InventorySession : {};
  } catch {
    return {};
  }
}

function writeSession(session: InventorySession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function findRow(session: InventorySession, ecode: string, batch: string): InventoryRow | undefined {
  return session.rows?.find((row) => normalize(row.ecode) === normalize(ecode) && normalize(row.batch) === normalize(batch));
}

function identity(row: HTMLTableRowElement): { ecode: string; batch: string } | null {
  const ecode = row.querySelector<HTMLElement>('td[data-label="E-code"]')?.textContent?.trim() ?? '';
  const batch = row.querySelector<HTMLElement>('td[data-label="Lote"]')?.textContent?.trim() ?? '';
  return ecode && batch ? { ecode, batch } : null;
}

function inReview(): boolean {
  return Array.from(document.querySelectorAll<HTMLElement>('.inventory-window-actions .inventory-secondary-action'))
    .some((button) => /continuar leitura/i.test(button.textContent ?? ''));
}

function setStatus(message: string): void {
  const panel = document.querySelector<HTMLElement>('.inventory-window');
  if (!panel) return;

  let status = panel.querySelector<HTMLParagraphElement>('.inventory-window-message');
  if (!status) {
    status = document.createElement('p');
    status.className = 'inventory-window-message';
    status.setAttribute('role', 'status');
    panel.querySelector('.inventory-window-actions')?.insertAdjacentElement('beforebegin', status);
  }
  status.textContent = message;
}

function renderCell(rowElement: HTMLTableRowElement): void {
  const id = identity(rowElement);
  if (!id) return;

  const cell = rowElement.querySelector<HTMLTableCellElement>('td[data-label="Produto"]');
  if (!cell || cell.querySelector(PRODUCT_SELECTOR)) return;

  const session = readSession();
  const row = findRow(session, id.ecode, id.batch);
  if (!row) return;

  const unregistered = rowElement.classList.contains('inventory-unregistered-row');
  const placeholder = isPlaceholder(row.name);

  cell.textContent = '';

  const wrapper = document.createElement('div');
  wrapper.className = 'inventory-inline-product';
  if (unregistered) wrapper.classList.add('unregistered');
  if (placeholder) wrapper.classList.add('missing');

  const input = document.createElement('input');
  input.type = 'text';
  input.value = placeholder ? '' : (row.name ?? '');
  input.placeholder = unregistered ? 'Nome do produto' : 'Produto';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', `Produto do E-code ${id.ecode}, lote ${id.batch}`);

  const hint = document.createElement('small');
  hint.textContent = unregistered
    ? (row.registerProduct ? 'Cadastro preparado ✓' : 'Informe o nome para cadastrar')
    : 'Toque para editar';

  input.addEventListener('input', () => {
    const latest = readSession();
    const latestRow = findRow(latest, id.ecode, id.batch);
    if (!latestRow) return;
    latestRow.name = input.value.trim();
    writeSession(latest);
    wrapper.classList.toggle('missing', !input.value.trim());
    hint.textContent = unregistered
      ? (latestRow.registerProduct ? 'Cadastro preparado ✓' : 'Informe o nome para cadastrar')
      : (input.value.trim() ? 'Nome será atualizado ✓' : 'Informe o nome do produto');
  });

  wrapper.append(input, hint);

  if (unregistered && placeholder) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'inventory-inline-register-product';
    button.textContent = row.registerProduct ? 'Cadastro preparado ✓' : 'Cadastrar produto';
    button.disabled = Boolean(row.registerProduct);

    button.addEventListener('click', () => {
      const name = input.value.trim();
      if (!name) {
        wrapper.classList.add('missing');
        input.focus();
        setStatus(`Informe o nome do produto do E-code ${id.ecode} antes de preparar o cadastro.`);
        return;
      }

      const latest = readSession();
      const latestRow = findRow(latest, id.ecode, id.batch);
      if (!latestRow) return;

      latestRow.name = name;
      latestRow.registerProduct = true;
      writeSession(latest);
      wrapper.classList.remove('missing');
      button.textContent = 'Cadastro preparado ✓';
      button.disabled = true;
      hint.textContent = 'Será gravado ao atualizar estoque';
      setStatus(`Produto “${name}” preparado para cadastro. O estoque oficial ainda não foi alterado.`);
    });

    wrapper.append(button);
  } else if (unregistered) {
    const badge = document.createElement('span');
    badge.className = 'inventory-inline-new-lot';
    badge.textContent = 'Novo lote';
    wrapper.append(badge);
  }

  cell.append(wrapper);
}

function refresh(): void {
  if (!inReview()) return;
  document.querySelectorAll<HTMLTableRowElement>('.inventory-review-table tbody tr').forEach(renderCell);
}

const observer = new MutationObserver(() => {
  window.requestAnimationFrame(refresh);
});
observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

window.addEventListener('focus', refresh);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refresh();
});

refresh();
