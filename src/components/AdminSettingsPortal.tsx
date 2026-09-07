import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { exportOrShareProductsToExcel } from '../lib/excel';
import { listProducts } from '../lib/db';
import { changePin, ensurePinInitialized, verifyPin } from '../services/PinService';
import {
  exportSettings,
  getSettings,
  importSettings,
  isValidCheckTime,
  saveSettings,
  type NotificationSettings,
} from '../services/SettingsService';
import { runNotificationChecks } from '../services/NotificationScheduler';
import { sendSystemNotification } from '../services/NotificationService';
import {
  androidSettingsGuidance,
  getPushStatus,
  requestPushPermission,
  sendRemotePushTest,
  type PushStatus,
} from '../services/PushService';
import './admin-settings.css';

const EXPIRATION_DAYS = [90, 60, 30, 15, 7, 3, 1];
const DEFAULT_TIMES = ['08:00', '12:00', '18:00', '22:00'];
const LOW_STOCK_PRESETS = [2, 3, 5, 10];
const MAX_PIN_ATTEMPTS = 5;
const LOCKOUT_MS = 30_000;

type ViewState = 'closed' | 'pin' | 'settings';

type ToggleKey =
  | 'notifyExpiration'
  | 'notifyExpired'
  | 'notifyLowStock'
  | 'notifyStockRemoval'
  | 'notifyStockReturn'
  | 'notifyListUpdate'
  | 'notifyBackup'
  | 'notifySyncError';

const NOTIFICATION_TOGGLES: Array<{ key: ToggleKey; label: string }> = [
  { key: 'notifyExpiration', label: 'Produtos próximos do vencimento' },
  { key: 'notifyExpired', label: 'Produtos vencidos' },
  { key: 'notifyLowStock', label: 'Estoque baixo' },
  { key: 'notifyStockRemoval', label: 'Produto retirado do estoque' },
  { key: 'notifyStockReturn', label: 'Produto devolvido ao estoque' },
  { key: 'notifyListUpdate', label: 'Atualização da lista' },
  { key: 'notifyBackup', label: 'Backup realizado' },
  { key: 'notifySyncError', label: 'Erro de sincronização' },
];

function cloneSettings(): NotificationSettings {
  const current = getSettings();
  return { ...current, expirationDays: [...current.expirationDays], checkTimes: [...current.checkTimes] };
}

