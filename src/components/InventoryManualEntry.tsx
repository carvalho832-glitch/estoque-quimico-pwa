import { FormEvent, useMemo, useState } from 'react';
import type { Product } from '../types';
import './InventoryManualEntry.css';

export type ManualEntryReason = 'damaged-qr' | 'missing-qr';

export const MANUAL_ENTRY_REASON_LABELS: Record<ManualEntryReason, string> = {
  'damaged-qr': 'QR Code danificado',
  'missing-qr': 'Produto sem QR Code',
};

export type ManualInventoryEntry =
  | { kind: 'existing'; productId: string; quantity: number; reason: ManualEntryReason }
  | {
      kind: 'new-lot';
      baseProductId: string;
      batch: string;
      expiryDate: string;
      location: string;
      quantity: number;
      reason: ManualEntryReason;
    };

type InventoryManualEntryProps = {
  products: Product[];
  onAdd: (entry: ManualInventoryEntry) => boolean;
  onClose: () => void;
};

function normalize(value: string): string {
  return value.trim().toLocaleUpperCase('pt-BR');
}

export default function InventoryManualEntry({ products, onAdd, onClose }: InventoryManualEntryProps) {
  const [query, setQuery] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');
  const [mode, setMode] = useState<'existing' | 'new-lot'>('existing');
  const [newBatch, setNewBatch] = useState('');
  const [newExpiryDate, setNewExpiryDate] = useState('');
  const [newLocation, setNewLocation] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState<ManualEntryReason>('damaged-qr');
  const [message, setMessage] = useState('');

  const filteredProducts = useMemo(() => {
    const term = normalize(query);
    if (!term) return products;
    return products.filter((product) => (
      [product.name, product.ecode, product.batch, product.location]
        .join(' ')
        .toLocaleUpperCase('pt-BR')
        .includes(term)
    ));
  }, [products, query]);

  const selectedProduct = products.find((product) => product.id === selectedProductId);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const safeQuantity = Math.max(1, Math.floor(Number(quantity) || 0));

    if (!selectedProduct) {
      setMessage('Selecione o produto de referência antes de adicionar.');
      return;
    }

    if (mode === 'existing') {
      if (onAdd({ kind: 'existing', productId: selectedProduct.id, quantity: safeQuantity, reason })) onClose();
      return;
    }

    const batch = normalize(newBatch);
    const location = newLocation.trim();
    if (!batch || !newExpiryDate || !location) {
      setMessage('Informe o número do novo lote, a data de validade e a prateleira.');
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newExpiryDate)
      || Number.isNaN(Date.parse(newExpiryDate))
      || new Date(newExpiryDate).toISOString().slice(0, 10) !== newExpiryDate) {
      setMessage('Informe uma data de validade válida.');
      return;
    }

    const alreadyRegistered = products.some((product) => (
      normalize(product.ecode) === normalize(selectedProduct.ecode)
      && normalize(product.batch) === batch
    ));
    if (alreadyRegistered) {
      setMessage('Esse lote já está cadastrado. Selecione “Lote existente” para contá-lo sem duplicar.');
      return;
    }

    if (onAdd({
      kind: 'new-lot',
      baseProductId: selectedProduct.id,
      batch,
      expiryDate: newExpiryDate,
      location,
      quantity: safeQuantity,
      reason,
    })) onClose();
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
              placeholder="Ex.: nome, 8252886 ou lote C032408071"
              autoFocus
            />
          </label>

          <fieldset className="inventory-manual-mode">
            <legend>Como deseja contar?</legend>
            <label>
              <input
                type="radio"
                name="manual-lot-mode"
                checked={mode === 'existing'}
                onChange={() => { setMode('existing'); setMessage(''); }}
              />
              Lote existente
            </label>
            <label>
              <input
                type="radio"
                name="manual-lot-mode"
                checked={mode === 'new-lot'}
                onChange={() => { setMode('new-lot'); setMessage(''); }}
              />
              + Cadastrar lote novo
            </label>
          </fieldset>

          <label className="inventory-manual-field">
            <span>{mode === 'new-lot' ? 'Produto de referência *' : 'Produto e lote *'}</span>
            <select
              value={selectedProductId}
              onChange={(event) => {
                const productId = event.target.value;
                setSelectedProductId(productId);
                setNewLocation(products.find((product) => product.id === productId)?.location ?? '');
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
              Nenhum produto encontrado. Cadastre o material primeiro no QuimStock.
            </p>
          )}

          {selectedProduct && (
            <article className="inventory-manual-selection">
              <strong>{selectedProduct.name}</strong>
              <span>E-code: {selectedProduct.ecode}</span>
              <span>Lote cadastrado: {selectedProduct.batch}</span>
              <span>Quantidade atual: {selectedProduct.quantity}</span>
            </article>
          )}

          {mode === 'new-lot' && (
            <div className="inventory-manual-new-lot">
              <p>
                O registro acima serve apenas para identificar o produto.
                O lote antigo <strong>não será alterado</strong>. O novo lote ficará pendente até concluir o inventário.
              </p>
              <label className="inventory-manual-field">
                <span>Número do lote novo *</span>
                <input
                  value={newBatch}
                  onChange={(event) => { setNewBatch(event.target.value.toLocaleUpperCase('pt-BR')); setMessage(''); }}
                  placeholder="Digite o lote impresso na lata"
                  autoCapitalize="characters"
                  required
                />
              </label>
              <div className="inventory-manual-grid">
                <label className="inventory-manual-field">
                  <span>Validade da lata nova *</span>
                  <input type="date" value={newExpiryDate} onChange={(event) => setNewExpiryDate(event.target.value)} required />
                </label>
                <label className="inventory-manual-field">
                  <span>Prateleira *</span>
                  <input
                    value={newLocation}
                    onChange={(event) => setNewLocation(event.target.value)}
                    placeholder="Ex.: Prateleira 01"
                    required
                  />
                </label>
              </div>
            </div>
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

          {message && <p className="inventory-manual-message" role="alert">{message}</p>}

          <footer className="inventory-manual-actions">
            <button className="inventory-manual-cancel" type="button" onClick={onClose}>Voltar</button>
            <button className="inventory-manual-confirm" type="submit" disabled={!selectedProduct}>
              {mode === 'new-lot' ? 'Adicionar lote à contagem' : 'Adicionar à contagem'}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
