import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { saveProduct } from '../lib/db';
import type { Product } from '../types';
import './stock-quantity.css';

type Props = {
  product: Product;
  onUpdated: () => Promise<void> | void;
  onMessage: (message: string) => void;
};

type StockLevel = 'normal' | 'low' | 'critical' | 'empty';

type PendingCardState = {
  productId: string;
  cardTop: number;
};

const CARD_STATE_KEY = 'quimstock-pending-open-card';

function getStockLevel(quantity: number, minimum?: number): StockLevel {
  if (quantity <= 0) return 'empty';
  if (!minimum || minimum <= 0) return 'normal';
  if (quantity < minimum) return 'critical';
  if (quantity === minimum) return 'low';
  return 'normal';
}

const LEVEL_LABELS: Record<StockLevel, string> = {
  normal: 'Estoque normal',
  low: 'Estoque baixo',
  critical: 'Estoque crítico',
  empty: 'Sem estoque',
};

export default function StockQuantityControl({ product, onUpdated, onMessage }: Props) {
  const sectionRef = useRef<HTMLElement>(null);
  const [saving, setSaving] = useState(false);
  const [editingMinimum, setEditingMinimum] = useState(false);
  const [minimumDraft, setMinimumDraft] = useState(String(product.lowStockThreshold ?? ''));

  const level = useMemo(
    () => getStockLevel(product.quantity, product.lowStockThreshold),
    [product.quantity, product.lowStockThreshold],
  );

  useLayoutEffect(() => {
    const rawState = sessionStorage.getItem(CARD_STATE_KEY);
    if (!rawState) return;

    let pendingState: PendingCardState;
    try {
      pendingState = JSON.parse(rawState) as PendingCardState;
    } catch {
      sessionStorage.removeItem(CARD_STATE_KEY);
      return;
    }

    if (pendingState.productId !== product.id) return;

    const details = sectionRef.current?.closest('details.product-card') as HTMLDetailsElement | null;
    if (!details) return;

    details.open = true;
    sessionStorage.removeItem(CARD_STATE_KEY);

    requestAnimationFrame(() => {
      const currentTop = details.getBoundingClientRect().top;
      window.scrollBy({ top: currentTop - pendingState.cardTop, behavior: 'auto' });
    });
  }, [product.id, product.quantity, product.lowStockThreshold]);

  function rememberOpenCard() {
    const details = sectionRef.current?.closest('details.product-card') as HTMLDetailsElement | null;
    if (!details) return;

    const pendingState: PendingCardState = {
      productId: product.id,
      cardTop: details.getBoundingClientRect().top,
    };

    sessionStorage.setItem(CARD_STATE_KEY, JSON.stringify(pendingState));
  }

  async function refreshWithoutClosingCard() {
    rememberOpenCard();
    await onUpdated();
  }

  async function updateQuantity(nextQuantity: number) {
    const quantity = Math.max(0, nextQuantity);
    if (quantity === product.quantity || saving) return;

    setSaving(true);
    try {
      await saveProduct({ ...product, quantity, updatedAt: new Date().toISOString() });
      await refreshWithoutClosingCard();
      onMessage(`${product.name}: quantidade atualizada para ${quantity} unidade(s).`);
    } catch (error) {
      console.error(error);
      sessionStorage.removeItem(CARD_STATE_KEY);
      onMessage('Não foi possível atualizar a quantidade do produto.');
    } finally {
      setSaving(false);
    }
  }

  async function saveMinimum() {
    if (saving) return;
    const parsed = Number(minimumDraft);
    const lowStockThreshold = Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : undefined;

    setSaving(true);
    try {
      await saveProduct({ ...product, lowStockThreshold, updatedAt: new Date().toISOString() });
      await refreshWithoutClosingCard();
      setEditingMinimum(false);
      setMinimumDraft(String(lowStockThreshold ?? ''));
      onMessage(
        lowStockThreshold
          ? `${product.name}: alerta de estoque baixo programado para ${lowStockThreshold} unidade(s).`
          : `${product.name}: alerta de estoque baixo desativado.`,
      );
    } catch (error) {
      console.error(error);
      sessionStorage.removeItem(CARD_STATE_KEY);
      onMessage('Não foi possível salvar o nível mínimo de estoque.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section ref={sectionRef} className={`stock-control stock-level-${level}`}>
      <div className="stock-control-heading">
        <div>
          <span className="stock-control-kicker">CONTROLE DE ESTOQUE</span>
          <strong>Quantidade disponível</strong>
        </div>
        <span className={`stock-level-badge stock-level-${level}`}>{LEVEL_LABELS[level]}</span>
      </div>

      <div className="stock-stepper" aria-label="Controle rápido de quantidade">
        <button type="button" onClick={() => void updateQuantity(product.quantity - 1)} disabled={saving || product.quantity <= 0} aria-label="Diminuir uma unidade">−</button>
        <div><strong>{product.quantity}</strong><span>unidade(s)</span></div>
        <button type="button" onClick={() => void updateQuantity(product.quantity + 1)} disabled={saving} aria-label="Adicionar uma unidade">+</button>
      </div>

      {editingMinimum ? (
        <div className="stock-minimum-editor">
          <label>
            <span>Nível mínimo para alerta</span>
            <input type="number" min="1" inputMode="numeric" value={minimumDraft} onChange={(event) => setMinimumDraft(event.target.value)} placeholder="Ex.: 2" autoFocus />
          </label>
          <div>
            <button type="button" className="stock-minimum-cancel" onClick={() => { setEditingMinimum(false); setMinimumDraft(String(product.lowStockThreshold ?? '')); }} disabled={saving}>Cancelar</button>
            <button type="button" className="stock-minimum-save" onClick={() => void saveMinimum()} disabled={saving}>{saving ? 'Salvando...' : 'Salvar alerta'}</button>
          </div>
        </div>
      ) : (
        <button type="button" className="stock-minimum-button" onClick={() => setEditingMinimum(true)}>
          <span><strong>Nível mínimo</strong><small>{product.lowStockThreshold ? `${product.lowStockThreshold} unidade(s)` : 'Não programado'}</small></span>
          <span aria-hidden="true">⚙</span>
        </button>
      )}
    </section>
  );
}
