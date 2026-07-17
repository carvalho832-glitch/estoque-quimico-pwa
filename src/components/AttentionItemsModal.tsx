import { useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { formatDate, getExpiryLabel, getExpiryLevel } from '../lib/expiry';
import type { Product } from '../types';
import './attention-items-modal.css';

type Props = {
  products: Product[];
  onClose: () => void;
};

function expiryTimestamp(value: string): number {
  const timestamp = new Date(`${value}T12:00:00`).getTime();
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
}

export default function AttentionItemsModal({ products, onClose }: Props) {
  const orderedProducts = useMemo(
    () => [...products].sort((a, b) => expiryTimestamp(a.expiryDate) - expiryTimestamp(b.expiryDate)),
    [products],
  );

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return createPortal(
    <div className="attention-items-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="attention-items-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="attention-items-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="attention-items-header">
          <div>
            <span>CONTROLE DE VALIDADE</span>
            <h2 id="attention-items-title">Itens em atenção</h2>
            <p>{products.length} material(is) próximo(s) da validade.</p>
          </div>
          <button type="button" className="attention-items-close" onClick={onClose} aria-label="Fechar itens em atenção">
            ×
          </button>
        </header>

        <div className="attention-items-list">
          {orderedProducts.length === 0 ? (
            <div className="attention-items-empty">
              <strong>Nenhum item exige atenção agora.</strong>
              <span>Os materiais dentro do prazo seguro não aparecem nesta lista.</span>
            </div>
          ) : (
            orderedProducts.map((product) => {
              const level = getExpiryLevel(product.expiryDate);
              const critical = level === 'critical';

              return (
                <article className={`attention-item-card ${critical ? 'critical' : 'warning'}`} key={product.id}>
                  <div className="attention-item-topline">
                    <div>
                      <strong>{product.name}</strong>
                      <span>Ecode {product.ecode} · Lote {product.batch}</span>
                    </div>
                    <span className={`attention-item-level ${critical ? 'critical' : 'warning'}`}>
                      {critical ? 'Prazo crítico' : 'Atenção'}
                    </span>
                  </div>

                  <dl className="attention-item-data">
                    <div>
                      <dt>Validade</dt>
                      <dd>{formatDate(product.expiryDate)}</dd>
                    </div>
                    <div>
                      <dt>Prazo restante</dt>
                      <dd>{getExpiryLabel(product.expiryDate)}</dd>
                    </div>
                    <div>
                      <dt>Quantidade</dt>
                      <dd>{product.quantity}</dd>
                    </div>
                    <div>
                      <dt>Local</dt>
                      <dd>{product.location || 'Não informado'}</dd>
                    </div>
                  </dl>
                </article>
              );
            })
          )}
        </div>

        <footer className="attention-items-footer">
          <button type="button" onClick={onClose}>Fechar</button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
