import { useEffect, useMemo, useState } from 'react';
import { saveProduct } from '../lib/db';
import type { Product } from '../types';
import './stock-quantity.css';

type Props = {
  product: Product;
  onUpdated: () => Promise<void> | void;
  onMessage: (message: string) => void;
};

type StockLevel = 'normal' | 'low' | 'critical' | 'empty';

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

function findProductCard(product: Product): HTMLDetailsElement | null {
  const cards = Array.from(document.querySelectorAll<HTMLDetailsElement>('details.product-card'));
  return cards.find((card) => {
    const essentialData = card.querySelector('.product-essential-data')?.textContent ?? '';
    return essentialData.includes(product.ecode) && essentialData.includes(product.batch);
  }) ?? null;
}

export default function StockQuantityControl({ product, onUpdated, onMessage }: Props) {
  const [saving, setSaving] = useState(false);
  const [editingMinimum, setEditingMinimum] = useState(false);
  const [minimumDraft, setMinimumDraft] = useState(String(product.lowStockThreshold ?? ''));
  const [displayQuantity, setDisplayQuantity] = useState(product.quantity);

  useEffect(() => {
    setDisplayQuantity(product.quantity);
  }, [product.quantity]);

  useEffect(() => {
    if (!editingMinimum) setMinimumDraft(String(product.lowStockThreshold ?? ''));
  }, [editingMinimum, product.lowStockThreshold]);

  const level = useMemo(
    () => getStockLevel(displayQuantity, product.lowStockThreshold),
    [displayQuantity, product.lowStockThreshold],
  );

  async function keepCardOpenDuringSync(action: () => Promise<void>) {
    const initialCard = findProductCard(product);
    const shouldStayOpen = initialCard?.open ?? false;

    const restoreCard = () => {
      if (!shouldStayOpen) return;
      const card = findProductCard(product);
      if (card && !card.open) card.open = true;
    };

    const observer = new MutationObserver(() => {
      requestAnimationFrame(restoreCard);
    });

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['open'],
    });

    try {
      await action();
      restoreCard();
      requestAnimationFrame(() => requestAnimationFrame(restoreCard));
      window.setTimeout(restoreCard, 250);
      window.setTimeout(restoreCard, 700);
      window.setTimeout(restoreCard, 1500);
    } finally {
      window.setTimeout(() => observer.disconnect(), 3000);
    }
  }

  async function updateQuantity(nextQuantity: number) {
    const quantity = Math.max(0, nextQuantity);
    if (quantity === displayQuantity || saving) return;

    const previousQuantity = displayQuantity;
    setDisplayQuantity(quantity);
    setSaving(true);

    try {
      await keepCardOpenDuringSync(async () => {
        await saveProduct({ ...product, quantity, updatedAt: new Date().toISOString() });
        await onUpdated();
      });
    } catch (error) {
      console.error(error);
      setDisplayQuantity(previousQuantity);
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
      await keepCardOpenDuringSync(async () => {
        await saveProduct({ ...product, lowStockThreshold, updatedAt: new Date().toISOString() });
        await onUpdated();
      });
      setEditingMinimum(false);
      setMinimumDraft(String(lowStockThreshold ?? ''));
    } catch (error) {
      console.error(error);
      onMessage('Não foi possível salvar o nível mínimo de estoque.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={`stock-control stock-level-${level}`}>
      <div className="stock-control-heading">
        <div>
          <span className="stock-control-kicker">CONTROLE DE ESTOQUE</span>
          <strong>Quantidade disponível</strong>
        </div>
        <span className={`stock-level-badge stock-level-${level}`}>{LEVEL_LABELS[level]}</span>
      </div>

      <div className="stock-stepper" aria-label="Controle rápido de quantidade">
        <button type="button" onClick={() => void updateQuantity(displayQuantity - 1)} disabled={saving || displayQuantity <= 0} aria-label="Diminuir uma unidade">−</button>
        <div><strong>{displayQuantity}</strong><span>unidade(s)</span></div>
        <button type="button" onClick={() => void updateQuantity(displayQuantity + 1)} disabled={saving} aria-label="Adicionar uma unidade">+</button>
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
