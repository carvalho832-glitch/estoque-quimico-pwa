import { listProducts } from './lib/db';
import { exportProductsToExcel, exportProductsToPdf } from './lib/excel';
import './pdf-responsibles.css';

const UPDATED_BY_KEY = 'quimstock:pdf-updated-by';
const CHECKED_BY_KEY = 'quimstock:pdf-checked-by';
type ReportFormat = 'pdf' | 'excel';

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

function openReportDialog(format: ReportFormat): void {
  if (document.querySelector('.pdf-dialog-backdrop')) return;

  const backdrop = document.createElement('div');
  backdrop.className = 'pdf-dialog-backdrop';
  backdrop.setAttribute('role', 'presentation');

  const dialog = document.createElement('section');
  dialog.className = 'pdf-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'pdf-dialog-title');

  const header = document.createElement('div');
  header.className = 'pdf-dialog-header';
  const heading = document.createElement('div');
  const eyebrow = document.createElement('span');
  eyebrow.className = 'eyebrow';
  eyebrow.textContent = 'RELATÓRIO DE ESTOQUE';
  const title = document.createElement('h2');
  title.id = 'pdf-dialog-title';
  title.textContent = `Identificar responsáveis do ${format === 'excel' ? 'Excel' : 'PDF'}`;
  const hint = document.createElement('p');
  hint.textContent = 'Informe quem atualizou e quem conferiu a lista antes de gerar o arquivo.';
  heading.append(eyebrow, title, hint);

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'pdf-dialog-close';
  close.textContent = '×';
  close.setAttribute('aria-label', 'Fechar');
  header.append(heading, close);

  const fields = document.createElement('div');
  fields.className = 'pdf-responsibles-fields';
  const updated = createField('Atualizado por', localStorage.getItem(UPDATED_BY_KEY) ?? '', 'Digite o nome de quem atualizou');
  const checked = createField('Checado por', localStorage.getItem(CHECKED_BY_KEY) ?? '', 'Digite o nome de quem conferiu');
  fields.append(updated.wrapper, checked.wrapper);

  const actions = document.createElement('div');
  actions.className = 'pdf-dialog-actions';
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'ghost-button';
  cancel.textContent = 'Cancelar';
  const generate = document.createElement('button');
  generate.type = 'button';
  generate.className = 'primary-button';
  const generateLabel = format === 'excel' ? 'Gerar Excel' : 'Gerar PDF';
  generate.textContent = generateLabel;
  actions.append(cancel, generate);

  dialog.append(header, fields, actions);
  backdrop.append(dialog);
  document.body.append(backdrop);
  document.body.classList.add('modal-open');

  const dismiss = () => {
    backdrop.remove();
    document.body.classList.remove('modal-open');
  };

  close.addEventListener('click', dismiss);
  cancel.addEventListener('click', dismiss);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) dismiss();
  });

  generate.addEventListener('click', async () => {
    const updatedBy = updated.input.value.trim();
    const checkedBy = checked.input.value.trim();
    if (!updatedBy || !checkedBy) {
      dialog.classList.add('pdf-dialog-invalid');
      (!updatedBy ? updated.input : checked.input).focus();
      return;
    }

    localStorage.setItem(UPDATED_BY_KEY, updatedBy);
    localStorage.setItem(CHECKED_BY_KEY, checkedBy);
    generate.disabled = true;
    generate.textContent = 'Gerando...';
    try {
      const products = await listProducts();
      if (format === 'excel') {
        await exportProductsToExcel(products, { updatedBy, checkedBy });
      } else {
        exportProductsToPdf(products, { updatedBy, checkedBy });
      }
      dismiss();
    } finally {
      generate.disabled = false;
      generate.textContent = generateLabel;
    }
  });

  window.setTimeout(() => updated.input.focus(), 50);
}

function installReportDialogs(): void {
  document.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
    if (button.closest('.pdf-dialog')) return;
    const label = button.textContent?.trim();
    const format: ReportFormat | null = label === 'Gerar Excel'
      ? 'excel'
      : label === 'Gerar PDF'
        ? 'pdf'
        : null;

    if (!format || button.dataset.reportResponsiblesReady === 'true') return;
    button.dataset.reportResponsiblesReady = 'true';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      openReportDialog(format);
    }, true);
  });
}

function observePdfArea(): void {
  installReportDialogs();
  const observer = new MutationObserver(() => installReportDialogs());
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', observePdfArea, { once: true });
} else {
  observePdfArea();
}
