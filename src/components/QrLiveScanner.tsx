import { BrowserQRCodeReader } from '@zxing/browser';
import { useEffect, useRef, useState } from 'react';

type ScannerControls = {
  stop: () => void;
};

type QrLiveScannerProps = {
  onDetected: (rawValue: string, snapshotDataUrl: string) => void;
  onClose: () => void;
};

function captureFrame(video: HTMLVideoElement): string {
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;

  const context = canvas.getContext('2d');
  if (!context) return '';

  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.86);
}

export default function QrLiveScanner({ onDetected, onClose }: QrLiveScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<ScannerControls | null>(null);
  const handledRef = useRef(false);
  const [status, setStatus] = useState('Abrindo câmera traseira...');
  const [error, setError] = useState('');

  useEffect(() => {
    let mounted = true;
    const reader = new BrowserQRCodeReader(undefined, {
      delayBetweenScanAttempts: 120,
      delayBetweenScanSuccess: 700,
    });

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
          (result, _scanError, callbackControls) => {
            if (!result || handledRef.current || !mounted) return;

            handledRef.current = true;
            setStatus('QR Code identificado!');
            const snapshot = captureFrame(video);
            callbackControls.stop();
            controlsRef.current = null;
            onDetected(result.getText(), snapshot);
          },
        );

        if (!mounted) {
          controls.stop();
          return;
        }

        controlsRef.current = controls;
        setStatus('Aponte a câmera para o QR Code');
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
      controlsRef.current?.stop();
      controlsRef.current = null;
    };
  }, [onDetected]);

  function closeScanner() {
    controlsRef.current?.stop();
    controlsRef.current = null;
    onClose();
  }

  return (
    <div className="scanner-backdrop" role="dialog" aria-modal="true" aria-label="Leitor de QR Code">
      <section className="scanner-dialog">
        <div className="scanner-header">
          <div>
            <span className="eyebrow">LEITURA AUTOMÁTICA</span>
            <h2>Posicione o QR no quadrado</h2>
          </div>
          <button type="button" className="scanner-close" onClick={closeScanner} aria-label="Fechar câmera">✕</button>
        </div>

        <div className="scanner-view">
          <video ref={videoRef} muted playsInline autoPlay />
          <div className="scanner-mask" aria-hidden="true">
            <div className="scanner-frame">
              <span className="scanner-line" />
            </div>
          </div>
        </div>

        <p className={error ? 'scanner-status scanner-error' : 'scanner-status'}>
          {error || status}
        </p>

        {error && (
          <button type="button" className="secondary-button scanner-exit" onClick={closeScanner}>
            Voltar e usar foto
          </button>
        )}
      </section>
    </div>
  );
}
