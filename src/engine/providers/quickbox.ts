/**
 * Motor de Quickbox: cotizacion en vivo.
 *
 * A diferencia de Shop USA y Buyex, aqui no hay formula replicada. Quickbox
 * calcula del lado del servidor y su cliente solo envia
 * `{valor, peso, arancel_id, pais_id, plan_id, cliente_id}` a
 * `POST https://node.qs.gt/cotizador`. Su API responde sin autenticacion y con
 * `Access-Control-Allow-Origin: *`, asi que el navegador puede consultarla.
 *
 * Se eligio consultar en vivo en vez de deducir la formula por muestreo porque
 * dos de sus cargos son compuestos sobre un CIF que no publican, y una formula
 * derivada fallaria justo en los bordes. Ejemplo medido: con arancel del 15%,
 * el DAI de una factura de $301 es $48.30 y no $45.15, porque la base es 322.
 * Un numero equivocado con aire de exacto es peor que no mostrar la tarjeta.
 *
 * El costo de la decision es que esta tarjeta depende de un tercero. Cuando su
 * API no responde, se emite `provider-unreachable` y los otros dos proveedores
 * siguen comparandose.
 */

import { round2 } from '../money.js';
import type {
  ExtraCharge,
  Offer,
  ProviderOffer,
  QuickboxPlan,
  QuickboxRates,
  UnavailableOffer,
} from '../types.js';

const MODE = 'aereo' as const;
const offerIdFor = (planId: string) => `quickbox:aereo:${planId}`;

/** tipo_gasto en la respuesta de Quickbox. */
const GASTO_FLETE = 2;
const GASTO_DAI = 9;
const GASTO_IVA = 10;

export interface QuickboxQuoteInput {
  weightLb: number;
  declaredValueUsd: number;
  /** Id de arancel de su catalogo. `null` si la categoria no esta mapeada. */
  arancelId: string | null;
  /** Etiqueta de la categoria elegida, solo para los mensajes. */
  categoryLabel: string | null;
  /** `true` cuando el mapeo no es exacto y hay que advertirlo. */
  approximate: boolean;
}

/** Clave de cache: los datos que determinan la respuesta, plan incluido. */
export function quickboxCacheKey(input: {
  weightLb: number;
  declaredValueUsd: number;
  arancelId: string;
  planId: string;
}): string {
  return `${input.weightLb}|${input.declaredValueUsd}|${input.arancelId}|${input.planId}`;
}

/**
 * Libras por periodo desde las que el plan con suscripcion sale mas barato que
 * pagar por envio.
 *
 * Mientras el peso acumulado no pase las libras incluidas, el plan cuesta su
 * precio fijo y el pago por envio cuesta peso x tarifa; el equilibrio esta donde
 * se cruzan. Pasadas las libras incluidas el plan ya gana siempre, porque su
 * tarifa por libra tambien es menor.
 */
export function breakEvenLb(plan: QuickboxPlan, payPerUse: QuickboxPlan): number {
  if (plan.costoPlanUsd <= 0 || payPerUse.costoLibraUsd <= 0) return 0;
  return Math.ceil(plan.costoPlanUsd / payPerUse.costoLibraUsd);
}

interface QuickboxCharge {
  tipo_gasto: number;
  nombre: string;
  valor_numerico: number;
}

/** Lo que se guarda en cache: la respuesta ya normalizada, no el JSON crudo. */
export interface QuickboxQuote {
  billableWeightLb: number;
  ratePerLbUsd: number;
  freightUsd: number;
  extraCharges: ExtraCharge[];
  daiUsd: number;
  vatUsd: number;
  vatRate: number;
  taxesTotalUsd: number;
  totalUsd: number;
  arancelDescription: string;
}

export type QuickboxFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(n) ? n : 0;
}

/** "13%" -> 0.13 */
function parseRate(value: unknown): number {
  const n = Number.parseFloat(String(value).replace('%', ''));
  return Number.isFinite(n) ? n / 100 : 0;
}

function charges(list: unknown): QuickboxCharge[] {
  if (!Array.isArray(list)) return [];
  return list.filter(
    (x): x is QuickboxCharge =>
      typeof x === 'object' && x !== null && 'tipo_gasto' in x,
  );
}

