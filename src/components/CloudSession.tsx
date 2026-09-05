import { Fragment, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import {
  bootstrapCloudProducts,
  importLegacyProductsToCloud,
  subscribeCloudProducts,
} from '../lib/db';
import { firebaseAuth, firebaseConfigured } from '../lib/firebase';
import './cloud-session.css';

type Props = {
  children: ReactNode;
};

type AuthMode = 'login' | 'register';
type SyncState = 'local' | 'connecting' | 'synced' | 'offline' | 'error';

const IMPORT_DECISION_PREFIX = 'quimstock-local-import-decision-v1:';

function importDecisionKey(userId: string): string {
  return `${IMPORT_DECISION_PREFIX}${userId}`;
}

function hasImportDecision(userId: string): boolean {
  return Boolean(window.localStorage.getItem(importDecisionKey(userId)));
}

function setImportDecision(userId: string, decision: 'cloud' | 'imported'): void {
  window.localStorage.setItem(importDecisionKey(userId), decision);
}

function authErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error && 'code' in error ? String(error.code) : '';

  if (code.includes('invalid-credential') || code.includes('wrong-password') || code.includes('user-not-found')) {
    return 'E-mail ou senha incorretos.';
  }
  if (code.includes('email-already-in-use')) return 'Este e-mail já possui uma conta.';
  if (code.includes('weak-password')) return 'Crie uma senha com pelo menos 6 caracteres.';
  if (code.includes('invalid-email')) return 'Digite um endereço de e-mail válido.';
  if (code.includes('too-many-requests')) return 'Muitas tentativas. Aguarde um pouco e tente novamente.';
  if (code.includes('network-request-failed')) return 'Sem conexão com a internet. Confira a rede e tente novamente.';
  return error instanceof Error ? error.message : 'Não foi possível concluir a operação.';
}

function dispatchProductsChanged(): void {
  window.dispatchEvent(new CustomEvent('quimstock:products-changed'));
}

