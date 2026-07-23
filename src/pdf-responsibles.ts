import { listProducts } from './lib/db';
import { exportProductsToPdf } from './lib/excel';
import './pdf-responsibles.css';

const UPDATED_BY_KEY = 'quimstock:pdf-updated-by';
const CHECKED_BY_KEY = 'quimstock:pdf-checked-by';

function createField(labelText: string, value: string, placeholder: string): { wrapper: HTMLLabelElement; input: HTMLInputElement } {
  const wrapper = document.createElement('label');
  wrapper.className = 'pdf-responsible-field';

  const label = document.createElement('span');
  label.textContent = labelText;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = value;
  input.placeholder = placeholder;
  input.autocomplete = 'name';

  wrapper.append(label, input);
  return { wrapper, input };
}

function installPdfResponsibleFields(): void {
  const inventoryTitle = document.querySelector<HTMLElement>('.inventory-title');
  if (!inventoryTitle || inventoryTitle.dataset.pdfResponsiblesReady === 'true') return;

  const generateButton = [...inventoryTitle.querySelectorAll<HTMLButtonElement>('button')]
    .find((button) => button.textContent?.trim() === 'Gerar PDF');
  if (!generateButton) return;

  inventoryTitle.dataset.pdfResponsiblesReady = 'true';

  const panel = document.createElement('div');
  panel.className = 'pdf-responsibles-panel';

  const heading = document.createElement('div');
  heading.className = 'pdf-responsibles-heading';
  const title = document.createElement('strong');
  title.textContent = 'Responsáveis pelo relatório';
  const hint = document.createElement('small');
  hint.textContent = 'Os nomes ficam salvos neste aparelho e entram automaticamente no PDF.';
  heading.append(title, hint);

  const fields = document.createElement('div');
  fields.className = 'pdf-responsibles-fields';

  const updated = createField(
    'Atualizado por',
    localStorage.getItem(UPDATED_BY_KEY) ?? '',
    'Digite o nome de quem atualizou',
  );
  const checked = createField(
    'Checado por',
    localStorage.getItem(CHECKED_BY_KEY) ?? '',
    'Digite o nome de quem conferiu',
  );

  fields.append(updated.wrapper, checked.wrapper);
  panel.append(heading, fields);
  inventoryTitle.insertAdjacentElement('afterend', panel);

  const saveValues = () => {
    localStorage.setItem(UPDATED_BY_KEY, updated.input.value.trim());
    localStorage.setItem(CHECKED_BY_KEY, checked.input.value.trim());
  };

  updated.input.addEventListener('input', saveValues);
  checked.input.addEventListener('input', saveValues);

  generateButton.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();

    saveValues();
    const products = await listProducts();
    exportProductsToPdf(products, {
      updatedBy: updated.input.value.trim(),
      checkedBy: checked.input.value.trim(),
    });
  }, true);
}

function observePdfArea(): void {
  installPdfResponsibleFields();
  const observer = new MutationObserver(() => installPdfResponsibleFields());
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', observePdfArea, { once: true });
} else {
  observePdfArea();
}