/** Normaliza la respuesta cruda de Quickbox. Lanza si no tiene la forma esperada. */
export function parseQuickboxResponse(payload: unknown): QuickboxQuote {
  if (typeof payload !== 'object' || payload === null) {
    throw new Error('respuesta vacía');
  }
  const body = payload as { result?: unknown; records?: unknown; message?: unknown };
  if (body.result !== true || typeof body.records !== 'object' || body.records === null) {
    throw new Error(String(body.message ?? 'respuesta sin datos'));
  }

  const r = body.records as Record<string, unknown>;
  const servicios = charges(r.servicios);
  const impuestos = charges(r.impuestos);

  const flete = servicios.find((x) => x.tipo_gasto === GASTO_FLETE);
  const dai = impuestos.find((x) => x.tipo_gasto === GASTO_DAI);
  const iva = impuestos.find((x) => x.tipo_gasto === GASTO_IVA);

  // El total es el dato que el usuario compara: sin el, la respuesta no sirve.
  const total = num(r.total_dolares);
  if (total <= 0) throw new Error('respuesta sin total');

  return {
    // Quickbox devuelve el peso ya redondeado a libra completa.
    billableWeightLb: num(r.peso),
    ratePerLbUsd: num(r.costo_libra),
    freightUsd: round2(num(flete?.valor_numerico)),
    extraCharges: servicios
      .filter((x) => x.tipo_gasto !== GASTO_FLETE)
      .map((x) => ({ label: String(x.nombre), amountUsd: round2(num(x.valor_numerico)) })),
    daiUsd: round2(num(dai?.valor_numerico)),
    vatUsd: round2(num(iva?.valor_numerico)),
    vatRate: parseRate(r.tasa_impuesto),
    taxesTotalUsd: round2(num(r.total_impuestos)),
    totalUsd: round2(total),
    arancelDescription: String(r.descripcion_arancel ?? '').trim(),
  };
}

function unavailable(
  rates: QuickboxRates,
  planId: string,
  reason: UnavailableOffer['reason'],
  detail: string,
): UnavailableOffer {
  return {
    available: false,
    offerId: offerIdFor(planId),
    providerId: rates.providerId,
    providerName: rates.providerName,
    mode: MODE,
    reason,
    detail,
    officialQuoterUrl: rates.officialQuoterUrl,
  };
}

export interface QuoteQuickboxDeps {
  rates: QuickboxRates;
  fetchImpl?: QuickboxFetch;
  cache?: { get(key: string): QuickboxQuote | undefined; set(key: string, value: QuickboxQuote): void };
}

/**
 * Cotiza Quickbox en todos sus planes.
 *
 * Devuelve una oferta por plan, igual que Buyex devuelve una por modalidad. El
 * plan con suscripcion se marca con `subscription` para que la UI no lo trate
 * como comparable cabeza a cabeza: su total no incluye el costo del plan.
 */
export async function quoteQuickbox(
  input: QuickboxQuoteInput,
  deps: QuoteQuickboxDeps,
): Promise<ProviderOffer[]> {
  const { rates } = deps;
  const payPerUse = rates.plans[0];
  if (!payPerUse) return [];

  // Sin categoria elegida, bajo el umbral se puede cotizar igual: su API exige
  // un arancel pero por debajo de ese valor no cobra DAI, asi que cualquiera da
  // el mismo total. Con categoria elegida pero sin mapeo, no se inventa nada.
  const exempt = input.declaredValueUsd <= rates.daiThresholdUsd;
  const arancelId =
    input.arancelId ??
    (input.categoryLabel === null && exempt
      ? rates.noCategoryArancel.arancelId
      : null);

  if (arancelId === null) {
    const detail = input.categoryLabel
      ? `Quickbox no tiene un arancel equivalente a "${input.categoryLabel}".`
      : `Quickbox necesita la categoría para calcular el DAI en facturas mayores a $${rates.daiThresholdUsd}.`;
    const reason = input.categoryLabel ? 'category-not-mapped' : 'category-required';
    // Un solo aviso: la causa no depende del plan.
    return [unavailable(rates, payPerUse.planId, reason, detail)];
  }

  const results = await Promise.all(
    rates.plans.map((plan) =>
      quoteOnePlan({ ...input, arancelId }, plan, payPerUse, deps),
    ),
  );
  return results;
}

