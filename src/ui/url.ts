/**
 * Serializacion de la cotizacion en el query string.
 *
 * Permite compartir o guardar una comparacion concreta. Ver spec 3.7.
 *
 *   /?w=5.5&v=250&c=laptops-computadoras
 */

export interface UrlParams {
  weightLb: number | null;
  declaredValueUsd: number | null;
  categoryId: string | null;
}

const PARAM_WEIGHT = 'w';
const PARAM_VALUE = 'v';
const PARAM_CATEGORY = 'c';

function parseNumber(raw: string | null, min: number): number | null {
  if (raw === null || raw.trim() === '') return null;
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value) || value < min) return null;
  return value;
}

/**
 * Los parametros invalidos se ignoran uno a uno en vez de descartar todo el
 * enlace: si el peso viene corrupto pero el valor no, se conserva el valor.
 * Ver spec 4.9.
 */
export function parseParams(search: string): UrlParams {
  const params = new URLSearchParams(search);

  const categoryId = params.get(PARAM_CATEGORY)?.trim();

  return {
    weightLb: parseNumber(params.get(PARAM_WEIGHT), Number.MIN_VALUE),
    declaredValueUsd: parseNumber(params.get(PARAM_VALUE), 0),
    categoryId: categoryId ? categoryId : null,
  };
}

/**
 * Query string para la cotizacion actual, con `?` incluido. Devuelve cadena
 * vacia si no hay nada que compartir, para no dejar un `?` suelto en la barra.
 */
export function buildSearch(input: UrlParams): string {
  const params = new URLSearchParams();

  if (input.weightLb !== null && Number.isFinite(input.weightLb) && input.weightLb > 0) {
    params.set(PARAM_WEIGHT, String(input.weightLb));
  }
  if (
    input.declaredValueUsd !== null &&
    Number.isFinite(input.declaredValueUsd) &&
    input.declaredValueUsd >= 0
  ) {
    params.set(PARAM_VALUE, String(input.declaredValueUsd));
  }
  if (input.categoryId) {
    params.set(PARAM_CATEGORY, input.categoryId);
  }

  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}
