/**
 * Renderizado de resultados a HTML.
 *
 * Son funciones puras que devuelven cadenas: no tocan el DOM. La pagina se
 * limita a insertarlas. Esto permite probar la salida sin navegador, que es
 * donde mas facil se cuela un error de presentacion.
 */

import type { Offer, QuoteResult, UnavailableOffer } from '../engine/types.js';
import {
  MODE_LABEL,
  TAXABLE_BASE_LABEL,
  escapeHtml,
  isoDateToLocal,
  money,
  percent,
  relativeTime,
  weight,
} from './format.js';
import type { HistoryEntry } from './history.js';

export function emptyState(message: string): string {
  return `<p class="empty">${escapeHtml(message)}</p>`;
}

/** Mensaje de estado inicial, o `null` si la entrada ya permite cotizar. */
export function inputPrompt(
  weightLb: number,
  declaredValueUsd: number,
): string | null {
  if (!Number.isFinite(weightLb) || weightLb <= 0) {
    return 'Ingresá el peso del paquete para comparar.';
  }
  if (!Number.isFinite(declaredValueUsd) || declaredValueUsd < 0) {
    return 'Ingresá el valor de tu compra: define los impuestos.';
  }
  return null;
}

export function breakdownRows(offer: Offer): string {
  const b = offer.breakdown;
  const rows: Array<[string, string]> = [
    ['Peso facturable', `${weight(b.billableWeightLb)} a ${money(b.ratePerLbUsd)}/lb`],
    ['Flete', money(b.freightUsd)],
  ];

  // Cargos propios del proveedor: Quickbox cobra gestión de aeropuerto y un
  // cargo administrativo que no son flete ni impuesto.
  for (const charge of b.extraCharges) {
    rows.push([escapeHtml(charge.label), money(charge.amountUsd)]);
  }

  // Quickbox no publica la base gravable de su IVA. Poner el valor de factura
  // en su lugar seria inventar el dato, así que la fila se omite.
  if (b.taxableBaseDisclosed) {
    rows.push([
      TAXABLE_BASE_LABEL[b.taxableBaseKind] ?? b.taxableBaseKind,
      money(b.taxableBaseUsd),
    ]);

    if (b.taxableBaseKind === 'cif') {
      rows.push(['&nbsp;&nbsp;Seguro', money(b.insuranceUsd)]);
      rows.push(['&nbsp;&nbsp;Flete aduanero', money(b.customsFreightUsd)]);
    }
  }

  rows.push([`DAI (${percent(b.daiRate)})`, money(b.daiUsd)]);
  rows.push([`IVA (${percent(b.vatRate)})`, money(b.vatUsd)]);
  rows.push(['Total impuestos', money(b.taxesTotalUsd)]);

  return rows
    .map(([label, value]) => `<div class="row"><dt>${label}</dt><dd>${value}</dd></div>`)
    .join('');
}