async function quoteOnePlan(
  input: QuickboxQuoteInput & { arancelId: string },
  plan: QuickboxPlan,
  payPerUse: QuickboxPlan,
  deps: QuoteQuickboxDeps,
): Promise<ProviderOffer> {
  const { rates, cache } = deps;

  const key = quickboxCacheKey({
    weightLb: input.weightLb,
    declaredValueUsd: input.declaredValueUsd,
    arancelId: input.arancelId,
    planId: plan.planId,
  });

  let quote = cache?.get(key);

  if (!quote) {
    try {
      quote = await request(input, plan, rates, deps.fetchImpl);
      cache?.set(key, quote);
    } catch (error) {
      return unavailable(
        rates,
        plan.planId,
        'provider-unreachable',
        `No se pudo consultar a Quickbox ahora (${
          error instanceof Error ? error.message : 'error desconocido'
        }). Los demás proveedores sí se compararon.`,
      );
    }
  }

  const notes = [...rates.notes];
  if (input.approximate && input.categoryLabel) {
    notes.push(
      `Quickbox no tiene un arancel exacto para "${input.categoryLabel}"; se usa el más cercano de su catálogo, así que puede diferir.`,
    );
  }
  if (quote.arancelDescription) {
    notes.push(`Arancel aplicado por Quickbox: ${quote.arancelDescription}.`);
  }

  const isSubscription = plan.costoPlanUsd > 0;
  if (isSubscription) {
    notes.push(rates.subscriptionNote);
  }

  const offer: Offer = {
    available: true,
    offerId: offerIdFor(plan.planId),
    providerId: rates.providerId,
    providerName: `${rates.providerName} ${plan.nombre}`,
    mode: MODE,
    officialQuoterUrl: rates.officialQuoterUrl,
    totalUsd: quote.totalUsd,
    breakdown: {
      billableWeightLb: quote.billableWeightLb,
      ratePerLbUsd: quote.ratePerLbUsd,
      freightUsd: quote.freightUsd,
      extraCharges: quote.extraCharges,
      taxableBaseKind: 'cif',
      taxableBaseUsd: 0,
      // Su IVA se llama "IVA - CIF" pero no devuelven el CIF. Mostrar el valor
      // de factura en su lugar seria inventar el dato.
      taxableBaseDisclosed: false,
      insuranceUsd: 0,
      customsFreightUsd: 0,
      daiRate: deriveDaiRate(quote),
      daiUsd: quote.daiUsd,
      vatRate: quote.vatRate,
      vatUsd: quote.vatUsd,
      taxesTotalUsd: quote.taxesTotalUsd,
    },
    transitDays: rates.modes.aereo.transitDays,
    confidence: rates.confidence,
    ratesVerifiedAt: rates.verifiedAt,
    notes,
    ...(isSubscription
      ? {
          subscription: {
            planName: plan.nombre,
            costUsd: plan.costoPlanUsd,
            periodMonths: plan.duracionMeses,
            includedLb: plan.librasIncluidas,
            breakEvenLbPerPeriod: breakEvenLb(plan, payPerUse),
          },
        }
      : {}),
  };

  return offer;
}

/**
 * El porcentaje del arancel viene en el texto que Quickbox devuelve
 * ("Accesorio de Cámara 0%"), no como numero. Se lee de ahi para poder
 * mostrarlo en el desglose sin depender del mapeo local.
 */
function deriveDaiRate(quote: QuickboxQuote): number {
  const match = /(\d+(?:\.\d+)?)\s*%\s*$/.exec(quote.arancelDescription);
  return match ? Number.parseFloat(match[1]!) / 100 : 0;
}

async function request(
  input: QuickboxQuoteInput,
  plan: QuickboxPlan,
  rates: QuickboxRates,
  fetchImpl?: QuickboxFetch,
): Promise<QuickboxQuote> {
  const doFetch = (fetchImpl ?? (globalThis.fetch as unknown as QuickboxFetch));
  if (!doFetch) throw new Error('sin fetch disponible');

  const body = new URLSearchParams({
    valor: String(input.declaredValueUsd),
    peso: String(input.weightLb),
    arancel_id: String(input.arancelId),
    pais_id: rates.paisId,
    plan_id: plan.planId,
    cliente_id: '',
  }).toString();

  // Sin timeout, una API lenta dejaria la tarjeta cargando indefinidamente.
  const controller =
    typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), rates.timeoutMs)
    : undefined;

  try {
    const res = await doFetch(rates.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      ...(controller ? { signal: controller.signal } : {}),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseQuickboxResponse(await res.json());
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
