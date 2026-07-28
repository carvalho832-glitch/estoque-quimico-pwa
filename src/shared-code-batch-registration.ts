import { listProducts, saveProduct } from './lib/db';
import type { Product } from './types';

const bypassForms = new WeakSet<HTMLFormElement>();
let savingSharedProduct = false;

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('pt-BR');
}

function createId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function findField(
  form: HTMLFormElement,
  labelText: string,
): HTMLInputElement | HTMLTextAreaElement | null {
  const normalizedLabel = normalize(labelText);
  const labels = Array.from(form.querySelectorAll<HTMLLabelElement>('label.field'));
  const label = labels.find((item) => normalize(item.textContent ?? '').includes(normalizedLabel));
  return label?.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea') ?? null;
}

function showMessage(form: HTMLFormElement, text: string): void {
  const panel = form.closest<HTMLElement>('.panel');
  if (!panel) return;

  let message = panel.querySelector<HTMLParagraphElement>('.app-message');
  if (!message) {
    message = document.createElement('p');
    message.className = 'app-message';
    message.setAttribute('role', 'status');
    form.insertAdjacentElement('afterend', message);
  }

  message.textContent = text;
  message.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function submitThroughReact(form: HTMLFormElement): void {
  bypassForms.add(form);
  form.requestSubmit();
}

async function handleNewProduct(form: HTMLFormElement, submitButton: HTMLButtonElement): Promise<void> {
  const ecodeInput = findField(form, 'Ecode/Material');
  const batchInput = findField(form, 'Lote');
  const expiryInput = findField(form, 'DV, data de validade');
  const nameInput = findField(form, 'Nome do produto');
  const quantityInput = findField(form, 'Quantidade');
  const docmatInput = findField(form, 'Docmat');
  const locationInput = findField(form, 'Local de armazenamento');
  const notesInput = findField(form, 'Observações');

  const ecode = ecodeInput?.value.trim().toUpperCase() ?? '';
  const batch = batchInput?.value.trim().toUpperCase() ?? '';
  const expiryDate = expiryInput?.value.trim() ?? '';
  const name = nameInput?.value.trim() ?? '';

  if (!ecode || !batch || !expiryDate) {
    submitThroughReact(form);
    return;
  }

  const products = await listProducts();
  const sameCodeAndBatch = products.filter(
    (product) => product.ecode.trim().toUpperCase() === ecode
      && product.batch.trim().toUpperCase() === batch,
  );

  if (!sameCodeAndBatch.length) {
    submitThroughReact(form);
    return;
  }

  if (!name) {
    showMessage(
      form,
      'Este Ecode/Material e lote já são usados por outro produto. Informe o nome/descrição para diferenciar o novo material.',
    );
    return;
  }

  const sameDescription = sameCodeAndBatch.some((product) => normalize(product.name) === normalize(name));
  if (sameDescription) {
    submitThroughReact(form);
    return;
  }

  const now = new Date().toISOString();
  const quantity = Math.max(1, Math.floor(Number(quantityInput?.value) || 1));
  const selectedPhoto = document.querySelector<HTMLInputElement>('input[type="file"]')?.files?.[0];

  const product: Product = {
    id: createId(),
    name,
    ecode,
    batch,
    expiryDate,
    quantity,
    docmat: docmatInput?.value.trim() || undefined,
    location: locationInput?.value.trim() ?? '',
    notes: notesInput?.value.trim() ?? '',
    imageName: selectedPhoto?.name,
    availabilityStatus: 'stock',
    createdAt: now,
    updatedAt: now,
  };

  submitButton.disabled = true;
  submitButton.textContent = 'Cadastrando produto diferente...';

  try {
    await saveProduct(product);
    window.dispatchEvent(new CustomEvent('quimstock:products-changed'));
    showMessage(
      form,
      `Produto “${name}” cadastrado mesmo usando o Ecode ${ecode} e lote ${batch}. No inventário, use “Adicionar manualmente” para escolher a descrição correta desta combinação.`,
    );
    window.setTimeout(() => window.location.reload(), 1400);
  } catch (error) {
    console.error(error);
    submitButton.disabled = false;
    submitButton.textContent = 'Confirmar e cadastrar';
    showMessage(form, 'Não foi possível cadastrar o produto diferente. Tente novamente.');
  }
}

document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) return;

  if (bypassForms.has(form)) {
    bypassForms.delete(form);
    return;
  }

  const submitButton = form.querySelector<HTMLButtonElement>('button.primary-button[type="submit"]');
  if (!submitButton || !/confirmar e cadastrar/i.test(submitButton.textContent ?? '')) return;
  if (savingSharedProduct) return;

  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation();

  savingSharedProduct = true;
  void handleNewProduct(form, submitButton).finally(() => {
    savingSharedProduct = false;
  });
}, true);
