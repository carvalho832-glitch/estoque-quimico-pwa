import { BrowserQRCodeReader } from '@zxing/browser';
import { useEffect, useRef, useState } from 'react';
import './InventoryQrScanner.css';

type ScannerControls = {
  stop: () => void;
};

type InventoryQrScannerProps = {
  onDetected: (rawValue: string) => void;
  onClose: () => void;
};

const SAME_CODE_RELEASE_DELAY_MS = 950;

type SafariWindow = Window & typeof globalThis & {
  webkitAudioContext?: typeof AudioContext;
};

export default function InventoryQrScanner({ onDetected, onClose }: InventoryQrScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<ScannerControls | null>(null);
  const onDetectedRef = useRef(onDetected);
  const blockedRawRef = useRef('');
  const lastResultAtRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const [status, setStatus] = useState('Abrindo câmera traseira...');
  const [error, setError] = useState('');

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  function playConfirmationBeep() {
    const AudioContextClass = window.AudioContext || (window as SafariWindow).webkitAudioContext;
    if (!AudioContextClass) return;

    try {
      let audioContext = audioContextRef.current;
      if (!audioContext || audioContext.state === 'closed') {
        audioContext = new AudioContextClass();
        audioContextRef.current = audioContext;
      }

      const playTone = () => {
        if (!audioContext) return;

        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const startAt = audioContext.currentTime;

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(920, startAt);
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(0.18, startAt + 0.008);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.095);

        oscillator.connect(gain);
        gain.connect(audioContext.destination);
        oscillator.start(startAt);
        oscillator.stop(startAt + 0.1);
      };

      if (audioContext.state === 'suspended') {
        void audioContext.resume().then(playTone).catch(() => undefined);
      } else {
        playTone();
      }
    } catch (audioError) {
      console.warn('Não foi possível reproduzir o beep do leitor.', audioError);
    }
  }

  useEffect(() => {
    let mounted = true;
    const reader = new BrowserQRCodeReader(undefined, {
      delayBetweenScanAttempts: 100,
      delayBetweenScanSuccess: 250,
    });

    const releaseTimer = window.setInterval(() => {
      if (
        blockedRawRef.current
        && Date.now() - lastResultAtRef.current > SAME_CODE_RELEASE_DELAY_MS
      ) {
        blockedRawRef.current = '';
        if (mounted) setStatus('Pronto para o próximo item');
      }
    }, 200);

    async function startScanner() {
      const video = videoRef.current;
      if (!video) return;

      try {
        const controls = await reader.decodeFromConstraints(
          {
            audio: false,
            video: {
              facingMode: { ideal: 'environment' },
              width: { ideal: 1280 },
              height: { ideal: 720 },
            },
          },
          video,
          (result) => {
            if (!result || !mounted) return;

            const rawValue = result.getText().trim();
            if (!rawValue) return;

            const now = Date.now();
            lastResultAtRef.current = now;

            if (rawValue === blockedRawRef.current) {
              setStatus('Item contabilizado. Afaste o QR para liberar outra leitura igual.');
              return;
            }

            blockedRawRef.current = rawValue;
            onDetectedRef.current(rawValue);
            playConfirmationBeep();
            setStatus('Item contabilizado. Aponte para o próximo QR Code.');

            if ('vibrate' in navigator) navigator.vibrate(60);
          },
        );

        if (!mounted) {
          controls.stop();
          return;
        }

        controlsRef.current = controls;
        setStatus('Aponte a câmera para o primeiro QR Code');
      } catch (scannerError) {
        console.error(scannerError);
        if (!mounted) return;

        const message = scannerError instanceof Error ? scannerError.message : '';
        if (/permission|notallowed|denied/i.test(message)) {
          setError('Permissão da câmera negada. Libere a câmera nas configurações do navegador.');
        } else if (/notfound|device/i.test(message)) {
          setError('Nenhuma câmera compatível foi encontrada neste aparelho.');
        } else {
          setError('Não foi possível abrir a câmera. Feche outros aplicativos que estejam usando a câmera e tente novamente.');
        }
      }
    }

    void startScanner();

    return () => {
      mounted = false;
      window.clearInterval(releaseTimer);
      controlsRef.current?.stop();
      controlsRef.current = null;
      void audioContextRef.current?.close().catch(() => undefined);
      audioContextRef.current = null;
    };
  }, []);

  function closeScanner() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    void audioContextRef.current?.close().catch(() => undefined);
    audioContextRef.current = null;
    onClose();
  }

  return (
    <div className="inventory-scanner-backdrop" role="dialog" aria-modal="true" aria-label="Leitor contínuo do inventário">
      <section className="inventory-scanner-dialog">
        <header className="inventory-scanner-header">
          <div>
            <span className="eyebrow">CONTAGEM CONTÍNUA</span>
            <h2>Leia os produtos do estoque</h2>
            <p>Cada leitura soma uma unidade pelo conjunto E-code + lote.</p>
          </div>
          <button type="button" className="inventory-scanner-close" onClick={closeScanner} aria-label="Fechar leitor">✕</button>
        </header>

        <div className="inventory-scanner-view">
          <video ref={videoRef} muted playsInline autoPlay />
          <div className="inventory-scanner-mask" aria-hidden="true">
            <div className="inventory-scanner-frame">
              <span className="inventory-scanner-line" />
            </div>
          </div>
        </div>

        <p className={error ? 'inventory-scanner-status inventory-scanner-error' : 'inventory-scanner-status'}>
          {error || status}
        </p>

        <p className="inventory-scanner-help">
          Para contar outra unidade com o mesmo QR, afaste a etiqueta da câmera e aproxime novamente.
        </p>

        <button type="button" className="inventory-scanner-finish" onClick={closeScanner}>
          Voltar para a lista temporária
        </button>
      </section>
    </div>
  );
}
