import { useEffect, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import type { TechnicalSheet } from '../types';
import './technical-sheet.css';

type Props = {
  technicalSheet?: TechnicalSheet;
};

const GROUPS: Array<{ title: string; fields: Array<[keyof TechnicalSheet, string]> }> = [
  {
    title: 'Identificação',
    fields: [
      ['manufacturer', 'Fabricante'],
      ['partNumber', 'Part Number (PN)'],
      ['sapCode', 'Código SAP'],
      ['color', 'Cor'],
      ['packageWeight', 'Peso da embalagem'],
    ],
  },
  {
    title: 'Mistura e aplicação',
    fields: [
      ['hardener', 'Endurecedor'],
      ['thinner', 'Diluente / água'],
      ['mixingRatio', 'Proporção de mistura'],
      ['potLife', 'Pot life'],
      ['coats', 'Demãos'],
      ['flashOff', 'Flash-off'],
      ['wetFilmThickness', 'Espessura úmida (WFT)'],
      ['dryFilmThickness', 'Espessura seca (DFT)'],
    ],
  },
  {
    title: 'Secagem e cura a 23 °C',
    fields: [
      ['dustFree23C', 'Livre de pó'],
      ['handling23C', 'Manuseio'],
      ['recoat23C', 'Repintura'],
      ['fullCure23C', 'Cura total'],
    ],
  },
  {
    title: 'Cura acelerada',
    fields: [
      ['handling40C', 'Manuseio a 40 °C'],
      ['fullCure40C', 'Cura total a 40 °C'],
      ['handling60C', 'Manuseio a 60 °C'],
      ['recoat60C', 'Repintura a 60 °C'],
      ['fullCure60C', 'Cura total a 60 °C'],
    ],
  },
  {
    title: 'Condições e armazenamento',
    fields: [
      ['applicationTemperature', 'Temperatura de aplicação'],
      ['maxHumidity', 'Umidade máxima'],
      ['storage', 'Armazenamento'],
    ],
  },
];

export default function TechnicalSheetPanel({ technicalSheet }: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const hasData = technicalSheet && Object.entries(technicalSheet).some(([key, value]) => key !== 'updatedAt' && Boolean(value));

  useEffect(() => {
    if (!modalOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModalOpen(false);
    };

    window.addEventListener('keydown', closeWithEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeWithEscape);
    };
  }, [modalOpen]);

  function closeFromBackdrop(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) setModalOpen(false);
  }

  if (!hasData) {
    return (
      <section className="technical-sheet-card technical-sheet-empty">
        <div className="technical-sheet-heading">
          <span className="technical-sheet-icon">📋</span>
          <div>
            <strong>Ficha técnica</strong>
            <small>Sem informações cadastradas</small>
          </div>
        </div>
      </section>
    );
  }

  const modal = modalOpen && typeof document !== 'undefined'
    ? createPortal(
        <div className="technical-sheet-backdrop" onMouseDown={closeFromBackdrop}>
          <section className="technical-sheet-modal" role="dialog" aria-modal="true" aria-labelledby="technical-sheet-title">
            <header className="technical-sheet-modal-header">
              <div>
                <span className="technical-sheet-modal-kicker">FICHA TÉCNICA</span>
                <h2 id="technical-sheet-title">Informações do produto</h2>
                <p>Mistura, aplicação, secagem, cura e armazenamento.</p>
              </div>
              <button type="button" className="technical-sheet-close" onClick={() => setModalOpen(false)} aria-label="Fechar ficha técnica">×</button>
            </header>

            <div className="technical-sheet-modal-body">
              {GROUPS.map((group) => {
                const populatedFields = group.fields.filter(([key]) => technicalSheet?.[key]);
                if (!populatedFields.length) return null;

                return (
                  <section className="technical-sheet-group" key={group.title}>
                    <h3>{group.title}</h3>
                    <dl>
                      {populatedFields.map(([key, label]) => (
                        <div key={key}>
                          <dt>{label}</dt>
                          <dd>{technicalSheet?.[key]}</dd>
                        </div>
                      ))}
                    </dl>
                  </section>
                );
              })}

              {technicalSheet?.notes && <p className="technical-sheet-notes"><strong>Observações:</strong> {technicalSheet.notes}</p>}

              {(technicalSheet?.technicalDataSheetUrl || technicalSheet?.safetyDataSheetUrl) && (
                <div className="technical-sheet-links">
                  {technicalSheet.technicalDataSheetUrl && (
                    <a href={technicalSheet.technicalDataSheetUrl} target="_blank" rel="noreferrer">📄 Abrir ficha técnica</a>
                  )}
                  {technicalSheet.safetyDataSheetUrl && (
                    <a href={technicalSheet.safetyDataSheetUrl} target="_blank" rel="noreferrer">☣️ Abrir FISPQ / SDS</a>
                  )}
                </div>
              )}
            </div>

            <footer className="technical-sheet-modal-footer">
              <button type="button" onClick={() => setModalOpen(false)}>Fechar ficha técnica</button>
            </footer>
          </section>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button type="button" className="technical-sheet-card" onClick={() => setModalOpen(true)}>
        <span className="technical-sheet-icon">📋</span>
        <span className="technical-sheet-heading-text">
          <strong>Ficha técnica</strong>
          <small>Consultar mistura, aplicação, secagem e cura</small>
        </span>
      </button>
      {modal}
    </>
  );
}
