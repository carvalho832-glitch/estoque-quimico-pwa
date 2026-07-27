import { FormEvent, useMemo, useState } from 'react';
import type { Product } from '../types';
import './InventoryManualEntry.css';

export type ManualEntryReason = 'damaged-qr' | 'missing-qr';

export const MANUAL_ENTRY_REASON_LABELS: Record<ManualEntryReason, string> = {
  'damaged-qr': 'QR Code danificado',
  'missing-qr': 'Produto sem QR Code',
};

type InventoryManualEntryProps = {
  products: Product[];
  onAdd: (productId: string, quantity: number, reason: ManualEntryReason) => void;
  onClose: () => void;
};

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase('pt-BR');
}

export default function InventoryManualEntry({ products, onAdd, onClose }: InventoryManualEntryProps) {
  const [query, setQuery] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState<ManualEntryReason>('damaged-qr');
  const [message, setMessage] = useState('');

  const filteredProducts = useMemo(() => {
    const term = normalize(query);
    if (!term) return products;

    return products.filter((product) => (
      [product.name, product.ecode, product.batch, product.location]
        .join(' ')
        .toLocaleLowerCase('pt-BR')
        .includes(term)
    ));
  }, [products, query]);

  const selectedProduct = products.find((product) => product.id === selectedProductId);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const safeQuantity = Math.max(1, Math.floor(Number(quantity) || 0));

    if (!selectedProduct) {
      setMessage('Selecione o produto e o lote corretos antes de adicionar.');
      return;
    }

    onAdd(selectedProduct.id, safeQuantity, reason);
    onClose();
  }

  return (
    <div className="inventory-manual-backdrop" role="presentation">
      <section className="inventory-manual-dialog" role="dialog" aria-modal="true" aria-labelledby="manual-entry-title">
        <header className="inventory-manual-header">
          <div>
            <span className="eyebrow">INCLUSÃO SEM LEITURA</span>
            <h2 id="manual-entry-title">Adicionar item manualmente</h2>
            <p>Use para QR danificado ou produto sem etiqueta QR.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Fechar inclusão manual">✕</button>
        </header>

        <form onSubmit={handleSubmit}>
          <label className="inventory-manual-field">
            <span>Buscar produto, E-code ou lote</span>
            <input
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setSelectedProductId('');
                setMessage('');
              }}
              placeholder="Ex.: nome, 8679400 ou lote C032408071"
              autoFocus
            />
          </label>

          <label className="inventory-manual-field">
            <span>Produto e lote *</span>
            <select
              value={selectedProductId}
              onChange={(event) => {
                setSelectedProductId(event.target.value);
                setMessage('');
              }}
              required
            >
              <option value="">Selecione um registro</option>
              {filteredProducts.map((product) => (
                <option value={product.id} key={product.id}>
                  {product.ecode} · Lote {product.batch} · {product.name}
                </option>
              ))}
            </select>
          </label>

          {!filteredProducts.length && (
            <p className="inventory-manual-empty">
              Nenhum registro encontrado. Cadastre primeiro o produto e o lote no QuimStock.
            </p>
          )}

          {selectedProduct && (
            <article className="inventory-manual-selection">
              <strong>{selectedProduct.name}</strong>
              <span>E-code: {selectedProduct.ecode}</span>
              <span>Lote: {selectedProduct.batch}</span>
              <span>Quantidade atual: {selectedProduct.quantity}</span>
            </article>
          )}

          <div className="inventory-manual-grid">
            <label className="inventory-manual-field">
              <span>Quantidade encontrada *</span>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                value={quantity}
                onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))}
                required
              />
            </label>

            <label className="inventory-manual-field">
              <span>Motivo *</span>
              <select value={reason} onChange={(event) => setReason(event.target.value as ManualEntryReason)}>
                <option value="damaged-qr">QR Code danificado</option>
                <option value="missing-qr">Produto sem QR Code</option>
              </select>
            </label>
          </div>

          {message && <p className="inventory-manual-message" role="status">{message}</p>}

          <footer className="inventory-manual-actions">
            <button className="inventory-manual-cancel" type="button" onClick={onClose}>Voltar</button>
            <button className="inventory-manual-confirm" type="submit" disabled={!selectedProduct}>Adicionar à contagem</button>
          </footer>
        </form>
      </section>
    </div>
  );
}