export function offerCard(
  offer: Offer,
  options: { cheapest: boolean; savingUsd: number },
): string {
  const notes = offer.notes.length
    ? `<ul class="notes">${offer.notes
        .map((n) => `<li>${escapeHtml(n)}</li>`)
        .join('')}</ul>`
    : '';

  // Ningun proveedor publica plazos: estos rangos vienen de experiencia de uso,
  // asi que se etiquetan como referenciales en vez de presentarlos como oficiales.
  const transit = offer.transitDays
    ? `<span class="offer__transit" title="Rango referencial en días corridos, no un plazo oficial del proveedor">${offer.transitDays.min} a ${offer.transitDays.max} días <abbr>(referencial)</abbr></span>`
    : '';

  const badge = options.cheapest
    ? `<span class="badge">Más barato${
        options.savingUsd > 0 ? ` · ahorrás ${money(options.savingUsd)}` : ''
      }</span>`
    : offer.subscription
      ? `<span class="badge badge--subscription">Requiere plan de ${money(
          offer.subscription.costUsd,
        )}</span>`
      : '';

  const subscription = offer.subscription
    ? `<p class="offer__subscription">
        Este precio por libra requiere el plan <strong>${escapeHtml(
          offer.subscription.planName,
        )}</strong>: ${money(offer.subscription.costUsd)} por ${
          offer.subscription.periodMonths
        } meses, con ${offer.subscription.includedLb} lb incluidas. El total de
        arriba <strong>no incluye</strong> el costo del plan, así que no es
        comparable directamente. Conviene desde unas
        ${offer.subscription.breakEvenLbPerPeriod} lb al año.
      </p>`
    : '';

  return `<article class="offer${options.cheapest ? ' offer--cheapest' : ''}">
  <details${options.cheapest ? ' open' : ''}>
    <summary>
      <div class="offer__head">
        <div class="offer__id">
          ${badge}
          <h3>${escapeHtml(offer.providerName)}</h3>
          <span class="offer__mode">${MODE_LABEL[offer.mode] ?? offer.mode}</span>
          ${transit}
        </div>
        <strong class="offer__total">${money(offer.totalUsd)}</strong>
      </div>
      <span class="offer__toggle" aria-hidden="true">Ver desglose</span>
    </summary>
    ${subscription}
    <dl class="breakdown">${breakdownRows(offer)}</dl>
    ${notes}
  </details>
  <footer class="offer__foot">
    <span>Tarifas verificadas el ${isoDateToLocal(offer.ratesVerifiedAt)}</span>
    <a href="${escapeHtml(offer.officialQuoterUrl)}" target="_blank" rel="noopener noreferrer">Confirmar en su cotizador</a>
  </footer>
</article>`;
}

/** Tarjeta de carga de un proveedor que se consulta en vivo. */
export function pendingCard(providerName: string, mode: string): string {
  return `<article class="offer offer--pending" aria-busy="true">
  <div class="offer__head">
    <div class="offer__id">
      <h3>${escapeHtml(providerName)}</h3>
      <span class="offer__mode">${MODE_LABEL[mode] ?? mode}</span>
    </div>
    <span class="offer__total offer__total--none">Consultando…</span>
  </div>
  <p class="offer__reason">Quickbox calcula en su propio servidor, así que esta tarjeta se completa al llegar su respuesta.</p>
</article>`;
}

export function unavailableCard(offer: UnavailableOffer): string {
  return `<article class="offer offer--unavailable">
  <div class="offer__head">
    <div class="offer__id">
      <h3>${escapeHtml(offer.providerName)}</h3>
      <span class="offer__mode">${MODE_LABEL[offer.mode] ?? offer.mode}</span>
    </div>
    <span class="offer__total offer__total--none">No disponible</span>
  </div>
  <p class="offer__reason">${escapeHtml(offer.detail)}</p>
  <footer class="offer__foot">
    <a href="${escapeHtml(offer.officialQuoterUrl)}" target="_blank" rel="noopener noreferrer">Ver su cotizador</a>
  </footer>
</article>`;
}

export interface RenderOptions {
  /** Etiqueta de la categoria elegida, para confirmarla en los resultados. */
  categoryLabel?: string | null;
  /** Valor bajo el cual ningun proveedor cobra DAI. */
  daiExemptBelowUsd?: number;
  /**
   * `true` mientras se espera la respuesta de Quickbox. Se muestra una tarjeta
   * de carga en vez de omitirlo: si desapareciera y luego apareciera, el
   * usuario podria decidir con una comparacion incompleta sin notarlo.
   */
  quickboxPending?: boolean;
}

