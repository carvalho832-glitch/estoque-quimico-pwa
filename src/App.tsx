import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from 'react';
import QrLiveScanner from './components/QrLiveScanner';
import { listProducts, removeProduct, saveProduct } from './lib/db';
import { exportProductsToPdf } from './lib/excel';
import { formatDate, getExpiryLabel, getExpiryLevel } from './lib/expiry';
import { readLabel } from './lib/ocr';
import { parseInventoryQr, readInventoryQr } from './lib/qr';
import type { InventoryQrData, Product, ProductDraft } from './types';

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

function productToDraft(product: Product): ProductDraft {
  const { id, createdAt, updatedAt, ...draft } = product;
  void id;
  void createdAt;
  void updatedAt;
  return draft;
}

function releasePreview(url: string): void {
  if (url.startsWith('blob:')) URL.revokeObjectURL(url);
}

export default function App() {
  const [products, setProducts] = useState<Product[]>([]);
  const [draft, setDraft] = useState<ProductDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState('');
  const [qrRead, setQrRead] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [qrLoading, setQrLoading] = useState(false);
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
    return () => releasePreview(previewUrl);
  }, [previewUrl]);

  const filteredProducts = useMemo(() => {
    const term = query.trim().toLocaleLowerCase('pt-BR');
    if (!term) return products;

    return products.filter((product) =>
      [product.name, product.ecode, product.docmat, product.batch, product.location]
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

  function applyQrData(qr: InventoryQrData, imageName: string) {
    const existing = products.find(
      (product) => product.ecode.toUpperCase() === qr.ecode && product.batch.toUpperCase() === qr.batch,
    );
    const knownProduct = existing ?? products.find((product) => product.ecode.toUpperCase() === qr.ecode);
    const baseDraft = existing ? productToDraft(existing) : draft;

    setDraft({
      ...baseDraft,
      name: existing?.name || draft.name || knownProduct?.name || '',
      ecode: qr.ecode,
      docmat: qr.docmat,
      batch: qr.batch,
      supplierBatch: qr.supplierBatch,
      packageVolume: qr.packageVolume,
      qrPrefix: qr.prefix,
      qrRaw: qr.raw,
      expiryDate: qr.expiryDate || existing?.expiryDate || draft.expiryDate,
      quantity: existing?.quantity ?? draft.quantity ?? 1,
      location: existing?.location ?? draft.location ?? '',
      notes: existing?.notes ?? draft.notes ?? '',
      imageName,
    });

    setEditingId(existing?.id ?? null);
    setQrRead(true);

    if (existing) {
      setMessage('QR lido automaticamente. O registro existente foi aberto para atualização. Confira a DV.');
    } else if (qr.expiryDate) {
      setMessage('QR lido automaticamente. Ecode/Material, lote e DV foram preenchidos.');
    } else {
      setMessage('QR lido automaticamente. Ecode/Material e lote foram preenchidos. Informe a DV.');
    }
  }

  function handlePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setPhoto(file);
    setQrRead(false);
    updateDraft('imageName', file?.name ?? '');

    releasePreview(previewUrl);
    setPreviewUrl(file ? URL.createObjectURL(file) : '');
    setMessage(file ? 'Foto carregada. Toque em “Ler QR da foto”.' : '');
  }

  async function handleQrPhoto() {
    if (!photo) {
      setMessage('Selecione uma foto da etiqueta com QR Code primeiro.');
      return;
    }

    setMessage('');
    setQrLoading(true);

    try {
      const qr = await readInventoryQr(photo);
      applyQrData(qr, photo.name);
    } catch (error) {
      console.error(error);
      setQrRead(false);
      setMessage(error instanceof Error ? error.message : 'Não foi possível ler o QR Code.');
    } finally {
      setQrLoading(false);
    }
  }

  function handleLiveQr(rawValue: string, snapshotDataUrl: string) {
    try {
      const qr = parseInventoryQr(rawValue);
      releasePreview(previewUrl);
      setPreviewUrl(snapshotDataUrl);
      setPhoto(null);
      setScannerOpen(false);
      applyQrData(qr, 'captura-qr-camera.jpg');
    } catch (error) {
      console.error(error);
      setScannerOpen(false);
      setQrRead(false);
      setMessage(error instanceof Error ? error.message : 'O QR Code lido não possui o formato esperado.');
    }
  }

  async function handleOcr() {
    if (!photo) {
      setMessage('Selecione uma foto do rótulo primeiro.');
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
        notes: fields.notes || current.notes,
      }));
      setMessage('OCR concluído. Confira Ecode/Material, lote e DV antes de salvar.');
    } catch (error) {
      console.error(error);
      setMessage('Não foi possível ler o texto do rótulo. Preencha os campos manualmente.');
    } finally {
      setOcrProgress(null);
      setOcrStatus('');
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage('');

    if (!draft.ecode.trim() || !draft.batch.trim() || !draft.expiryDate) {
      setMessage('Preencha Ecode/Material, lote e DV.');
      return;
    }

    const existing = editingId ? products.find((product) => product.id === editingId) : undefined;
    const now = new Date().toISOString();
    const ecode = draft.ecode.trim().toUpperCase();
    const product: Product = {
      ...draft,
      name: draft.name.trim() || `Material ${ecode}`,
      ecode,
      batch: draft.batch.trim().toUpperCase(),
      quantity: Math.max(1, Number(draft.quantity) || 1),
      id: existing?.id ?? createId(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    const duplicate = products.find(
      (item) => item.id !== product.id && item.ecode.toUpperCase() === product.ecode && item.batch.toUpperCase() === product.batch,
    );

    if (duplicate) {
      setMessage('Este Ecode/Material e lote já estão cadastrados. Abra o registro existente para atualizar.');
      return;
    }

    await saveProduct(product);
    await refreshProducts();
    resetForm();
    setMessage(existing ? 'Estoque atualizado.' : 'Produto cadastrado no estoque.');
  }

  function resetForm() {
    setDraft(EMPTY_DRAFT);
    setEditingId(null);
    setPhoto(null);
    setQrRead(false);
    setScannerOpen(false);
    releasePreview(previewUrl);
    setPreviewUrl('');
  }

  function editProduct(product: Product) {
    setDraft(productToDraft(product));
    setEditingId(product.id);
    setPhoto(null);
    setQrRead(false);
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
      {scannerOpen && <QrLiveScanner onDetected={handleLiveQr} onClose={() => setScannerOpen(false)} />}

      <header className="app-header">
        <div>
          <span className="eyebrow">ESTOQUE QUÍMICO</span>
          <h1>QuimStock</h1>
          <p>QR Code, conferência e PDF no mesmo frasco digital.</p>
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
              <span className="eyebrow">CADASTRO E ATUALIZAÇÃO</span>
              <h2>{editingId ? 'Atualizar produto' : 'Escanear produto'}</h2>
            </div>
            {editingId && <button className="ghost-button" type="button" onClick={resetForm}>Cancelar edição</button>}
          </div>

          <button className="live-scanner-button" type="button" onClick={() => setScannerOpen(true)}>
            <span className="live-scanner-icon">▣</span>
            <span><strong>Abrir leitor QR</strong><small>Aponte para o código e aguarde a leitura automática</small></span>
          </button>

          <details className="alternative-reader">
            <summary>Usar foto ou OCR como alternativa</summary>
            <div className="camera-area">
              <label className="secondary-button photo-picker">
                <span>📷</span>
                Selecionar foto
                <input type="file" accept="image/*" capture="environment" onChange={handlePhoto} />
              </label>
              <button className="secondary-button" type="button" onClick={handleQrPhoto} disabled={!photo || qrLoading}>
                {qrLoading ? 'Lendo QR...' : 'Ler QR da foto'}
              </button>
              <button className="ghost-button" type="button" onClick={handleOcr} disabled={!photo || ocrProgress !== null}>
                {ocrProgress !== null ? 'Lendo texto...' : 'Usar OCR'}
              </button>
            </div>
          </details>

          {previewUrl && !qrRead && <img className="label-preview" src={previewUrl} alt="Foto da etiqueta selecionada" />}

          {qrRead && (
            <article className="identified-product">
              {previewUrl && <img src={previewUrl} alt="Foto do produto identificado pelo QR Code" />}
              <div>
                <span className="eyebrow">PRODUTO IDENTIFICADO</span>
                <h3>{draft.name || `Material ${draft.ecode}`}</h3>
                <dl>
                  <div><dt>Ecode/Material</dt><dd>{draft.ecode}</dd></div>
                  <div><dt>Lote</dt><dd>{draft.batch}</dd></div>
                  <div><dt>DV</dt><dd>{draft.expiryDate ? formatDate(draft.expiryDate) : 'Informe abaixo'}</dd></div>
                </dl>
              </div>
            </article>
          )}

          {ocrProgress !== null && (
            <div className="progress-box">
              <progress max="1" value={ocrProgress} />
              <span>{ocrStatus} {Math.round(ocrProgress * 100)}%</span>
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="form-grid">
              <label className="field">
                <span>Ecode/Material *</span>
                <input value={draft.ecode} onChange={(event) => updateDraft('ecode', event.target.value)} placeholder="Ex.: 7380733" inputMode="numeric" />
              </label>
              <label className="field">
                <span>Lote *</span>
                <input value={draft.batch} onChange={(event) => updateDraft('batch', event.target.value)} placeholder="Ex.: C032408071" />
              </label>
              <label className="field field-wide important-field">
                <span>DV, data de validade *</span>
                <input type="date" value={draft.expiryDate} onChange={(event) => updateDraft('expiryDate', event.target.value)} />
              </label>
              <label className="field field-wide">
                <span>Nome do produto <small>(opcional e editável)</small></span>
                <input value={draft.name} onChange={(event) => updateDraft('name', event.target.value)} placeholder="Ex.: Reducer PU Varnish 150" />
              </label>
              <label className="field">
                <span>Quantidade</span>
                <input type="number" min="1" value={draft.quantity} onChange={(event) => updateDraft('quantity', Number(event.target.value))} />
              </label>
              <label className="field">
                <span>Docmat</span>
                <input value={draft.docmat ?? ''} onChange={(event) => updateDraft('docmat', event.target.value)} placeholder="Preenchido pelo QR" />
              </label>
              <label className="field field-wide">
                <span>Local de armazenamento</span>
                <input value={draft.location} onChange={(event) => updateDraft('location', event.target.value)} placeholder="Ex.: Prateleira 1" />
              </label>
              <label className="field field-wide">
                <span>Observações</span>
                <textarea value={draft.notes} onChange={(event) => updateDraft('notes', event.target.value)} rows={3} placeholder="Informações adicionais" />
              </label>
            </div>

            <p className="confirmation-note">⚠️ Confira Ecode/Material, lote e DV. São os três campos principais do estoque.</p>
            <button className="primary-button" type="submit">{editingId ? 'Atualizar estoque' : 'Confirmar e cadastrar'}</button>
          </form>

          {message && <p className="app-message" role="status">{message}</p>}
        </section>

        <section className="panel">
          <div className="section-title inventory-title">
            <div>
              <span className="eyebrow">INVENTÁRIO LOCAL</span>
              <h2>Produtos cadastrados</h2>
            </div>
            <button className="secondary-button" type="button" onClick={() => exportProductsToPdf(products)} disabled={!products.length}>
              Gerar PDF
            </button>
          </div>

          <label className="search-box">
            <span>🔎</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por Ecode, lote, Docmat ou produto" />
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
                        <p>Ecode/Material: <strong>{product.ecode}</strong> · Lote: <strong>{product.batch}</strong></p>
                      </div>
                      <span className={`status-badge status-${level}`}>{getExpiryLabel(product.expiryDate)}</span>
                    </div>
                    <dl>
                      <div><dt>DV</dt><dd>{formatDate(product.expiryDate)}</dd></div>
                      <div><dt>Quantidade</dt><dd>{product.quantity}</dd></div>
                      <div><dt>Local</dt><dd>{product.location || 'Não informado'}</dd></div>
                    </dl>
                    {product.docmat && <p className="notes">Docmat: {product.docmat}</p>}
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
