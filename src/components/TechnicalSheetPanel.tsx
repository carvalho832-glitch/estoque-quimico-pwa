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
  const hasData = technicalSheet && Object.entries(technicalSheet).some(([key, value]) => key !== 'updatedAt' && Boolean(value));

  if (!hasData) {
    return (
      <section className="technical-sheet technical-sheet-empty">
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

  return (
    <details className="technical-sheet">
      <summary className="technical-sheet-heading">
        <span className="technical-sheet-icon">📋</span>
        <div>
          <strong>Ficha técnica</strong>
          <small>Consultar mistura, aplicação, secagem e cura</small>
        </div>
        <span className="technical-sheet-chevron" aria-hidden="true">⌄</span>
      </summary>

      <div className="technical-sheet-content">
        {GROUPS.map((group) => {
          const populatedFields = group.fields.filter(([key]) => technicalSheet?.[key]);
          if (!populatedFields.length) return null;

          return (
            <section className="technical-sheet-group" key={group.title}>
              <h4>{group.title}</h4>
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
    </details>
  );
}