export function renderResults(
  result: QuoteResult,
  options: RenderOptions = {},
): string {
  const prompt = inputPrompt(result.input.weightLb, result.input.declaredValueUsd);
  if (prompt) return emptyState(prompt);

  // Cuando no hay ninguna oferta y elegir categoria desbloquearia al menos una,
  // un solo mensaje comunica mejor que tres tarjetas de error. Ver spec 4.4.
  //
  // Se usa `some` y no `every` a proposito: con factura sobre $300 y peso bajo
  // 8 lb conviven dos motivos (falta categoria y el maritimo no aplica), pero
  // la accion del usuario sigue siendo una sola. Con `every` no se consolidaba.
  const needsCategory =
    result.offers.length === 0 &&
    !options.quickboxPending &&
    result.unavailable.some((o) => o.reason === 'category-required');

  if (needsCategory) {
    return emptyState(
      'Elegí la categoría del artículo: sobre $300 el arancel depende de ella.',
    );
  }

  if (
    result.offers.length === 0 &&
    result.unavailable.length === 0 &&
    !options.quickboxPending
  ) {
    return emptyState('Ningún proveedor puede cotizar este paquete.');
  }

  // El distintivo de "mas barato" solo puede ir a una oferta comparable: las
  // que exigen suscripcion no incluyen su costo en el total, asi que rankearlas
  // como ganadoras seria enganoso.
  const comparables = result.offers.filter((o) => !o.subscription);
  const cheapest = comparables[0];
  const dearest = comparables[comparables.length - 1];
  const savingUsd =
    cheapest && dearest && comparables.length > 1
      ? dearest.totalUsd - cheapest.totalUsd
      : 0;

  const offersHtml = result.offers
    .map((offer) =>
      offerCard(offer, {
        cheapest: comparables.length > 1 && offer === cheapest,
        savingUsd,
      }),
    )
    .join('');

  // Confirmar la categoria aplicada importa mas de lo que parece: bajo el
  // umbral de exencion cambiarla no mueve ningun total, y sin este eco el
  // usuario no tiene forma de saber si su eleccion se registro.
  const exemptBelow = options.daiExemptBelowUsd;
  const isExempt =
    exemptBelow !== undefined && result.input.declaredValueUsd < exemptBelow;

  let applied = '';
  if (options.categoryLabel) {
    const suffix = isExempt
      ? ' · no afecta el total bajo $' + exemptBelow
      : '';
    applied = `<span class="results__applied">${escapeHtml(
      options.categoryLabel,
    )}${suffix}</span>`;
  }

  const title =
    result.offers.length > 0
      ? `<h2 class="results__title">${result.offers.length} ${
          result.offers.length === 1 ? 'opción' : 'opciones'
        } para traer tu compra${applied}</h2>`
      : '';

  // La tarjeta pendiente va al final de las disponibles: no se conoce su total,
  // asi que no se puede ubicar en el orden por precio todavia.
  const pendingHtml = options.quickboxPending
    ? pendingCard('Quickbox', 'aereo')
    : '';

  const unavailableHtml = result.unavailable.length
    ? `<h2 class="results__subtitle">No disponibles para este paquete</h2>${result.unavailable
        .map(unavailableCard)
        .join('')}`
    : '';

  return title + offersHtml + pendingHtml + unavailableHtml;
}

/**
 * Historial de cotizaciones previas.
 *
 * Cada entrada es un boton: recargarla en el formulario es la accion principal,
 * asi que tiene que ser alcanzable con teclado, no solo con clic.
 */
export function renderHistory(entries: HistoryEntry[], nowMs: number): string {
  if (entries.length === 0) return '';

  const items = entries
    .map((e) => {
      const categoria = e.categoryLabel
        ? ` · ${escapeHtml(e.categoryLabel)}`
        : '';

      return `<li class="history__item">
  <button type="button" class="history__load" data-id="${escapeHtml(e.id)}">
    <span class="history__inputs">${weight(e.weightLb)} · ${money(
      e.declaredValueUsd,
    )}${categoria}</span>
    <span class="history__best">${escapeHtml(e.cheapest.providerName)} ${
      MODE_LABEL[e.cheapest.mode] ?? e.cheapest.mode
    } · ${money(e.cheapest.totalUsd)}</span>
    <span class="history__when">${escapeHtml(
      relativeTime(e.savedAt, nowMs),
    )}</span>
  </button>
  <button type="button" class="history__remove" data-remove="${escapeHtml(
    e.id,
  )}" aria-label="Quitar del historial">&times;</button>
</li>`;
    })
    .join('');

  return `<h2 class="results__subtitle">Cotizaciones anteriores</h2>
<ul class="history">${items}</ul>
<button type="button" id="historial-limpiar" class="history__clear">Borrar historial</button>`;
}
