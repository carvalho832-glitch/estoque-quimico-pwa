import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import { listProducts, removeProduct, saveProduct } from './lib/db';
import { exportProductsToExcel } from './lib/excel';
import { formatDate, getExpiryLabel, getExpiryLevel } from './lib/expiry';
import { readLabel } from './lib/ocr';
import type { Product, ProductDraft } from './types';

const EMPTY_DRAFT: ProductDraft = {
  name: '',
  ecode: '',
  batch: '',
  expiryDate: '',
  quantity: 1,
  location: '',
  notes: '',
  imageName: '',
};

function createId(): string {
  return typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [draft, setDraft] = useState<ProductDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [ocrProgress, setOcrProgress] = useState<number | null>(null);
  const [ocrStatus, setOcrStatus] = useState('');
  const [message, setMessage] = useState('');

  async function refreshProducts() {
    setProducts(await listProducts());
  }

  useEffect(() => {
    refreshProducts()
      .catch(() => setMessage('Não foi possível carregar o estoque local.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const filteredProducts = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('pt-BR');
    if (!term) return products;
    return products.filter((product) =>
      [product.name, product.ecode, product.batch, product.location]
        .join(' ')
        .toLocaleLowerCase('pt-BR')
        .includes(term),
    );
  }, [products, query]);

  const stats = useMemo(() => {
    const expired = products.filter((product) => getExpiryLevel(product.expiryDate) === 'expired').length;
    const attention = products.filter((product) => ['critical', 'warning'].includes(getExpiryLevel(product.expiryDate))).length;
    return {
      total: products.length,
      units: products.reduce((sum, product) => sum + product.quantity, 0),
      expired,
      attention,
    };
  }, [products]);

  function updateDraft<K extends keyof ProductDraft>(field: K, value: ProductDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function handlePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setPhoto(file);
    updateDraft('imageName', file?.name ?? '');

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(file ? URL.createObjectURL(file) : '');
  }

  async function handleOcr() {
    if (!photo) {
      setMessage('Fotografe ou selecione um rótulo primeiro.');
      return;
    }

    setMessage('');
    setOcrProgress(0);
    setOcrStatus('Preparando leitura');

    try {
      const { fields } = await readLabel(photo, (progress, status) => {
        setOcrProgress(progress);
        setOcrStatus(status);
      });

      setDraft((current) => ({
        ...current,
        name: fields.name || current.name,
        ecode: fields.ecode || current.ecode,
        batch: fields.batch || current.batch,
        expiryDate: fields.expiryDate || current.expiryDate,
      }));
      setMessage('Leitura concluída. Confira e edite os campos antes de salvar.');
    } catch (error) {
      console.error(error);
      setMessage('Não foi possível ler o rótulo. Preencha os campos manualmente.');
    } finally {
      setOcrProgress(null);
      setOcrStatus('');
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');

    if (!draft.name.trim() || !draft.ecode.trim() || !draft.batch.trim() || !draft.expiryDate) {
      setMessage('Preencha nome, CEMB, lote e validade.');
      return;
    }

    const existing = editingId ? products.find((product) => product.id === editingId) : undefined;
    const now = new Date().toISOString();
    const product: Product = {
      ...draft,
      name: draft.name.trim(),
      ecode: draft.ecode.trim().toUpperCase(),
      batch: draft.batch.trim().toUpperCase(),
      quantity: Math.max(1, Number(draft.quantity) || 1),
      id: existing?.id ?? createId(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    const duplicate = products.find(
      (item) => item.id !== product.id && item.ecode.toUpperCase() === product.ecode && item.batch.toUpperCase() === product.batch,
    );
    if (duplicate && !window.confirm('Já existe um item com o mesmo CEMB e lote. Deseja salvar mesmo assim?')) return;

    await saveProduct(product);
    await refreshProducts();
    resetForm();
    setMessage(existing ? 'Produto atualizado.' : 'Produto salvo no aparelho.');
  }

  function resetForm() {
    setDraft(EMPTY_DRAFT);
    setEditingId(null);
    setPhoto(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl('');
  }

  function editProduct(product: Product) {
    const { id, createdAt, updatedAt, ...productDraft } = product;
    void id;
    void createdAt;
    void updatedAt;
    setDraft(productDraft);
    setEditingId(product.id);
    setPhoto(null);
    setPreviewUrl('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function deleteProduct(product: Product) {
    if (!window.confirm(`Excluir ${product.name}, lote ${product.batch}?`)) return;
    await removeProduct(product.id);
    await refreshProducts();
    if (editingId === product.id) resetForm();
    setMessage('Produto excluído.');
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <span className="eyebrow">ESTOQUE QUÍMICO</span>
          <h1>QuimStock</h1>
          <p>Câmera, conferência e Excel no mesmo frasco digital.</p>
        </div>
        <div className="header-badge" aria-label="Aplicativo instalável">PWA</div>
      </header>

      <main>
        <section className="stats-grid" aria-label="Resumo do estoque">
          <article><strong>{stats.total}</strong><span>Produtos</span></article>
          <article><strong>{stats.units}</strong><span>Unidades</span></article>
          <article><strong>{stats.attention}</strong><span>Atenção</span></article>
          <article className={stats.expired ? 'danger-card' : ''}><strong>{stats.expired}</strong><span>Vencidos</span></article>
        </section>

        <section className="panel">
          <div className="section-title">
            <div>
              <span className="eyebrow">CADASTRO</span>
              <h2>{editingId ? 'Editar produto' : 'Novo produto'}</h2>
            </div>
            {editingId && <button className="ghost-button" type="button" onClick={resetForm}>Cancelar edição</button>}
          </div>

          <div className="camera-area">
            <label className="camera-button">
              <span>📷</span>
              Fotografar rótulo
              <input type="file" accept="image/*" capture="environment" onChange={handlePhoto} />
            </label>
            <button className="secondary-button" type="button" onClick={handleOcr} disabled={!photo || ocrProgress !== null}>
              {ocrProgress !== null ? 'Lendo rótulo...' : 'Ler dados com OCR'}
            </button>
          </div>

          {previewUrl && <img className="label-preview" src={previewUrl} alt="Prévia do rótulo selecionado" />}

          {ocrProgress !== null && (
            <div className="progress-box">
              <progress max="1" value={ocrProgress} />
              <span>{ocrStatus} {Math.round(ocrProgress * 100)}%</span>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <label className="field field-wide">
                <span>Nome do produto * <small>(editável)</small></span>
                <input value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} placeholder="Ex.: ATR 1000" />
              </label>
              <label className="field">
                <span>CEMB *</span>
                <input value={draft.ecode} onChange={(event) => updateDraft('ecode', event.target.value)} placeholder="Ex.: 1453537" inputMode="numeric" />
              </label>
              <label className="field">
                <span>Lote *</span>
                <input value={draft.batch} onChange={(event) => updateDraft('batch', event.target.value)} placeholder="Ex.: C031996704" />
              </label>
              <label className="field">
                <span>Data de validade *</span>
                <input type="date" value={draft.expiryDate} onChange={(event) => updateDraft('expiryDate', event.target.value)} />
              </label>
              <label className="field">
                <span>Quantidade</span>
                <input type="number" min="1" value={draft.quantity} onChange={(event) => updateDraft('quantity', Number(event.target.value))} />
              </label>
              <label className="field field-wide">
                <span>Local de armazenamento</span>
                <input value={draft.location} onChange={(event) => updateDraft('location', event.target.value)} placeholder="Ex.: Armário 03, prateleira B" />
              </label>
              <label className="field field-wide">
                <span>Observações</span>
                <textarea value={draft.notes} onChange={(event) => updateDraft('notes', event.target.value)} rows={3} placeholder="Informações adicionais" />
              </label>
            </div>

            <p className="confirmation-note">⚠️ Confira e edite nome, CEMB, lote e validade. O OCR apenas sugere os dados.</p>
            <button className="primary-button" type="submit">{editingId ? 'Salvar alterações' : 'Confirmar e salvar'}</button>
          </form>

          {message && <p className="app-message" role="status">{message}</p>}
        </section>

        <section className="panel">
          <div className="section-title inventory-title">
            <div>
              <span className="eyebrow">INVENTÁRIO LOCAL</span>
              <h2>Produtos cadastrados</h2>
            </div>
            <button className="secondary-button" type="button" onClick={() => exportProductsToExcel(products)} disabled={!products.length}>
              Exportar Excel
            </button>
          </div>

          <label className="search-box">
            <span>🔎</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por produto, CEMB, lote ou local" />
          </label>

          {loading ? (
            <p className="empty-state">Carregando estoque...</p>
          ) : filteredProducts.length === 0 ? (
            <p className="empty-state">Nenhum produto encontrado.</p>
          ) : (
            <div className="product-list">
              {filteredProducts.map((product) => {
                const level = getExpiryLevel(product.expiryDate);
                return (
                  <article className="product-card" key={product.id}>
                    <div className="product-card-top">
                      <div>
                        <h3>{product.name}</h3>
                        <p>CEMB: <strong>{product.ecode}</strong> · Lote: <strong>{product.batch}</strong></p>
                      </div>
                      <span className={`status-badge status-${level}`}>{getExpiryLabel(product.expiryDate)}</span>
                    </div>
                    <dl>
                      <div><dt>Validade</dt><dd>{formatDate(product.expiryDate)}</dd></div>
                      <div><dt>Quantidade</dt><dd>{product.quantity}</dd></div>
                      <div><dt>Local</dt><dd>{product.location || 'Não informado'}</dd></div>
                    </dl>
                    {product.notes && <p className="notes">{product.notes}</p>}
                    <div className="card-actions">
                      <button type="button" className="ghost-button" onClick={() => editProduct(product)}>Editar</button>
                      <button type="button" className="delete-button" onClick={() => deleteProduct(product)}>Excluir</button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </main>

      <footer>Dados armazenados localmente neste aparelho · QuimStock MVP</footer>
    </div>
  );
}
