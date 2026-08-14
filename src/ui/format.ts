/**
 * Formateo para la interfaz. Separado de la UI para poder probarlo.
 */

const MONEY = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function money(value: number): string {
  return MONEY.format(value);
}

/** 0.15 -> "15%", 0.145 -> "14.5%". */
export function percent(rate: number): string {
  const pct = rate * 100;
  const rounded = Math.round(pct * 100) / 100;
  return `${rounded}%`;
}

export function weight(lb: number): string {
  return `${lb} ${lb === 1 ? 'lb' : 'lbs'}`;
}

/**
 * "2026-08-13" -> "13/08/2026".
 *
 * Se parsea a mano en vez de con `new Date`, que interpreta el formato ISO
 * corto como UTC y en zonas con offset negativo devuelve el dia anterior.
 */
export function isoDateToLocal(iso: string): string {
  const parts = iso.split('-');
  if (parts.length !== 3) return iso;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

const RELATIVE = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
];

/** "hace 5 minutos", "ayer". Para el historial. */
export function relativeTime(timestampMs: number, nowMs: number): string {
  const diff = timestampMs - nowMs;
  const abs = Math.abs(diff);

  for (const [unit, ms] of UNITS) {
    if (abs >= ms) {
      return RELATIVE.format(Math.round(diff / ms), unit);
    }
  }
  return 'recién';
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export const MODE_LABEL: Record<string, string> = {
  aereo: 'Aéreo',
  maritimo: 'Marítimo',
};

export const TAXABLE_BASE_LABEL: Record<string, string> = {
  invoice: 'Valor de factura',
  cif: 'CIF (valor + seguro + flete aduanero)',
};
