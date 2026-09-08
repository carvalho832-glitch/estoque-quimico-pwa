import { useEffect, useMemo, useState } from 'react';
import { removeProduct, saveProductsBatch } from '../lib/db';
import { parseInventoryQr } from '../lib/qr';
import type { Product } from '../types';
import InventoryManualEntry, {
  MANUAL_ENTRY_REASON_LABELS,
  type ManualEntryReason,
} from './InventoryManualEntry';
import InventoryQrScanner from './InventoryQrScanner';
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
  qrCount?: number;
  manualCount?: number;
  manualReasons?: ManualEntryReason[];
  registeredAtStart: boolean;
  protectedInUse: boolean;
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

const STORAGE_KEY = 'quimstock-temporary-inventory-v2';
const EMPTY_SESSION: TemporaryInventorySession = {
  status: 'ready',
  startedAt: '',
  rows: [],
};

function isManualEntryReason(value: unknown): value is ManualEntryReason {
  return value === 'damaged-qr' || value === 'missing-qr';
}

function loadSession(): TemporaryInventorySession {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (!stored) return EMPTY_SESSION;

    const parsed = JSON.parse(stored) as Partial<TemporaryInventorySession>;
    if (!Array.isArray(parsed.rows)) return EMPTY_SESSION;

    const rows = parsed.rows.map((row) => {
      const countedQuantity = Math.max(0, Number(row.countedQuantity) || 0);
      const savedQrCount = Math.max(0, Number(row.qrCount) || 0);
      const savedManualCount = Math.max(0, Number(row.manualCount) || 0);
      const hasSavedOrigin = savedQrCount > 0 || savedManualCount > 0;

      return {
        ...row,
        countedQuantity,
        qrCount: hasSavedOrigin ? savedQrCount : countedQuantity,
        manualCount: savedManualCount,
        manualReasons: Array.isArray(row.manualReasons)
          ? row.manualReasons.filter(isManualEntryReason)
          : [],
        registeredAtStart: row.registeredAtStart !== false,
        protectedInUse: row.protectedInUse === true,
      } as TemporaryInventoryRow;
    });

    return {
      status: parsed.status === 'counting' || parsed.status === 'review' ? parsed.status : 'ready',
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
      rows,
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
  if (!value) return 'Não cadastrada';
  const [year, month, day] = value.split('-');
  return year && month && day ? `${day}/${month}/${year}` : value;
}

function normalize(value: string): string {
  return value.trim().toUpperCase();
}

function productIsInUse(product: Product): boolean {
  return product.availabilityStatus === 'in-use';
}

function productToInventoryRow(product: Product): TemporaryInventoryRow {
  return {
    productId: product.id,
    ecode: product.ecode,
    name: product.name,
    batch: product.batch,
    expiryDate: product.expiryDate,
    systemQuantity: product.quantity,
    countedQuantity: 0,
    qrCount: 0,
    manualCount: 0,
    manualReasons: [],
    registeredAtStart: true,
    protectedInUse: productIsInUse(product),
  };
}

export default function InventorySession({ open, products, onClose }: InventorySessionProps) {
  const [session, setSession] = useState<TemporaryInventorySession>(() => loadSession());
  const [message, setMessage] = useState('');
  const [scannerOpen, setScannerOpen] = useState(false);
  const [manualEntryOpen, setManualEntryOpen] = useState(false);
  const [updating, setUpdating] = useState(false);

  const productsById = useMemo(
    () => new Map(products.map((product) => [product.id, product])),
    [products],
  );

  const snapshotProductIds = useMemo(
    () => new Set(session.rows.filter((row) => row.registeredAtStart).map((row) => row.productId)),
    [session.rows],
  );

  const manualEntryProducts = useMemo(
    () => products.filter((product) => snapshotProductIds.has(product.id)),
    [products, snapshotProductIds],
  );

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }, [session]);

  useEffect(() => {
    if (!open) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !scannerOpen && !manualEntryOpen && !updating) onClose();
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, onClose, scannerOpen, manualEntryOpen, updating]);

  const totals = useMemo(() => {
    const countedUnits = session.rows.reduce((sum, row) => sum + row.countedQuantity, 0);
    const foundLots = session.rows.filter((row) => row.countedQuantity > 0).length;
    const divergences = session.rows.filter((row) => {
      if (!row.registeredAtStart) return row.countedQuantity > 0;
      if (row.protectedInUse) return false;
      return row.systemQuantity !== row.countedQuantity;
    }).length;

    return {
      countedUnits,
      foundLots,
      divergences,
    };
  }, [session.rows]);

  const unregisteredCount = useMemo(
    () => session.rows.filter((row) => !row.registeredAtStart && row.countedQuantity > 0).length,
    [session.rows],
  );

  const missingCount = useMemo(
    () => session.rows.filter(
      (row) => row.registeredAtStart && !row.protectedInUse && row.countedQuantity === 0,
    ).length,
    [session.rows],
  );

  const protectedInUseCount = useMemo(
    () => session.rows.filter((row) => row.registeredAtStart && row.protectedInUse).length,
    [session.rows],
  );

  if (!open) return null;

  function startInventory() {
    const snapshotRows = products.map(productToInventoryRow);

    setSession({
      status: 'counting',
      startedAt: new Date().toISOString(),
      rows: snapshotRows,
    });
    window.localStorage.removeItem('quimstock-temporary-inventory-v1');
    setMessage(
      `Fotografia do estoque criada com ${snapshotRows.length} lote(s). Agora as leituras representam o que foi encontrado fisicamente.`,
    );
    setManualEntryOpen(false);
    setScannerOpen(true);
  }

  function countQrCode(rawValue: string) {
    try {
      const qr = parseInventoryQr(rawValue);
      const matchingRows = session.rows.filter(
        (row) => normalize(row.ecode) === qr.ecode && normalize(row.batch) === qr.batch,
      );
      const targetRow = matchingRows.find((row) => !row.protectedInUse) ?? matchingRows[0];
      const knownProduct = products.find((product) => normalize(product.ecode) === qr.ecode);
      const rowId = targetRow?.productId ?? `not-registered:${qr.ecode}:${qr.batch}`;
      const nextQuantity = (targetRow?.countedQuantity ?? 0) + 1;

      setSession((current) => {
        const currentMatches = current.rows.filter(
          (row) => normalize(row.ecode) === qr.ecode && normalize(row.batch) === qr.batch,
        );
        const currentTarget = currentMatches.find((row) => !row.protectedInUse) ?? currentMatches[0];

        if (currentTarget) {
          return {
            ...current,
            status: 'counting',
            rows: current.rows.map((row) => (
              row.productId === currentTarget.productId
                ? {
                    ...row,
                    countedQuantity: row.countedQuantity + 1,
                    qrCount: (row.qrCount ?? 0) + 1,
                  }
                : row
            )),
          };
        }

        const existingUnknown = current.rows.find((row) => row.productId === rowId);
        if (existingUnknown) {
          return {
            ...current,
            status: 'counting',
            rows: current.rows.map((row) => (
              row.productId === rowId
                ? {
                    ...row,
                    countedQuantity: row.countedQuantity + 1,
                    qrCount: (row.qrCount ?? 0) + 1,
                  }
                : row
            )),
          };
        }

        const newRow: TemporaryInventoryRow = {
          productId: rowId,
          ecode: qr.ecode,
          name: knownProduct?.name ?? 'Produto não cadastrado',
          batch: qr.batch,
          expiryDate: '',
          systemQuantity: 0,
          countedQuantity: 1,
          qrCount: 1,
          manualCount: 0,
          manualReasons: [],
          registeredAtStart: false,
          protectedInUse: false,
        };

        return { ...current, status: 'counting', rows: [...current.rows, newRow] };
      });

      if (targetRow) {
        if (targetRow.protectedInUse) {
          setMessage(`${targetRow.name}, lote ${qr.batch}: leitura registrada, mas o item está marcado como Em uso e será preservado.`);
        } else {
          setMessage(`${targetRow.name}, lote ${qr.batch}: ${nextQuantity} unidade(s) encontrada(s) fisicamente.`);
        }
      } else if (knownProduct) {
        setMessage(`Lote ${qr.batch} do E-code ${qr.ecode} não fazia parte da fotografia inicial. A leitura foi separada para revisão.`);
      } else {
        setMessage(`E-code ${qr.ecode}, lote ${qr.batch}, não estava cadastrado no início do inventário. A leitura foi separada para revisão.`);
      }
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : 'O QR Code lido não possui o formato esperado.');
    }
  }

  function addManualProduct(productId: string, quantity: number, reason: ManualEntryReason) {
    const product = productsById.get(productId);
    if (!product || !snapshotProductIds.has(productId)) {
      setMessage('O produto selecionado não fazia parte da fotografia inicial deste inventário.');
      return;
    }

    const safeQuantity = Math.max(1, Math.floor(Number(quantity) || 1));

    setSession((current) => {
      const existingIndex = current.rows.findIndex((row) => row.productId === product.id);
      if (existingIndex < 0) return current;

      const rows = [...current.rows];
      const currentReasons = rows[existingIndex].manualReasons ?? [];
      rows[existingIndex] = {
        ...rows[existingIndex],
        countedQuantity: rows[existingIndex].countedQuantity + safeQuantity,
        manualCount: (rows[existingIndex].manualCount ?? 0) + safeQuantity,
        manualReasons: currentReasons.includes(reason)
          ? currentReasons
          : [...currentReasons, reason],
      };
      return { ...current, rows };
    });

    if (productIsInUse(product)) {
      setMessage(`${product.name}, lote ${product.batch}: leitura manual registrada, mas o item Em uso será preservado sem alteração.`);
    } else {
      setMessage(`${product.name}, lote ${product.batch}: ${safeQuantity} unidade(s) adicionada(s) à contagem por “${MANUAL_ENTRY_REASON_LABELS[reason]}”.`);
    }
  }

  function changeCount(productId: string, delta: number) {
    if (updating) return;

    setSession((current) => {
      const row = current.rows.find((item) => item.productId === productId);
      if (!row) return current;

      const nextQuantity = Math.max(0, row.countedQuantity + delta);

      if (!row.registeredAtStart && nextQuantity === 0) {
        return { ...current, rows: current.rows.filter((item) => item.productId !== productId) };
      }

      return {
        ...current,
        rows: current.rows.map((item) => (
          item.productId === productId ? { ...item, countedQuantity: nextQuantity } : item
        )),
      };
    });
  }

  function finishReading() {
    if (!session.rows.length) {
      setMessage('Não há itens na fotografia inicial nem leituras para revisar.');
      return;
    }

    setScannerOpen(false);
    setManualEntryOpen(false);
    setSession((current) => ({ ...current, status: 'review' }));
    setMessage('Leitura finalizada. Revise encontrados, divergências e itens não encontrados antes de concluir.');
  }

  function resumeReading() {
    setSession((current) => ({ ...current, status: 'counting' }));
    setMessage('Conferência reaberta para novas leituras.');
    setScannerOpen(true);
  }

  function cancelInventory() {
    if (updating) return;

    if (
      (session.status !== 'ready' || session.rows.length > 0)
      && !window.confirm('Cancelar e apagar toda a conferência temporária? O estoque oficial não será alterado.')
    ) {
      return;
    }

    setScannerOpen(false);
    setManualEntryOpen(false);
    setSession(EMPTY_SESSION);
    window.localStorage.removeItem(STORAGE_KEY);
    setMessage('Inventário temporário cancelado. Nenhum dado do estoque oficial foi modificado.');
  }

  async function updateStock() {
    if (updating || session.status !== 'review' || !session.rows.length) return;

    const unresolvedRows = session.rows.filter((row) => !row.registeredAtStart && row.countedQuantity > 0);
    if (unresolvedRows.length) {
      setMessage(`Existem ${unresolvedRows.length} lote(s) que não faziam parte do estoque inicial. Resolva-os antes de concluir.`);
      return;
    }

    const stockRows = session.rows.filter((row) => row.registeredAtStart && !row.protectedInUse);
    const missingRows = stockRows.filter((row) => row.countedQuantity === 0);
    const changedRows = stockRows.filter(
      (row) => row.countedQuantity > 0 && row.countedQuantity !== row.systemQuantity,
    );
    const unchangedRows = stockRows.filter(
      (row) => row.countedQuantity > 0 && row.countedQuantity === row.systemQuantity,
    );
    const protectedRows = session.rows.filter((row) => row.registeredAtStart && row.protectedInUse);

    const updatedAt = new Date().toISOString();
    const updatedProducts = changedRows.flatMap((row) => {
      const product = productsById.get(row.productId);
      return product ? [{ ...product, quantity: row.countedQuantity, updatedAt }] : [];
    });

    const confirmationLines = [
      `Concluir o inventário completo?`,
      '',
      `${unchangedRows.length} lote(s) conferido(s) sem alteração.`,
      `${updatedProducts.length} lote(s) terão a quantidade ajustada.`,
      `${missingRows.length} lote(s) não encontrado(s) serão EXCLUÍDOS do estoque oficial.`,
      `${protectedRows.length} lote(s) marcados como Em uso serão preservados.`,
      '',
      'Esta ação altera o estoque oficial. Itens não encontrados não poderão ser recuperados por este inventário após a confirmação.',
    ];

    if (!window.confirm(confirmationLines.join('\n'))) return;

    setUpdating(true);
    setMessage('Aplicando a conferência ao estoque oficial...');

    try {
      const saveResult = updatedProducts.length
        ? await saveProductsBatch(updatedProducts)
        : { saved: 0, syncState: 'local' as const };

      let deleted = 0;
      for (const row of missingRows) {
        await removeProduct(row.productId);
        deleted += 1;
      }

      setScannerOpen(false);
      setManualEntryOpen(false);
      setSession(EMPTY_SESSION);
      window.localStorage.removeItem(STORAGE_KEY);

      const syncMessage = saveResult.syncState === 'pending'
        ? ' Alterações locais aguardam sincronização com a nuvem.'
        : saveResult.syncState === 'synced'
          ? ' Alterações sincronizadas com a nuvem.'
          : '';

      setMessage(
        `Inventário concluído: ${unchangedRows.length} conferido(s), ${saveResult.saved} ajustado(s), ${deleted} excluído(s) e ${protectedRows.length} em uso preservado(s).${syncMessage}`,
      );

      window.setTimeout(() => window.location.reload(), 1500);
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : 'Não foi possível concluir o inventário. Revise o estoque antes de tentar novamente.');
    } finally {
      setUpdating(false);
    }
  }

  const statusLabel = session.status === 'counting'
    ? 'Leitura em andamento'
    : session.status === 'review'
      ? 'Aguardando revisão'
      : 'Pronto para iniciar';

  const canUpdate = session.status === 'review'
    && session.rows.length > 0
    && unregisteredCount === 0
    && !updating;

  return (
    <div className="inventory-window-backdrop" role="presentation">
      {scannerOpen && session.status === 'counting' && (
        <InventoryQrScanner onDetected={countQrCode} onClose={() => setScannerOpen(false)} />
      )}

      {manualEntryOpen && session.status !== 'ready' && (
        <InventoryManualEntry
          products={manualEntryProducts}
          onAdd={addManualProduct}
          onClose={() => setManualEntryOpen(false)}
        />
      )}

      <section className="inventory-window" role="dialog" aria-modal="true" aria-labelledby="temporary-inventory-title">
        <header className="inventory-window-header">
          <div>
            <span className="eyebrow">CONFERÊNCIA FÍSICA COMPLETA</span>
            <h2 id="temporary-inventory-title">Inventário temporário</h2>
            <p>A fotografia inicial é comparada com o que foi encontrado fisicamente. Itens não encontrados serão removidos ao concluir.</p>
          </div>
          <button
            className="inventory-window-close"
            type="button"
            onClick={onClose}
            disabled={updating}
            aria-label="Fechar janela de inventário"
          >
            ✕
          </button>
        </header>

        <div className="inventory-session-strip">
          <div>
            <span>Status</span>
            <strong>{updating ? 'Atualizando estoque' : statusLabel}</strong>
          </div>
          <div>
            <span>Início</span>
            <strong>{formatStartedAt(session.startedAt)}</strong>
          </div>
          <div>
            <span>Fotografia inicial</span>
            <strong>{session.rows.filter((row) => row.registeredAtStart).length} lote(s)</strong>
          </div>
        </div>

        <div className="inventory-summary-grid" aria-label="Resumo da conferência temporária">
          <article><strong>{totals.countedUnits}</strong><span>Unidades encontradas</span></article>
          <article><strong>{totals.foundLots}</strong><span>Lotes encontrados</span></article>
          <article><strong>{totals.divergences}</strong><span>Divergências</span></article>
        </div>

        {session.status === 'ready' ? (
          <div className="inventory-start-state">
            <div className="inventory-start-icon" aria-hidden="true">▦</div>
            <h3>Começar uma nova conferência completa</h3>
            <p>Ao iniciar, o QuimStock cria uma fotografia temporária do estoque. A lista oficial só muda depois da revisão e confirmação final.</p>
            <button className="inventory-main-action" type="button" onClick={startInventory}>Iniciar inventário</button>
          </div>
        ) : (
          <>
            {session.status === 'counting' ? (
              <div className="inventory-reader-panel">
                <div>
                  <strong>Conte o que existe fisicamente</strong>
                  <span>Cada leitura soma uma unidade encontrada daquele E-code + lote. O cadastro oficial não é alterado durante a leitura.</span>
                </div>
                <div className="inventory-reader-actions">
                  <button className="inventory-open-scanner" type="button" onClick={() => setScannerOpen(true)}>
                    Abrir leitor QR
                  </button>
                  <button className="inventory-manual-open" type="button" onClick={() => setManualEntryOpen(true)}>
                    Adicionar manualmente
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className={`inventory-phase-notice ${unregisteredCount || missingCount ? 'inventory-phase-warning' : ''}`}>
                  <strong>
                    {unregisteredCount
                      ? `${unregisteredCount} lote(s) precisam de correção`
                      : missingCount
                        ? `${missingCount} lote(s) não encontrados serão excluídos`
                        : 'Conferência pronta para aplicar'}
                  </strong>
                  <span>
                    {unregisteredCount
                      ? 'Resolva os materiais que não faziam parte da fotografia inicial antes de concluir.'
                      : `Quantidades divergentes serão ajustadas. ${protectedInUseCount} lote(s) Em uso serão preservados.`}
                  </span>
                </div>
                <div className="inventory-review-manual">
                  <button className="inventory-manual-open" type="button" onClick={() => setManualEntryOpen(true)} disabled={updating}>
                    Adicionar item esquecido
                  </button>
                </div>
              </>
            )}

            <div className="inventory-table-wrap">
              <table className="inventory-review-table">
                <thead>
                  <tr>
                    <th>E-code</th>
                    <th>Produto</th>
                    <th>Lote</th>
                    <th>Validade</th>
                    <th>Situação</th>
                    <th>Sistema</th>
                    <th>Conferido</th>
                  </tr>
                </thead>
                <tbody>
                  {session.rows.length ? session.rows.map((row) => {
                    const hasQr = (row.qrCount ?? 0) > 0;
                    const hasManual = (row.manualCount ?? 0) > 0;
                    const manualTitle = (row.manualReasons ?? [])
                      .map((reason) => MANUAL_ENTRY_REASON_LABELS[reason])
                      .join(', ');

                    return (
                      <tr className={!row.registeredAtStart ? 'inventory-unregistered-row' : ''} key={row.productId}>
                        <td data-label="E-code">{row.ecode}</td>
                        <td data-label="Produto">{row.name}</td>
                        <td data-label="Lote">{row.batch}</td>
                        <td data-label="Validade">{formatExpiryDate(row.expiryDate)}</td>
                        <td data-label="Situação">
                          <div className="inventory-source-badges">
                            {row.protectedInUse ? (
                              <span className="inventory-source-badge manual">Em uso · preservado</span>
                            ) : !row.registeredAtStart ? (
                              <span className="inventory-source-badge manual">Não cadastrado</span>
                            ) : row.countedQuantity === 0 ? (
                              <span className="inventory-source-badge manual">Não encontrado</span>
                            ) : (
                              <>
                                {hasQr && <span className="inventory-source-badge qr">QR</span>}
                                {hasManual && (
                                  <span className="inventory-source-badge manual" title={manualTitle || 'Inclusão manual'}>
                                    Manual
                                  </span>
                                )}
                                {!hasQr && !hasManual && <span>Encontrado</span>}
                              </>
                            )}
                          </div>
                        </td>
                        <td data-label="Sistema">{row.registeredAtStart ? row.systemQuantity : 'Não cadastrado'}</td>
                        <td data-label="Conferido">
                          <div className="inventory-count-control">
                            <button
                              type="button"
                              onClick={() => changeCount(row.productId, -1)}
                              disabled={updating}
                              aria-label={`Diminuir contagem de ${row.name}`}
                            >
                              −
                            </button>
                            <strong>{row.countedQuantity}</strong>
                            <button
                              type="button"
                              onClick={() => changeCount(row.productId, 1)}
                              disabled={updating}
                              aria-label={`Aumentar contagem de ${row.name}`}
                            >
                              +
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }) : (
                    <tr>
                      <td className="inventory-empty-row" colSpan={7}>
                        Nenhum item disponível para esta conferência.
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
          <button className="inventory-cancel-action" type="button" onClick={cancelInventory} disabled={updating}>
            Cancelar inventário
          </button>
          <div>
            {session.status === 'counting' && (
              <button className="inventory-secondary-action" type="button" onClick={finishReading}>Finalizar leitura</button>
            )}
            {session.status === 'review' && (
              <button className="inventory-secondary-action" type="button" onClick={resumeReading} disabled={updating}>
                Continuar leitura
              </button>
            )}
            <button
              className="inventory-update-action"
              type="button"
              onClick={() => void updateStock()}
              disabled={!canUpdate}
              title={unregisteredCount
                ? 'Resolva os materiais não cadastrados antes de concluir'
                : 'Aplicar a conferência completa ao estoque oficial'}
            >
              {updating ? 'Aplicando...' : 'Concluir inventário'}
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
