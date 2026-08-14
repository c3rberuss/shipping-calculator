/**
 * Redondeo monetario.
 *
 * Los tres proveedores calculan en punto flotante y presentan con
 * `toFixed(2)`. Replicamos esa operacion exacta en vez de aproximarla: un
 * redondeo "equivalente" del tipo `Math.round(v * 100) / 100` diverge de
 * `toFixed(2)` en los valores que caen justo en medio centavo. Ejemplos reales
 * de esa divergencia:
 *
 *   valor      Math.round(v*100)/100    v.toFixed(2)
 *   19.485     19.49                    19.48
 *   14.495     14.50                    14.49
 *   2.675      2.68                     2.67
 *
 * Como el criterio de aceptacion es coincidir al centavo con los cotizadores
 * oficiales, la unica opcion correcta es usar su misma operacion.
 *
 * Los calculos intermedios quedan en flotante; el redondeo se aplica solo al
 * construir el desglose y el total. Ver spec 4.12.
 */
export function round2(value: number): number {
  return Number(value.toFixed(2));
}