export default function AdminSettingsPortal() {
  const [view, setView] = useState<ViewState>('closed');
  const [pin, setPin] = useState('');
  const [pinMessage, setPinMessage] = useState('');
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [settings, setSettings] = useState<NotificationSettings>(cloneSettings);
  const [customTime, setCustomTime] = useState('');
  const [message, setMessage] = useState('');
  const [pushStatus, setPushStatus] = useState<PushStatus | null>(null);
  const [currentPin, setCurrentPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [busy, setBusy] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void ensurePinInitialized();
  }, []);

  useEffect(() => {
    if (view !== 'settings') return;
    setSettings(cloneSettings());
    void getPushStatus().then(setPushStatus).catch(() => setPushStatus(null));
  }, [view]);

  function openPin() {
    setPin('');
    setPinMessage('');
    setView('pin');
  }

  function close() {
    setPin('');
    setPinMessage('');
    setMessage('');
    setView('closed');
  }

  async function submitPin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (Date.now() < lockedUntil) {
      setPinMessage('PIN inválido.');
      return;
    }

    const valid = await verifyPin(pin);
    if (!valid) {
      const nextAttempts = attempts + 1;
      setAttempts(nextAttempts);
      setPin('');
      setPinMessage('PIN inválido.');
      if (nextAttempts >= MAX_PIN_ATTEMPTS) {
        setLockedUntil(Date.now() + LOCKOUT_MS);
        setAttempts(0);
      }
      return;
    }

    setAttempts(0);
    setLockedUntil(0);
    setPin('');
    setPinMessage('');
    setView('settings');
  }

  function persist(next: NotificationSettings) {
    const saved = saveSettings(next);
    setSettings(saved);
    setMessage('Configurações salvas.');
  }

  function toggleNotification(key: ToggleKey) {
    persist({ ...settings, [key]: !settings[key] });
  }

  function toggleDay(day: number) {
    const enabled = settings.expirationDays.includes(day);
    persist({
      ...settings,
      expirationDays: enabled
        ? settings.expirationDays.filter((value) => value !== day)
        : [...settings.expirationDays, day],
    });
  }

  function toggleTime(time: string) {
    const enabled = settings.checkTimes.includes(time);
    persist({
      ...settings,
      checkTimes: enabled
        ? settings.checkTimes.filter((value) => value !== time)
        : [...settings.checkTimes, time],
    });
  }

  function addCustomTime() {
    if (!isValidCheckTime(customTime)) {
      setMessage('Horário inválido. Use HH:MM.');
      return;
    }
    if (settings.checkTimes.includes(customTime)) {
      setMessage('Esse horário já está configurado.');
      return;
    }
    persist({ ...settings, checkTimes: [...settings.checkTimes, customTime] });
    setCustomTime('');
  }

  async function activateNotifications() {
    setBusy(true);
    setMessage('');
    try {
      const permission = await requestPushPermission();
      setPushStatus(await getPushStatus());
      setMessage(permission === 'granted' ? 'Notificações Android ativadas.' : 'As notificações estão desativadas no Android.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível ativar notificações.');
    } finally {
      setBusy(false);
    }
  }

  async function remotePushTest() {
    setBusy(true);
    setMessage('Preparando teste remoto...');
    try {
      let status = await getPushStatus();
      if (!status.configured) throw new Error('O push remoto ainda aguarda a chave VAPID do Firebase.');
      if (status.permission !== 'granted') throw new Error('Ative as notificações Android antes de testar o push remoto.');
      if (!status.registeredInCloud) {
        await requestPushPermission();
        status = await getPushStatus();
      }
      setPushStatus(status);
      if (!status.registeredInCloud) throw new Error('O token FCM ainda não foi registrado na nuvem.');
      await sendRemotePushTest();
      setMessage('Teste remoto enviado. A notificação deve chegar pela barra do Android.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível enviar o teste remoto.');
    } finally {
      setBusy(false);
    }
  }

  async function manualCheck() {
    setBusy(true);
    setMessage('Verificando vencimentos e estoque baixo...');
    try {
      await runNotificationChecks();
      setMessage('Verificação concluída. Avisos elegíveis foram enviados para a barra de notificações.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao verificar notificações.');
    } finally {
      setBusy(false);
    }
  }

  async function manualBackup() {
    setBusy(true);
    setMessage('Gerando backup...');
    try {
      const products = await listProducts();
      await exportOrShareProductsToExcel(products);
      await sendSystemNotification({ type: 'BACKUP_COMPLETED', detail: 'Backup manual concluído.' });
      setMessage('Backup gerado com sucesso.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível gerar o backup.');
    } finally {
      setBusy(false);
    }
  }

  function restoreBackup() {
    close();
    window.setTimeout(() => {
      const panel = document.querySelector<HTMLElement>('.stock-import-panel');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      else window.location.assign('./');
    }, 50);
  }

  function downloadSettings() {
    const blob = new Blob([exportSettings()], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `quimstock-config-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMessage('Configurações exportadas. O PIN não foi incluído.');
  }

  async function handleImportSettings(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const imported = importSettings(await file.text());
      setSettings(imported);
      setMessage('Configurações importadas com sucesso.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Falha ao importar configurações.');
    } finally {
      event.target.value = '';
    }
  }

  async function submitNewPin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    try {
      await changePin(currentPin, newPin, confirmPin);
      setCurrentPin('');
      setNewPin('');
      setConfirmPin('');
      setMessage('PIN alterado com sucesso.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Não foi possível alterar o PIN.');
    } finally {
      setBusy(false);
    }
  }

  const customTimes = settings.checkTimes.filter((time) => !DEFAULT_TIMES.includes(time));
  const permissionDenied = pushStatus?.permission === 'denied';

  return (
    <>
      <button className="admin-settings-gear" type="button" aria-label="Abrir configurações administrativas" onClick={openPin}>⚙</button>

      {view === 'pin' && (
        <div className="admin-settings-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) close(); }}>
          <section className="admin-pin-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-pin-title">
            <button className="admin-settings-close" type="button" aria-label="Fechar" onClick={close}>×</button>
            <span className="admin-settings-eyebrow">QUIMSTOCK</span>
            <h2 id="admin-pin-title">Área Administrativa</h2>
            <form onSubmit={(event) => void submitPin(event)}>
              <label>
                <span>Digite o PIN</span>
                <input autoFocus type="password" inputMode="numeric" autoComplete="off" value={pin} onChange={(event) => setPin(event.target.value)} />
              </label>
              {pinMessage && <p className="admin-settings-error" role="alert">{pinMessage}</p>}
              <button className="admin-primary-button" type="submit">Entrar</button>
            </form>
          </section>
        </div>
      )}

      {view === 'settings' && (
        <div className="admin-settings-overlay admin-settings-page" role="presentation">
          <section className="admin-settings-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-settings-title">
            <header className="admin-settings-header">
              <div>
                <span className="admin-settings-eyebrow">ÁREA ADMINISTRATIVA</span>
                <h2 id="admin-settings-title">Configurações</h2>
                <p>Preferências do dispositivo e notificações do sistema Android.</p>
              </div>
              <button className="admin-settings-close" type="button" aria-label="Fechar configurações" onClick={close}>×</button>
            </header>

            {permissionDenied && (
              <div className="admin-settings-warning" role="status">
                <div><strong>As notificações estão desativadas no Android.</strong><span>Ative a permissão do QuimStock nas configurações do sistema.</span></div>
                <button type="button" onClick={() => setMessage(androidSettingsGuidance())}>Abrir configurações</button>
              </div>
            )}

            <div className="admin-settings-grid">
              <article className="admin-settings-card">
                <div className="admin-card-title"><span>🔔</span><div><h3>Notificações</h3><p>Escolha quais eventos podem gerar avisos do Android.</p></div></div>
                <div className="admin-switch-list">
                  {NOTIFICATION_TOGGLES.map((item) => (
                    <label className="admin-switch-row" key={item.key}>
                      <span>{item.label}</span>
                      <input type="checkbox" checked={settings[item.key]} onChange={() => toggleNotification(item.key)} />
                    </label>
                  ))}
                </div>
                <div className="admin-action-row">
                  <button type="button" disabled={busy} onClick={() => void activateNotifications()}>{pushStatus?.permission === 'granted' ? 'Renovar token FCM' : 'Ativar notificações Android'}</button>
                  <button type="button" disabled={busy} onClick={() => void remotePushTest()}>Testar push remoto</button>
                  <button type="button" disabled={busy} onClick={() => void manualCheck()}>Verificar agora</button>
                </div>
                <small className="admin-tech-status">
                  FCM: {pushStatus?.configured ? 'configurado' : 'aguardando VAPID'} · Token: {pushStatus?.registeredInCloud ? 'registrado na nuvem' : pushStatus?.token ? 'somente no dispositivo' : 'ausente'} · Permissão: {pushStatus?.permission ?? 'verificando'}
                </small>
              </article>

              <article className="admin-settings-card">
                <div className="admin-card-title"><span>📅</span><div><h3>Dias para alerta</h3><p>Cada estágio dispara no máximo uma vez por validade.</p></div></div>
                <div className="admin-chip-grid">
                  {EXPIRATION_DAYS.map((day) => (
                    <label className="admin-chip-toggle" key={day}>
                      <input type="checkbox" checked={settings.expirationDays.includes(day)} onChange={() => toggleDay(day)} />
                      <span>{day} {day === 1 ? 'dia' : 'dias'}</span>
                    </label>
                  ))}
                </div>
              </article>

              <article className="admin-settings-card">
                <div className="admin-card-title"><span>🕒</span><div><h3>Horário de verificação</h3><p>O backend verifica os horários na nuvem, mesmo com o PWA fechado.</p></div></div>
                <div className="admin-chip-grid">
                  {DEFAULT_TIMES.map((time) => (
                    <label className="admin-chip-toggle" key={time}>
                      <input type="checkbox" checked={settings.checkTimes.includes(time)} onChange={() => toggleTime(time)} />
                      <span>{time}</span>
                    </label>
                  ))}
                </div>
                {customTimes.length > 0 && <div className="admin-custom-times">{customTimes.map((time) => <button key={time} type="button" onClick={() => toggleTime(time)} title="Remover horário">{time} ×</button>)}</div>}
                <div className="admin-inline-form">
                  <input type="time" value={customTime} onChange={(event) => setCustomTime(event.target.value)} />
                  <button type="button" onClick={addCustomTime}>Adicionar</button>
                </div>
              </article>

              <article className="admin-settings-card">
                <div className="admin-card-title"><span>📦</span><div><h3>Estoque baixo</h3><p>Quantidade mínima global para alerta.</p></div></div>
                <div className="admin-chip-grid">
                  {LOW_STOCK_PRESETS.map((value) => <button className={settings.lowStockThreshold === value ? 'selected' : ''} key={value} type="button" onClick={() => persist({ ...settings, lowStockThreshold: value })}>{value}</button>)}
                </div>
                <label className="admin-number-field"><span>Quantidade mínima</span><input type="number" min="0" max="9999" value={settings.lowStockThreshold} onChange={(event) => persist({ ...settings, lowStockThreshold: Math.max(0, Math.min(9999, Number(event.target.value) || 0)) })} /></label>
              </article>

              <article className="admin-settings-card">
                <div className="admin-card-title"><span>🔐</span><div><h3>Segurança</h3><p>O PIN é armazenado somente como hash com salt.</p></div></div>
                <form className="admin-security-form" onSubmit={(event) => void submitNewPin(event)}>
                  <input type="password" inputMode="numeric" placeholder="PIN atual" value={currentPin} onChange={(event) => setCurrentPin(event.target.value)} />
                  <input type="password" inputMode="numeric" placeholder="Novo PIN" value={newPin} onChange={(event) => setNewPin(event.target.value)} />
                  <input type="password" inputMode="numeric" placeholder="Confirmar PIN" value={confirmPin} onChange={(event) => setConfirmPin(event.target.value)} />
                  <button type="submit" disabled={busy}>Alterar PIN</button>
                </form>
              </article>

              <article className="admin-settings-card">
                <div className="admin-card-title"><span>☁</span><div><h3>Backup</h3><p>Reutiliza o backup e a restauração segura já existentes no QuimStock.</p></div></div>
                <div className="admin-backup-actions">
                  <button type="button" disabled={busy} onClick={() => void manualBackup()}>Backup manual</button>
                  <button type="button" onClick={restoreBackup}>Restaurar Backup</button>
                  <button type="button" onClick={downloadSettings}>Exportar Configurações</button>
                  <button type="button" onClick={() => importInputRef.current?.click()}>Importar Configurações</button>
                </div>
                <input ref={importInputRef} className="admin-hidden-input" type="file" accept="application/json,.json" onChange={(event) => void handleImportSettings(event)} />
              </article>
            </div>

            {message && <p className="admin-settings-message" role="status">{message}</p>}
          </section>
        </div>
      )}
    </>
  );
}
