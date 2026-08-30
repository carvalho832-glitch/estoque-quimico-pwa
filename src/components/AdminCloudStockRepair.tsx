import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { deleteProductsPermanently, listProducts } from '../lib/db';
import { exportOrShareProductsToExcel } from '../lib/excel';
import { firebaseAuth } from '../lib/firebase';
import { rotateStockGeneration } from '../lib/stock-generation';
import type { Product } from '../types';
import './admin-cloud-stock-repair.css';

const CONFIRMATION_TEXT = 'LIMPAR ANTIGOS';

function productTimestamp(product: Product): number | null {
  const timestamp = Date.parse(product.createdAt || product.updatedAt || '');
  return Number.isNaN(timestamp) ? null : timestamp;
}

function formatTimestamp(product: Product): string {
  const timestamp = productTimestamp(product);
  if (timestamp === null) return 'Data de cadastro indisponível';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(timestamp));
}

function duplicateKey(product: Product): string {
  return `${product.ecode.trim().toUpperCase()}|${product.batch.trim().toUpperCase()}`;
}

function authErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';
  if (code.includes('invalid-credential') || code.includes('wrong-password')) return 'Senha incorreta. A limpeza não foi executada.';
  if (code.includes('network-request-failed')) return 'Sem conexão com a internet. A limpeza não foi executada.';
  return error instanceof Error ? error.message : 'Não foi possível concluir a limpeza do estoque.';
}

