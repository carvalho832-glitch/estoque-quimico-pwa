import { useRef, useState, type ChangeEvent } from 'react';
import { bootstrapCloudProducts, saveProductsBatch } from '../lib/db';
import { firebaseAuth } from '../lib/firebase';
import { parseStockBackupExcel, type StockImportPreview } from '../lib/stock-import';
import './admin-stock-import.css';

const CONFIRMATION_TEXT = 'RESTAURAR ESTOQUE';

export default function AdminStockImport() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<StockImportPreview | null>(null);
  const [fileName, setFileName] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setBusy(true);
    setMessage('Lendo e conferindo a planilha...');
    setPreview(null);
    setConfirmation('');

    try {
      const parsed = await parseStockBackupExcel(file);
      setFileName(file.name);
      setPreview(parsed);
      setMessage(
        `${parsed.products.length} produto(s) e ${parsed.totalUnits} unidade(s) encontrados. `
        + 'Confira o resumo antes de restaurar.',
      );
    } catch (error) {
      setFileName('');
      setMessage(error instanceof Error ? error.message : 'Não foi possível ler a planilha.');
    } finally {
      setBusy(false);
      if (event.target) event.target.value = '';
    }
  }

  async function restoreStock() {
    if (!preview) return;
    if (confirmation.trim().toUpperCase() !== CONFIRMATION_TEXT) {
      setMessage(`Digite exatamente “${CONFIRMATION_TEXT}” para confirmar a restauração.`);
      return;
    }

    const user = firebaseAuth?.currentUser;
    if (!user) {
      setMessage('Entre na conta do QuimStock antes de restaurar o estoque.');
      return;
    }
    if (!navigator.onLine) {
      setMessage('A restauração exige internet para confirmar a gravação no Firebase.');
      return;
    }

    setBusy(true);
    setMessage('Confirmando que o estoque oficial na nuvem está vazio...');

    try {
      const before = await bootstrapCloudProducts(user.uid);
      if (!before.cloudEmpty || before.products.length > 0) {
        throw new Error(
          `A nuvem já possui ${before.products.length} produto(s). `
          + 'A restauração foi bloqueada para não misturar estoques nem gerar duplicidade.',
        );
      }

      setMessage('Enviando o estoque restaurado para o Firebase...');
      const result = await saveProductsBatch(preview.products);
      if (result.saved !== preview.products.length) {
        throw new Error('A quantidade gravada não corresponde à quantidade esperada da planilha.');
      }

      setMessage('Verificando o estoque diretamente na nuvem...');
      const after = await bootstrapCloudProducts(user.uid);
      const expectedIds = new Set(preview.products.map((product) => product.id));
      const restoredProducts = after.products.filter((product) => expectedIds.has(product.id));
      const restoredUnits = restoredProducts.reduce((sum, product) => sum + product.quantity, 0);

      if (restoredProducts.length !== preview.products.length || restoredUnits !== preview.totalUnits) {
        throw new Error(
          'O Firebase respondeu, mas a conferência final não bateu com a planilha. '
          + 'Não faça uma segunda importação; confira o estoque antes de tentar novamente.',
        );
      }

      setMessage(
        `Restauração concluída: ${restoredProducts.length} produto(s) e ${restoredUnits} unidade(s) `
        + 'confirmados no Firebase. Recarregando o QuimStock...',
      );
      setConfirmation('');
      window.dispatchEvent(new CustomEvent('quimstock:products-changed'));
      window.setTimeout(() => window.location.reload(), 1600);
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : 'Falha ao restaurar o estoque.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel stock-import-panel" aria-labelledby="stock-import-title">
      <div className="stock-import-heading">
        <div>
          <span className="eyebrow">RESTAURAÇÃO SEGURA</span>
          <h2 id="stock-import-title">Restaurar estoque pelo Excel</h2>
          <p>
            Use um backup .xlsx do QuimStock. A importação só é liberada quando o estoque oficial
            do Firebase está vazio.
          </p>
        </div>
        <button
          className="stock-import-select"
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
        >
          {busy ? 'Processando...' : 'Selecionar Excel'}
        </button>
      </div>

      <input
        ref={inputRef}
        className="stock-import-file"
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        onChange={(event) => void handleFile(event)}
      />

      {preview && (
        <div className="stock-import-preview">
          <strong>{fileName}</strong>
          <div className="stock-import-kpis">
            <span><b>{preview.products.length}</b> produtos</span>
            <span><b>{preview.totalUnits}</b> unidades</span>
            <span><b>{preview.locations.length}</b> locais</span>
          </div>

          <div className="stock-import-locations">
            {preview.locations.map((location) => (
              <span key={location.name}>
                {location.name}: {location.products} produto(s), {location.units} un.
              </span>
            ))}
          </div>

          {preview.warnings.length > 0 && (
            <details className="stock-import-warnings">
              <summary>{preview.warnings.length} aviso(s) da leitura</summary>
              {preview.warnings.map((warning) => <p key={warning}>{warning}</p>)}
            </details>
          )}

          <label className="stock-import-confirm">
            <span>Para restaurar, digite <strong>{CONFIRMATION_TEXT}</strong></span>
            <input
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              placeholder={CONFIRMATION_TEXT}
              disabled={busy}
            />
          </label>

          <button
            className="stock-import-restore"
            type="button"
            disabled={busy || confirmation.trim().toUpperCase() !== CONFIRMATION_TEXT}
            onClick={() => void restoreStock()}
          >
            {busy ? 'Restaurando...' : 'RESTAURAR E GRAVAR NO FIREBASE'}
          </button>
        </div>
      )}

      {message && <p className="stock-import-message" role="status">{message}</p>}
    </section>
  );
}
