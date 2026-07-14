import { Fragment, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from 'firebase/auth';
import { migrateLocalProductsToCloud, subscribeCloudProducts } from '../lib/db';
import { firebaseAuth, firebaseConfigured } from '../lib/firebase';
import './cloud-session.css';

type Props = {
  children: ReactNode;
};

type AuthMode = 'login' | 'register';
type SyncState = 'local' | 'connecting' | 'synced' | 'offline' | 'error';

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
  const [dataRevision, setDataRevision] = useState(0);
  const [sessionExpanded, setSessionExpanded] = useState(true);

  useEffect(() => {
    const auth = firebaseAuth;
    if (!firebaseConfigured || !auth) {
      setAuthLoading(false);
      setSyncState('local');
      return;
    }

    return onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
      setSyncState(currentUser ? 'connecting' : 'local');
    });
  }, []);

  useEffect(() => {
    if (!user || !firebaseConfigured) return;

    const userId = user.uid;
    let active = true;
    let unsubscribe: () => void = () => undefined;

    function notifyProductsChanged() {
      dispatchProductsChanged();
      setDataRevision((current) => current + 1);
    }

    async function connectCloud() {
      setSyncState(navigator.onLine ? 'connecting' : 'offline');
      try {
        await migrateLocalProductsToCloud(userId);
        if (!active) return;
        notifyProductsChanged();

        unsubscribe = subscribeCloudProducts(
          userId,
          () => {
            if (!active) return;
            setSyncState(navigator.onLine ? 'synced' : 'offline');
            notifyProductsChanged();
          },
          (error) => {
            console.error(error);
            if (active) setSyncState(navigator.onLine ? 'error' : 'offline');
          },
        );
      } catch (error) {
        console.error(error);
        if (active) setSyncState(navigator.onLine ? 'error' : 'offline');
      }
    }

    void connectCloud();

    const handleOnline = () => setSyncState('connecting');
    const handleOffline = () => setSyncState('offline');
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      active = false;
      unsubscribe();
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [user]);

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
              {submitting ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar conta e sincronizar'}
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