export default function CloudSession({ children }: Props) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(firebaseConfigured);
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>(firebaseConfigured ? 'connecting' : 'local');
  const [sessionReady, setSessionReady] = useState(!firebaseConfigured);
  const [syncError, setSyncError] = useState('');
  const [localImportCount, setLocalImportCount] = useState(0);
  const [importingLocal, setImportingLocal] = useState(false);
  const [syncRevision, setSyncRevision] = useState(0);
  const [dataRevision, setDataRevision] = useState(0);
  const [sessionExpanded, setSessionExpanded] = useState(true);

  useEffect(() => {
    const auth = firebaseAuth;
    if (!firebaseConfigured || !auth) {
      setAuthLoading(false);
      setSyncState('local');
      setSessionReady(true);
      return;
    }

    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
      setSyncState(currentUser ? (navigator.onLine ? 'connecting' : 'offline') : 'local');
      setSessionReady(!currentUser || !navigator.onLine);
      setSyncError('');
      setLocalImportCount(0);
    });
  }, []);

  useEffect(() => {
    if (!user || !firebaseConfigured) return undefined;

    const userId = user.uid;
    let active = true;
    let connectSequence = 0;
    let unsubscribe: () => void = () => undefined;

    function notifyProductsChanged() {
      dispatchProductsChanged();
      setDataRevision((current) => current + 1);
    }

    async function connectCloud() {
      const sequence = ++connectSequence;
      unsubscribe();
      unsubscribe = () => undefined;

      if (!navigator.onLine) {
        setSyncState('offline');
        setSyncError('');
        setSessionReady(true);
        notifyProductsChanged();
        return;
      }

      setSyncState('connecting');
      setSessionReady(false);
      setSyncError('');

      try {
        const result = await bootstrapCloudProducts(userId);
        if (!active || sequence !== connectSequence) return;

        if (result.cloudEmpty && result.legacyLocalCount > 0 && !hasImportDecision(userId)) {
          setLocalImportCount(result.legacyLocalCount);
          setSessionReady(false);
          return;
        }

        if (!result.cloudEmpty && !hasImportDecision(userId)) {
          setImportDecision(userId, 'cloud');
        }

        setLocalImportCount(0);
        setSessionReady(true);
        setSyncState('synced');
        notifyProductsChanged();

        if (result.discardedStaleUpdates > 0) {
          console.warn(
            `${result.discardedStaleUpdates} alteração(ões) offline de produto(s) já excluído(s) na nuvem foram descartadas com segurança.`,
          );
        }

        unsubscribe = subscribeCloudProducts(
          userId,
          () => {
            if (!active || sequence !== connectSequence) return;
            setSyncState(navigator.onLine ? 'synced' : 'offline');
            notifyProductsChanged();
          },
          (error) => {
            console.error(error);
            if (!active || sequence !== connectSequence) return;
            setSyncState(navigator.onLine ? 'error' : 'offline');
            if (navigator.onLine) setSyncError('A conexão com o estoque oficial foi interrompida. Tente sincronizar novamente.');
          },
        );
      } catch (error) {
        console.error(error);
        if (!active || sequence !== connectSequence) return;
        setSyncState(navigator.onLine ? 'error' : 'offline');
        setSessionReady(!navigator.onLine);
        setSyncError(
          navigator.onLine
            ? (error instanceof Error ? error.message : 'Não foi possível carregar o estoque oficial da nuvem.')
            : '',
        );
      }
    }

    void connectCloud();

    const handleOnline = () => {
      if (!active) return;
      void connectCloud();
    };
    const handleOffline = () => {
      if (!active) return;
      connectSequence += 1;
      unsubscribe();
      unsubscribe = () => undefined;
      setSyncState('offline');
      setSyncError('');
      setSessionReady(true);
      notifyProductsChanged();
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      active = false;
      connectSequence += 1;
      unsubscribe();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [user, syncRevision]);

  useEffect(() => {
    if (syncState !== 'synced') {
      setSessionExpanded(true);
      return;
    }

    setSessionExpanded(true);
    const timer = window.setTimeout(() => setSessionExpanded(false), 4500);
    return () => window.clearTimeout(timer);
  }, [syncState]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const auth = firebaseAuth;
    if (!auth) return;

    setSubmitting(true);
    setMessage('');
    try {
      if (mode === 'register') {
        await createUserWithEmailAndPassword(auth, email.trim(), password);
      } else {
        await signInWithEmailAndPassword(auth, email.trim(), password);
      }
    } catch (error) {
      setMessage(authErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleResetPassword() {
    const auth = firebaseAuth;
    if (!auth) return;
    if (!email.trim()) {
      setMessage('Digite seu e-mail para receber a recuperação de senha.');
      return;
    }

    setSubmitting(true);
    setMessage('');
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setMessage('E-mail de recuperação enviado. Confira sua caixa de entrada.');
    } catch (error) {
      setMessage(authErrorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSignOut() {
    const auth = firebaseAuth;
    if (!auth) return;
    await signOut(auth);
  }

  function handleUseCloud() {
    if (!user) return;
    setImportDecision(user.uid, 'cloud');
    setLocalImportCount(0);
    setSyncRevision((current) => current + 1);
  }

  async function handleImportLocal() {
    if (!user || importingLocal) return;
    setImportingLocal(true);
    setSyncError('');
    try {
      await importLegacyProductsToCloud(user.uid);
      setImportDecision(user.uid, 'imported');
      setLocalImportCount(0);
      setSyncRevision((current) => current + 1);
    } catch (error) {
      console.error(error);
      setSyncError(error instanceof Error ? error.message : 'Não foi possível importar os dados locais.');
    } finally {
      setImportingLocal(false);
    }
  }

  if (authLoading) {
    return (
      <div className="cloud-loading-screen">
        <div className="cloud-spinner" />
        <strong>Preparando o QuimStock...</strong>
      </div>
    );
  }

  if (firebaseConfigured && !user) {
    return (
      <main className="cloud-auth-screen">
        <section className="cloud-auth-card">
          <div className="cloud-auth-brand">
            <span>QS</span>
            <div>
              <strong>QuimStock</strong>
              <small>Estoque conectado</small>
            </div>
          </div>

          <span className="cloud-auth-kicker">ACESSO SEGURO</span>
          <h1>{mode === 'login' ? 'Entrar no estoque' : 'Criar acesso'}</h1>
          <p>Use o mesmo e-mail no celular e no computador para manter os materiais sincronizados.</p>

          <div className="cloud-auth-tabs">
            <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => { setMode('login'); setMessage(''); }}>
              Entrar
            </button>
            <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => { setMode('register'); setMessage(''); }}>
              Criar conta
            </button>
          </div>

          <form onSubmit={handleSubmit}>
            <label>
              <span>E-mail</span>
              <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
            </label>
            <label>
              <span>Senha</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                minLength={6}
                required
              />
            </label>
            <button className="cloud-auth-submit" type="submit" disabled={submitting}>
              {submitting ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar conta'}
            </button>
          </form>

          {mode === 'login' && (
            <button className="cloud-reset-button" type="button" onClick={() => void handleResetPassword()} disabled={submitting}>
              Esqueci minha senha
            </button>
          )}

          {message && <p className="cloud-auth-message" role="status">{message}</p>}
        </section>
      </main>
    );
  }

  if (user && localImportCount > 0) {
    return (
      <main className="cloud-auth-screen">
        <section className="cloud-auth-card cloud-import-card">
          <div className="cloud-auth-brand">
            <span>QS</span>
            <div>
              <strong>QuimStock</strong>
              <small>Proteção contra duplicações</small>
            </div>
          </div>
          <span className="cloud-auth-kicker">DADOS LOCAIS ENCONTRADOS</span>
          <h1>Qual estoque deve ser usado?</h1>
          <p>
            Este aparelho possui {localImportCount} registro(s) de uma versão anterior, enquanto a conta na nuvem está vazia.
            Nada será enviado automaticamente.
          </p>
          <div className="cloud-import-warning">
            <strong>Opção segura recomendada</strong>
            <span>Use o estoque da nuvem. Importe os dados locais somente se esta for realmente uma conta nova e esses registros forem o estoque correto.</span>
          </div>
          <div className="cloud-import-actions">
            <button className="cloud-auth-submit" type="button" onClick={handleUseCloud} disabled={importingLocal}>
              Usar estoque da nuvem
            </button>
            <button className="cloud-reset-button" type="button" onClick={() => void handleImportLocal()} disabled={importingLocal}>
              {importingLocal ? 'Importando...' : `Importar ${localImportCount} dado(s) locais`}
            </button>
          </div>
          {syncError && <p className="cloud-auth-message" role="alert">{syncError}</p>}
        </section>
      </main>
    );
  }

  if (user && !sessionReady) {
    if (syncState === 'error') {
      return (
        <main className="cloud-auth-screen">
          <section className="cloud-auth-card">
            <div className="cloud-auth-brand">
              <span>QS</span>
              <div>
                <strong>QuimStock</strong>
                <small>Estoque oficial protegido</small>
              </div>
            </div>
            <span className="cloud-auth-kicker">SINCRONIZAÇÃO INTERROMPIDA</span>
            <h1>Não foi possível confirmar a nuvem</h1>
            <p>{syncError || 'O QuimStock não abriu um cache antigo porque a conexão com o estoque oficial não foi confirmada.'}</p>
            <button className="cloud-auth-submit cloud-full-button" type="button" onClick={() => setSyncRevision((current) => current + 1)}>
              Tentar sincronizar novamente
            </button>
            <button className="cloud-reset-button" type="button" onClick={() => void handleSignOut()}>
              Sair da conta
            </button>
          </section>
        </main>
      );
    }

    return (
      <div className="cloud-loading-screen">
        <div className="cloud-spinner" />
        <strong>Carregando o estoque oficial...</strong>
        <small>O cache deste aparelho só será liberado depois da conferência com a nuvem.</small>
      </div>
    );
  }

  const syncLabel = syncState === 'synced'
    ? 'Sincronizado'
    : syncState === 'connecting'
      ? 'Sincronizando...'
      : syncState === 'offline'
        ? 'Modo offline'
        : syncState === 'error'
          ? 'Falha na sincronização'
          : 'Dados locais';

  const showCompactStatus = syncState === 'synced' && !sessionExpanded;

  return (
    <>
      <Fragment key={dataRevision}>{children}</Fragment>

      {showCompactStatus ? (
        <button
          type="button"
          className="cloud-session-compact synced"
          onClick={() => setSessionExpanded(true)}
          aria-label="Estoque sincronizado. Toque para abrir os detalhes da conta."
          title="Sincronizado"
        >
          <span className="cloud-session-dot" />
          <span aria-hidden="true">☁</span>
        </button>
      ) : (
        <aside className={`cloud-session-chip ${syncState}`} aria-label="Situação da sincronização">
          <span className="cloud-session-dot" />
          <div>
            <strong>{syncLabel}</strong>
            <small>{user?.email ?? 'Firebase ainda não configurado'}</small>
          </div>
          {syncState === 'synced' && (
            <button
              className="cloud-session-collapse"
              type="button"
              onClick={() => setSessionExpanded(false)}
              aria-label="Recolher aviso de sincronização"
            >
              ⌄
            </button>
          )}
          {user && firebaseAuth && (
            <button className="cloud-session-signout" type="button" onClick={() => void handleSignOut()}>Sair</button>
          )}
        </aside>
      )}
    </>
  );
}
