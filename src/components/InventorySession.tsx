import { useEffect, useMemo, useState } from 'react';
import type { Product } from '../types';
import './InventorySession.css';

type InventoryStatus = 'ready' | 'counting' | 'review';

export type TemporaryInventoryRow = {
  productId: string;
  ecode: string;
  name: string;
  batch: string;
  expiryDate: string;
  systemQuantity: number;
  countedQuantity: number;
};

type TemporaryInventorySession = {
  status: InventoryStatus;
  startedAt: string;
  rows: TemporaryInventoryRow[];
};

type InventorySessionProps = {
  open: boolean;
  products: Product[];
  onClose: () => void;
};

const STORAGE_KEY = 'quimstock-temporary-inventory-v1';
const EMPTY_SESSION: TemporaryInventorySession = {
  status: 'ready',
  startedAt: '',
  rows: [],
};

function loadSession(): TemporaryInventorySession {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return EMPTY_SESSION;

    const parsed = JSON.parse(stored) as Partial<TemporaryInventorySession>;
    if (!Array.isArray(parsed.rows)) return EMPTY_SESSION;

    return {
      status: parsed.status === 'counting' || parsed.status === 'review' ? parsed.status : 'ready',
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
      rows: parsed.rows,
    };
  } catch {
    return EMPTY_SESSION;
  }
}

function formatStartedAt(value: string): string {
  if (!value) return 'Ainda não iniciado';

  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatExpiryDate(value: string): string {
  if (!value) return 'Não informada';
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}

export default function InventorySession({ open, products, onClose }: InventorySessionProps) {
  const [session, setSession] = useState<TemporaryInventorySession>(() => loadSession());
  const [message, setMessage] = useState('');

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }, [session]);

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose]);

  const totals = useMemo(() => {
    const countedUnits = session.rows.reduce((sum, row) => sum + row.countedQuantity, 0);
    const divergences = session.rows.filter((row) => row.systemQuantity !== row.countedQuantity).length;

    return {
      countedUnits,
      lots: session.rows.length,
      divergences,
    };
  }, [session.rows]);

  if (!open) return null;

  function startInventory() {
    setSession({
      status: 'counting',
      startedAt: new Date().toISOString(),
      rows: [],
    });
    setMessage('Sessão temporária iniciada. Nenhuma quantidade do estoque foi alterada.');
  }

  function finishReading() {
    if (!session.rows.length) {
      setMessage('Ainda não há itens na conferência. O leitor contínuo será conectado na Fase 2.');
      return;
    }

    setSession((current) => ({ ...current, status: 'review' }));
    setMessage('Leitura finalizada. Revise os dados antes de atualizar o estoque.');
  }

  function resumeReading() {
    setSession((current) => ({ ...current, status: 'counting' }));
    setMessage('Conferência reaberta para novas leituras.');
  }

  function cancelInventory() {
    if (
      (session.status !== 'ready' || session.rows.length > 0)
      && !window.confirm('Cancelar e apagar toda a conferência temporária? O estoque não será alterado.')
    ) {
      return;
    }

    setSession(EMPTY_SESSION);
    window.localStorage.removeItem(STORAGE_KEY);
    setMessage('Inventário temporário cancelado. Nenhum dado do estoque foi modificado.');
  }

  const statusLabel = session.status === 'counting'
    ? 'Leitura em andamento'
    : session.status === 'review'
      ? 'Aguardando revisão'
      : 'Pronto para iniciar';

  return (
    <div className="inventory-window-backdrop" role="presentation">
      <section className="inventory-window" role="dialog" aria-modal="true" aria-labelledby="temporary-inventory-title">
        <header className="inventory-window-header">
          <div>
            <span className="eyebrow">CONFERÊNCIA FÍSICA</span>
            <h2 id="temporary-inventory-title">Inventário temporário</h2>
            <p>Confira E-code, lote, validade e quantidade antes de gravar qualquer alteração.</p>
          </div>
          <button className="inventory-window-close" type="button" onClick={onClose} aria-label="Fechar janela de inventário">✕</button>
        </header>

        <div className="inventory-session-strip">
          <div>
            <span>Status</span>
            <strong>{statusLabel}</strong>
          </div>
          <div>
            <span>Início</span>
            <strong>{formatStartedAt(session.startedAt)}</strong>
          </div>
          <div>
            <span>Cadastros no QuimStock</span>
            <strong>{products.length}</strong>
          </div>
        </div>

        <div className="inventory-summary-grid" aria-label="Resumo da conferência temporária">
          <article><strong>{totals.countedUnits}</strong><span>Unidades conferidas</span></article>
          <article><strong>{totals.lots}</strong><span>Lotes distintos</span></article>
          <article><strong>{totals.divergences}</strong><span>Divergências</span></article>
        </div>

        {session.status === 'ready' ? (
          <div className="inventory-start-state">
            <div className="inventory-start-icon" aria-hidden="true">▦</div>
            <h3>Começar uma nova conferência</h3>
            <p>A sessão ficará separada do estoque oficial. Fechar esta janela não apaga o trabalho temporário.</p>
            <button className="inventory-main-action" type="button" onClick={startInventory}>Iniciar inventário</button>
          </div>
        ) : (
          <>
            <div className="inventory-phase-notice">
              <strong>Estrutura da Fase 1 ativa</strong>
              <span>O leitor contínuo de QR Code será conectado nesta janela na Fase 2.</span>
            </div>

            <div className="inventory-table-wrap">
              <table className="inventory-review-table">
                <thead>
                  <tr>
                    <th>E-code</th>
                    <th>Produto</th>
                    <th>Lote</th>
                    <th>Validade</th>
                    <th>Sistema</th>
                    <th>Conferido</th>
                  </tr>
                </thead>
                <tbody>
                  {session.rows.length ? session.rows.map((row) => (
                    <tr key={`${row.productId}-${row.batch}`}>
                      <td data-label="E-code">{row.ecode}</td>
                      <td data-label="Produto">{row.name}</td>
                      <td data-label="Lote">{row.batch}</td>
                      <td data-label="Validade">{formatExpiryDate(row.expiryDate)}</td>
                      <td data-label="Sistema">{row.systemQuantity}</td>
                      <td data-label="Conferido">{row.countedQuantity}</td>
                    </tr>
                  )) : (
                    <tr>
                      <td className="inventory-empty-row" colSpan={6}>
                        Nenhum QR Code contabilizado nesta sessão.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {message && <p className="inventory-window-message" role="status">{message}</p>}

        <footer className="inventory-window-actions">
          <button className="inventory-cancel-action" type="button" onClick={cancelInventory}>Cancelar inventário</button>
          <div>
            {session.status === 'counting' && (
              <button className="inventory-secondary-action" type="button" onClick={finishReading}>Finalizar leitura</button>
            )}
            {session.status === 'review' && (
              <button className="inventory-secondary-action" type="button" onClick={resumeReading}>Continuar leitura</button>
            )}
            <button
              className="inventory-update-action"
              type="button"
              disabled={session.status !== 'review' || !session.rows.length}
              title="Será habilitado após a leitura e revisão dos itens"
            >
              Atualizar estoque
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
