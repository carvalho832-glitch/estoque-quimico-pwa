import { useState, type FormEvent } from 'react';
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
  const [draft, setDraft] = useState<UsageDraft>(EMPTY_USAGE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const inUse = productIsInUse(product);

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

  return (
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

      {(product.usageHistory?.length ?? 0) > 0 && (
        <details className="usage-history">
          <summary>Ver histórico de uso ({product.usageHistory?.length})</summary>
          <div>
            {[...(product.usageHistory ?? [])].reverse().slice(0, 5).map((usage, index) => (
              <article key={`${usage.startedAt}-${index}`}>
                <strong>{usage.workOrder} · {usage.aircraft}</strong>
                <span>{usage.operator}</span>
                <small>{formatDateTime(usage.startedAt)} até {formatDateTime(usage.returnedAt)}</small>
              </article>
            ))}
          </div>
        </details>
      )}
    </section>
  );
}
