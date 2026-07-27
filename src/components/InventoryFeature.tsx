import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { listProducts } from '../lib/db';
import type { Product } from '../types';
import InventorySession from './InventorySession';

const HOST_ID = 'quimstock-inventory-entry';

export default function InventoryFeature() {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const stats = document.querySelector('.stats-grid');
    if (!stats?.parentElement) return undefined;

    let entryHost = document.getElementById(HOST_ID);
    const created = !entryHost;

    if (!entryHost) {
      entryHost = document.createElement('div');
      entryHost.id = HOST_ID;
    }

    stats.insertAdjacentElement('afterend', entryHost);
    setHost(entryHost);

    return () => {
      setHost(null);
      if (created) entryHost?.remove();
    };
  }, []);

  async function openInventory() {
    setLoading(true);
    try {
      setProducts(await listProducts());
      setOpen(true);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {host && createPortal(
        <section className="inventory-entry-panel" aria-label="Inventário temporário por QR Code">
          <div>
            <span className="eyebrow">CONFERÊNCIA DE ESTOQUE</span>
            <h2>Inventário por QR Code</h2>
            <p>Abra uma sessão separada para conferir o estoque físico sem alterar o banco de dados.</p>
          </div>
          <button className="inventory-entry-button" type="button" onClick={openInventory} disabled={loading}>
            <span aria-hidden="true">▦</span>
            {loading ? 'Abrindo inventário...' : 'Abrir inventário temporário'}
          </button>
        </section>,
        host,
      )}

      <InventorySession open={open} products={products} onClose={() => setOpen(false)} />
    </>
  );
}