export default function AdminCloudStockRepair() {
  const [host, setHost] = useState<Element | null>(null);
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [cutoffDate, setCutoffDate] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setHost(document.querySelector('.app-shell main'));
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) setOpen(false);
    };
    window.addEventListener('keydown', handleEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleEscape);
    };
  }, [open, busy]);

  const cutoffTimestamp = useMemo(() => {
    if (!cutoffDate) return null;
    const timestamp = new Date(`${cutoffDate}T00:00:00`).getTime();
    return Number.isNaN(timestamp) ? null : timestamp;
  }, [cutoffDate]);

  const candidates = useMemo(() => {
    if (cutoffTimestamp === null) return [];
    return products
      .filter((product) => {
        const timestamp = productTimestamp(product);
        return timestamp !== null && timestamp < cutoffTimestamp;
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.ecode.localeCompare(b.ecode, 'pt-BR'));
  }, [products, cutoffTimestamp]);

  const duplicateGroups = useMemo(() => {
    const groups = new Map<string, number>();
    products.forEach((product) => groups.set(duplicateKey(product), (groups.get(duplicateKey(product)) ?? 0) + 1));
    return [...groups.values()].filter((count) => count > 1).length;
  }, [products]);

  useEffect(() => {
    setSelectedIds(new Set(candidates.map((product) => product.id)));
  }, [cutoffDate, products]);

  async function openDialog() {
    setBusy(true);
    setMessage('Carregando o estoque atual...');
    try {
      const currentProducts = await listProducts();
      setProducts(currentProducts);
      setCutoffDate('');
      setSelectedIds(new Set());
      setPassword('');
      setConfirmation('');
      setMessage('');
      setOpen(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível carregar o estoque atual.');
    } finally {
      setBusy(false);
    }
  }

  function closeDialog() {
    if (busy) return;
    setOpen(false);
    setPassword('');
    setConfirmation('');
    setMessage('');
  }

  function toggleCandidate(productId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(productId)) next.delete(productId);
      else next.add(productId);
      return next;
    });
  }

  async function performCleanup() {
    if (!cutoffDate || cutoffTimestamp === null) {
      setMessage('Informe a data em que o novo inventário começou.');
      return;
    }
    if (!selectedIds.size) {
      setMessage('Nenhum produto está marcado para remoção.');
      return;
    }
    if (confirmation.trim().toUpperCase() !== CONFIRMATION_TEXT) {
      setMessage(`Digite exatamente “${CONFIRMATION_TEXT}” para confirmar.`);
      return;
    }

    const auth = firebaseAuth;
    const user = auth?.currentUser;
    if (!auth || !user?.email) {
      setMessage('A conta do QuimStock precisa estar conectada para fazer a limpeza.');
      return;
    }

    setBusy(true);
    setMessage('Validando senha administrativa...');
    try {
      const credential = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(user, credential);

      setMessage('Senha confirmada. Gerando backup completo dos produtos atuais...');
      const backupResult = await exportOrShareProductsToExcel(products, {
        title: 'BACKUP ANTES DA LIMPEZA DO ESTOQUE RECUPERADO',
        revision: 'RECUPERACAO',
      });

      if (backupResult === 'cancelled') {
        setMessage('O backup foi cancelado. Nenhum produto foi removido.');
        return;
      }

      setMessage('Protegendo a nova geração do estoque...');
      await rotateStockGeneration(user.uid);

      setMessage(`Removendo ${selectedIds.size} registro(s) antigo(s) marcados...`);
      const removed = await deleteProductsPermanently([...selectedIds]);

      window.localStorage.removeItem('quimstock-temporary-inventory-v1');
      window.dispatchEvent(new CustomEvent('quimstock:products-changed'));
      setMessage(`${removed} registro(s) removido(s). O estoque atual foi preservado e protegido contra restauração antiga.`);
      window.setTimeout(() => window.location.reload(), 2200);
    } catch (error) {
      console.error(error);
      setMessage(authErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  if (!host) return null;

  const keepCount = products.length - selectedIds.size;

  return createPortal(
    <>
      <section className="panel cloud-repair-panel" aria-labelledby="cloud-repair-title">
        <div>
          <span className="eyebrow">MANUTENÇÃO DA NUVEM</span>
          <h2 id="cloud-repair-title">Corrigir estoque recuperado</h2>
          <p>Use apenas quando um estoque antigo reaparecer e se misturar ao inventário atual.</p>
        </div>
        <button className="cloud-repair-open" type="button" onClick={() => void openDialog()} disabled={busy}>
          <span aria-hidden="true">☁️</span>
          Analisar estoque
        </button>
      </section>

      {open && (
        <div className="cloud-repair-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) closeDialog();
        }}>
          <section className="cloud-repair-dialog" role="dialog" aria-modal="true" aria-labelledby="cloud-repair-dialog-title">
            <header className="cloud-repair-header">
              <div>
                <span className="eyebrow">RECUPERAÇÃO CONTROLADA</span>
                <h2 id="cloud-repair-dialog-title">Separar estoque antigo do novo</h2>
                <p>Nada é apagado automaticamente. Você escolhe a data, revisa e pode desmarcar qualquer produto.</p>
              </div>
              <button type="button" onClick={closeDialog} disabled={busy} aria-label="Fechar limpeza do estoque">✕</button>
            </header>

            <div className="cloud-repair-summary">
              <div><strong>{products.length}</strong><span>registros atuais</span></div>
              <div><strong>{duplicateGroups}</strong><span>grupo(s) E-code + lote duplicados</span></div>
              <div className="keep"><strong>{cutoffDate ? keepCount : '—'}</strong><span>serão preservados</span></div>
              <div className="remove"><strong>{cutoffDate ? selectedIds.size : '—'}</strong><span>marcados para remover</span></div>
            </div>

            <label className="cloud-repair-cutoff">
              <span>Em que dia começou o inventário novo?</span>
              <input
                type="date"
                value={cutoffDate}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(event) => setCutoffDate(event.target.value)}
                disabled={busy}
              />
              <small>Produtos cadastrados antes deste dia entram como suspeitos. Os cadastrados neste dia ou depois são preservados.</small>
            </label>

            {cutoffDate && (
              <section className="cloud-repair-review" aria-label="Produtos antigos candidatos à remoção">
                <div className="cloud-repair-review-title">
                  <div>
                    <strong>Revise antes de limpar</strong>
                    <span>{candidates.length} produto(s) anteriores à data informada.</span>
                  </div>
                  <button type="button" onClick={() => setSelectedIds(new Set(candidates.map((product) => product.id)))} disabled={busy}>Marcar todos</button>
                </div>

                {candidates.length === 0 ? (
                  <p className="cloud-repair-empty">Nenhum cadastro anterior a essa data foi encontrado.</p>
                ) : (
                  <div className="cloud-repair-list">
                    {candidates.map((product) => (
                      <label className="cloud-repair-item" key={product.id}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(product.id)}
                          onChange={() => toggleCandidate(product.id)}
                          disabled={busy}
                        />
                        <span>
                          <strong>{product.name}</strong>
                          <small>E-code {product.ecode} · Lote {product.batch} · cadastrado {formatTimestamp(product)}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </section>
            )}

            {cutoffDate && selectedIds.size > 0 && (
              <section className="cloud-repair-security">
                <div className="cloud-repair-warning">
                  <strong>Backup obrigatório antes de apagar</strong>
                  <span>O QuimStock salvará os {products.length} registros atuais em Excel antes de executar qualquer exclusão.</span>
                </div>

                <label>
                  <span>Senha da conta QuimStock</span>
                  <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} disabled={busy} autoComplete="current-password" />
                </label>
                <label>
                  <span>Confirmação</span>
                  <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} disabled={busy} placeholder={CONFIRMATION_TEXT} autoComplete="off" />
                  <small>Digite exatamente: <strong>{CONFIRMATION_TEXT}</strong></small>
                </label>

                <button
                  className="cloud-repair-danger"
                  type="button"
                  onClick={() => void performCleanup()}
                  disabled={busy || !password || !confirmation.trim()}
                >
                  {busy ? 'Processando com segurança...' : `Fazer backup e remover ${selectedIds.size} registro(s) marcado(s)`}
                </button>
              </section>
            )}

            {message && <p className="cloud-repair-message" role="status">{message}</p>}
          </section>
        </div>
      )}
    </>,
    host,
  );
}
