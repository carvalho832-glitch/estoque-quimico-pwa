import { useEffect, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { listProducts } from '../lib/db';
import { exportOrShareProductsToExcel } from '../lib/excel';
import { firebaseAuth } from '../lib/firebase';
import { resetAllStockProducts } from '../lib/reset-stock';
import './admin-reset-stock.css';

type Step = 'credentials' | 'ready' | 'done';

const CONFIRMATION_TEXT = 'ZERAR ESTOQUE';

function authErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';

  if (code.includes('invalid-credential') || code.includes('wrong-password')) {
    return 'Senha incorreta. O reinício do estoque não foi liberado.';
  }
  if (code.includes('too-many-requests')) {
    return 'Muitas tentativas de senha. Aguarde um pouco antes de tentar novamente.';
  }
  if (code.includes('network-request-failed')) {
    return 'Sem conexão com a internet. O estoque não foi alterado.';
  }
  return error instanceof Error ? error.message : 'Não foi possível validar a senha administrativa.';
}

export default function AdminResetStock() {
  const [host, setHost] = useState<Element | null>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('credentials');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [productCount, setProductCount] = useState(0);
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
      if (event.key === 'Escape' && !busy && step !== 'done') closeDialog();
    };

    window.addEventListener('keydown', handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleEscape);
    };
  }, [open, busy, step]);

  async function openDialog() {
    const products = await listProducts();
    setProductCount(products.length);
    setPassword('');
    setConfirmation('');
    setMessage('');
    setStep('credentials');
    setOpen(true);
  }

  function closeDialog() {
    if (busy) return;
    setOpen(false);
    setPassword('');
    setConfirmation('');
    setMessage('');
    setStep('credentials');
  }

  async function validateAndBackup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (confirmation.trim().toUpperCase() !== CONFIRMATION_TEXT) {
      setMessage(`Digite exatamente “${CONFIRMATION_TEXT}” para liberar a próxima etapa.`);
      return;
    }

    const auth = firebaseAuth;
    const user = auth?.currentUser;
    if (!auth || !user?.email) {
      setMessage('A conta do QuimStock precisa estar conectada para validar o administrador.');
      return;
    }

    setBusy(true);
    setMessage('Validando senha administrativa...');

    try {
      const credential = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(user, credential);

      const products = await listProducts();
      if (!products.length) {
        setMessage('O estoque já está vazio. Não há produtos para reiniciar.');
        return;
      }

      setMessage('Senha confirmada. Gerando o backup obrigatório do estoque...');
      const backupResult = await exportOrShareProductsToExcel(products, {
        title: 'BACKUP DO ESTOQUE ANTES DO REINÍCIO',
        revision: 'BACKUP',
      });

      if (backupResult === 'cancelled') {
        setMessage('O backup foi cancelado. Por segurança, o reinício do estoque também foi cancelado.');
        return;
      }

      setProductCount(products.length);
      setStep('ready');
      setPassword('');
      setMessage('Backup concluído. O estoque ainda não foi alterado.');
    } catch (error) {
      console.error(error);
      setMessage(authErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function performReset() {
    const confirmed = window.confirm(
      `ÚLTIMA CONFIRMAÇÃO\n\nApagar todos os ${productCount} produto(s) do estoque ativo, no aparelho e na nuvem?\n\nO backup já foi gerado. Esta ação não possui botão Desfazer.`,
    );
    if (!confirmed) return;

    setBusy(true);
    setMessage('Reiniciando o estoque. Não feche esta tela...');

    try {
      const result = await resetAllStockProducts();
      setProductCount(0);
      setStep('done');
      setMessage(`${result.removed} produto(s) removido(s). O QuimStock está pronto para o novo inventário.`);
      window.setTimeout(() => window.location.reload(), 1800);
    } catch (error) {
      console.error(error);
      setMessage(error instanceof Error ? error.message : 'Não foi possível reiniciar o estoque. Nenhum novo comando foi executado.');
    } finally {
      setBusy(false);
    }
  }

  if (!host) return null;

  return createPortal(
    <>
      <section className="panel admin-reset-panel" aria-labelledby="admin-reset-title">
        <div className="admin-reset-copy">
          <span className="eyebrow">ADMINISTRAÇÃO</span>
          <h2 id="admin-reset-title">Reiniciar estoque</h2>
          <p>Apaga o estoque ativo para começar uma nova conferência. Protegido por senha e backup obrigatório.</p>
        </div>
        <button className="admin-reset-open" type="button" onClick={() => void openDialog()}>
          <span aria-hidden="true">🔒</span>
          Reiniciar estoque
        </button>
      </section>

      {open && (
        <div className="admin-reset-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) closeDialog();
        }}>
          <section className="admin-reset-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-reset-dialog-title">
            <header className="admin-reset-header">
              <div>
                <span className="eyebrow">ÁREA RESTRITA · ADMIN</span>
                <h2 id="admin-reset-dialog-title">Reiniciar todo o estoque</h2>
                <p>Esta ferramenta é propositalmente difícil de acionar por acidente.</p>
              </div>
              <button type="button" onClick={closeDialog} disabled={busy} aria-label="Fechar área administrativa">✕</button>
            </header>

            <div className="admin-reset-warning">
              <strong>⚠️ {productCount} produto(s) no estoque atual</strong>
              <span>Antes de apagar qualquer registro, o QuimStock exigirá a senha da conta e gerará um backup em Excel.</span>
            </div>

            {step === 'credentials' && (
              <form className="admin-reset-form" onSubmit={(event) => void validateAndBackup(event)}>
                <label>
                  <span>Senha do administrador</span>
                  <input
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    minLength={6}
                    required
                    autoFocus
                  />
                  <small>É a senha da conta Firebase atualmente conectada. Ela não é salva pelo QuimStock.</small>
                </label>

                <label>
                  <span>Confirmação de segurança</span>
                  <input
                    value={confirmation}
                    onChange={(event) => setConfirmation(event.target.value)}
                    placeholder={CONFIRMATION_TEXT}
                    autoComplete="off"
                    required
                  />
                  <small>Digite exatamente: <strong>{CONFIRMATION_TEXT}</strong></small>
                </label>

                <button className="admin-reset-validate" type="submit" disabled={busy || !password || !confirmation.trim()}>
                  {busy ? 'Validando e gerando backup...' : 'Validar senha e gerar backup'}
                </button>
              </form>
            )}

            {step === 'ready' && (
              <div className="admin-reset-final">
                <div className="admin-reset-backup-ok">
                  <strong>✓ Backup concluído</strong>
                  <span>A senha foi validada. Até este momento nenhum produto foi apagado.</span>
                </div>
                <button className="admin-reset-danger" type="button" onClick={() => void performReset()} disabled={busy}>
                  {busy ? 'Apagando estoque...' : `APAGAR ${productCount} PRODUTO(S) E COMEÇAR DO ZERO`}
                </button>
                <button className="admin-reset-cancel" type="button" onClick={closeDialog} disabled={busy}>Cancelar e manter estoque</button>
              </div>
            )}

            {step === 'done' && (
              <div className="admin-reset-done">
                <strong>Estoque reiniciado ✓</strong>
                <span>O aplicativo será recarregado para iniciar com o estoque vazio.</span>
              </div>
            )}

            {message && <p className="admin-reset-message" role="status">{message}</p>}
          </section>
        </div>
      )}
    </>,
    host,
  );
}
