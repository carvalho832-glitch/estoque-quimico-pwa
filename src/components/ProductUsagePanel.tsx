import { useEffect, useMemo, useState, type FormEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { saveProduct } from '../lib/db';
import type { Product, ProductUsage } from '../types';
import './product-usage.css';

type Props = {
  product: Product;
  onUpdated: () => Promise<void> | void;
  onMessage: (message: string) => void;
};

type UsageDraft = {
  workOrder: string;
  aircraft: string;
  operator: string;
};

type HistoryEntry = ProductUsage & {
  active: boolean;
};

const EMPTY_USAGE: UsageDraft = {
  workOrder: '',
  aircraft: '',
  operator: '',
};

function formatDateTime(value?: string): string {
  if (!value) return 'Não informado';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Não informado';

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

export function productIsInUse(product: Product): boolean {
  return product.availabilityStatus === 'in-use' && Boolean(product.currentUsage);
}

export default function ProductUsagePanel({ product, onUpdated, onMessage }: Props) {
  const [formOpen, setFormOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [draft, setDraft] = useState<UsageDraft>(EMPTY_USAGE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const inUse = productIsInUse(product);

  const historyEntries = useMemo<HistoryEntry[]>(() => {
    const entries: HistoryEntry[] = (product.usageHistory ?? []).map((usage) => ({
      ...usage,
      active: false,
    }));

    if (inUse && product.currentUsage) {
      entries.push({
        ...product.currentUsage,
        returnedAt: undefined,
        active: true,
      });
    }

    return entries.sort((first, second) => {
      return new Date(second.startedAt).getTime() - new Date(first.startedAt).getTime();
    });
  }, [inUse, product.currentUsage, product.usageHistory]);

  useEffect(() => {
    if (!historyOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setHistoryOpen(false);
    };

    window.addEventListener('keydown', closeWithEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeWithEscape);
    };
  }, [historyOpen]);

  async function startUsage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    const workOrder = draft.workOrder.trim();
    const aircraft = draft.aircraft.trim();
    const operator = draft.operator.trim();

    if (!workOrder || !aircraft || !operator) {
      setError('Preencha OM, avião e operador. A data e a hora serão registradas automaticamente.');
      return;
    }

    const now = new Date().toISOString();
    setSaving(true);

    try {
      await saveProduct({
        ...product,
        availabilityStatus: 'in-use',
        currentUsage: {
          workOrder,
          aircraft,
          operator,
          startedAt: now,
        },
        updatedAt: now,
      });
      await onUpdated();
      setDraft(EMPTY_USAGE);
      setFormOpen(false);
      onMessage(`${product.name} marcado como “Em uso”. Data e hora registradas automaticamente.`);
    } catch (saveError) {
      console.error(saveError);
      setError('Não foi possível registrar a retirada do material.');
    } finally {
      setSaving(false);
    }
  }

  async function returnToStock() {
    if (!product.currentUsage) return;
    if (!window.confirm(`Confirmar a devolução de ${product.name} ao estoque?`)) return;

    const now = new Date().toISOString();
    const completedUsage: ProductUsage = {
      ...product.currentUsage,
      returnedAt: now,
    };

    setSaving(true);
    setError('');

    try {
      await saveProduct({
        ...product,
        availabilityStatus: 'stock',
        currentUsage: undefined,
        usageHistory: [...(product.usageHistory ?? []), completedUsage],
        updatedAt: now,
      });
      await onUpdated();
      onMessage(`${product.name} retornou ao estoque. A devolução foi registrada automaticamente.`);
    } catch (saveError) {
      console.error(saveError);
      setError('Não foi possível registrar a devolução do material.');
    } finally {
      setSaving(false);
    }
  }

  function closeFromBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) setHistoryOpen(false);
  }

  const historyModal = historyOpen && typeof document !== 'undefined'
    ? createPortal(
        <div className="usage-history-backdrop" onMouseDown={closeFromBackdrop}>
          <section
            className="usage-history-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`usage-history-title-${product.id}`}
          >
            <header className="usage-history-modal-header">
              <div>
                <span className="usage-history-modal-kicker">HISTÓRICO DE USO</span>
                <h2 id={`usage-history-title-${product.id}`}>{product.name}</h2>
                <p>Ecode {product.ecode} · Lote {product.batch}</p>
              </div>
              <button
                type="button"
                className="usage-history-close-icon"
                onClick={() => setHistoryOpen(false)}
                aria-label="Fechar histórico de uso"
              >
                ×
              </button>
            </header>

            <div className="usage-history-modal-summary">
              <span>{historyEntries.length} registro(s)</span>
              <small>Mais recente primeiro</small>
            </div>

            <div className="usage-history-modal-body">
              {historyEntries.map((usage, index) => (
                <article className={`usage-history-entry ${usage.active ? 'active' : 'completed'}`} key={`${usage.startedAt}-${index}`}>
                  <div className="usage-history-entry-heading">
                    <div>
                      <span>REGISTRO {historyEntries.length - index}</span>
                      <strong>{usage.operator}</strong>
                    </div>
                    <span className={`usage-history-status ${usage.active ? 'active' : 'completed'}`}>
                      {usage.active ? 'Em uso' : 'Finalizado'}
                    </span>
                  </div>

                  <dl className="usage-history-entry-grid">
                    <div><dt>OM</dt><dd>{usage.workOrder}</dd></div>
                    <div><dt>Avião</dt><dd>{usage.aircraft}</dd></div>
                    <div><dt>Operador</dt><dd>{usage.operator}</dd></div>
                    <div><dt>Data e hora da retirada</dt><dd>{formatDateTime(usage.startedAt)}</dd></div>
                    <div className="usage-history-return-time">
                      <dt>Data e hora da devolução</dt>
                      <dd>{usage.active ? 'Material ainda em uso' : formatDateTime(usage.returnedAt)}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>

            <footer className="usage-history-modal-footer">
              <button type="button" onClick={() => setHistoryOpen(false)}>Fechar histórico</button>
            </footer>
          </section>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <section className={`usage-panel ${inUse ? 'is-in-use' : 'is-in-stock'}`}>
        <div className="usage-panel-heading">
          <div>
            <span className="usage-kicker">SITUAÇÃO DO MATERIAL</span>
            <strong>{inUse ? 'Em uso' : 'Disponível no estoque'}</strong>
          </div>
          <span className={`availability-badge ${inUse ? 'in-use' : 'stock'}`}>
            {inUse ? 'Em uso' : 'Estoque'}
          </span>
        </div>

        {inUse && product.currentUsage ? (
          <>
            <dl className="usage-data-grid">
              <div><dt>OM</dt><dd>{product.currentUsage.workOrder}</dd></div>
              <div><dt>Avião</dt><dd>{product.currentUsage.aircraft}</dd></div>
              <div><dt>Operador</dt><dd>{product.currentUsage.operator}</dd></div>
              <div><dt>Retirado em</dt><dd>{formatDateTime(product.currentUsage.startedAt)}</dd></div>
            </dl>
            <button className="usage-return-button" type="button" onClick={() => void returnToStock()} disabled={saving}>
              {saving ? 'Registrando...' : 'Retornar ao estoque'}
            </button>
          </>
        ) : formOpen ? (
          <form className="usage-form" onSubmit={startUsage}>
            <p>A data e a hora da retirada serão preenchidas automaticamente pelo sistema.</p>
            <label>
              <span>OM *</span>
              <input value={draft.workOrder} onChange={(event) => setDraft((current) => ({ ...current, workOrder: event.target.value }))} placeholder="Ex.: OM 45872" autoFocus />
            </label>
            <label>
              <span>Avião *</span>
              <input value={draft.aircraft} onChange={(event) => setDraft((current) => ({ ...current, aircraft: event.target.value }))} placeholder="Ex.: PR-ABC ou MSN 1234" />
            </label>
            <label>
              <span>Operador *</span>
              <input value={draft.operator} onChange={(event) => setDraft((current) => ({ ...current, operator: event.target.value }))} placeholder="Nome ou matrícula" />
            </label>
            {error && <p className="usage-error" role="alert">{error}</p>}
            <div className="usage-form-actions">
              <button type="button" className="usage-cancel-button" onClick={() => { setFormOpen(false); setDraft(EMPTY_USAGE); setError(''); }} disabled={saving}>
                Cancelar
              </button>
              <button type="submit" className="usage-start-button" disabled={saving}>
                {saving ? 'Registrando...' : 'Confirmar retirada'}
              </button>
            </div>
          </form>
        ) : (
          <button className="usage-start-button full" type="button" onClick={() => setFormOpen(true)}>
            Retirar material para uso
          </button>
        )}

        {!inUse && error && <p className="usage-error" role="alert">{error}</p>}

        {historyEntries.length > 0 && (
          <button className="usage-history-open-button" type="button" onClick={() => setHistoryOpen(true)}>
            <span>Ver histórico de uso ({historyEntries.length})</span>
            <span aria-hidden="true">↗</span>
          </button>
        )}
      </section>

      {historyModal}
    </>
  );
}
