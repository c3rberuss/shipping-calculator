/**
 * Motor de Shop USA.
 *
 * La formula esta replicada literalmente del bundle de produccion de su
 * calculadora (Next.js, chunk `pages/index-*.js`). Codigo original, con los
 * nombres minificados que usa el sitio:
 *
 *   G = Number.isFinite(L) && L > 0 ? Math.ceil(L) : 0     // peso facturable
 *   W = G > 0 ? (G <= 5 ? 4.99 : 4.4) : 0                  // tarifa por libra
 *   R = G * W                                              // flete
 *   q = 0.13 * D                                           // IVA sobre factura
 *   Z = D > 300 && B ? (B.tax / 100) * D : 0               // DAI
 *   H = q + Z                                              // impuestos
 *   _ = R + H                                              // total del envio
 *
 * Dos detalles que parecen bugs y no lo son:
 *
 * 1. La tarifa no es acumulativa. Un paquete de 6 lb paga 6 * 4.40, no
 *    5 * 4.99 + 1 * 4.40.
 * 2. El IVA se calcula sobre el valor de factura, no sobre el CIF ni sobre el
 *    flete. Buyex hace lo contrario, y por eso los totales divergen con los
 *    mismos inputs.
 */

import { round2 } from '../money.js';
import type {
  Offer,
  ProviderOffer,
  ProviderQuoteInput,
  ShopUsaRates,
} from '../types.js';

const MODE = 'aereo' as const;
const OFFER_ID = 'shopusa:aereo';

/** Tarifa del escalon que contiene al peso. Aplica a todo el peso. */
function ratePerLbFor(billableWeightLb: number, rates: ShopUsaRates): number {
  if (billableWeightLb <= 0) return 0;
  for (const tier of rates.modes.aereo.tiers) {
    if (tier.maxLb === null || billableWeightLb <= tier.maxLb) {
      return tier.ratePerLb;
    }
  }
  return 0;
}

export function quoteShopUsa(
  input: ProviderQuoteInput,
  rates: ShopUsaRates,
): ProviderOffer[] {
  const { weightLb, declaredValueUsd, category } = input;

  const base = {
    offerId: OFFER_ID,
    providerId: rates.providerId,
    providerName: rates.providerName,
    mode: MODE,
    officialQuoterUrl: rates.officialQuoterUrl,
  };

  const daiApplies = declaredValueUsd > rates.daiThresholdUsd;

  if (category.kind === 'not-mapped') {
    return [
      {
        ...base,
        available: false,
        reason: 'category-not-mapped',
        detail: `Shop USA no tiene una categoría equivalente a "${category.label}".`,
      },
    ];
  }

  // La categoria solo hace falta por encima del umbral: bajo el, el DAI es
  // cero y Shop USA cotiza sin pedirla. Ver spec 4.3.
  if (daiApplies && category.kind === 'none') {
    return [
      {
        ...base,
        available: false,
        reason: 'category-required',
        detail: `Shop USA necesita la categoría para calcular el DAI en facturas mayores a $${rates.daiThresholdUsd}.`,
      },
    ];
  }

  const billableWeightLb = Math.ceil(weightLb);
  const ratePerLbUsd = ratePerLbFor(billableWeightLb, rates);
  const freight = billableWeightLb * ratePerLbUsd;

  const vat = rates.vatRate * declaredValueUsd;
  const daiRate =
    daiApplies && category.kind === 'resolved' ? category.daiRate : 0;
  const dai = daiRate * declaredValueUsd;
  const taxes = vat + dai;

  const notes = [rates.volumetricNote];
  if (!daiApplies) {
    notes.push(
      `El DAI no aplica: Shop USA solo lo cobra sobre facturas mayores a $${rates.daiThresholdUsd}.`,
    );
  }
  if (daiApplies && category.kind === 'resolved' && category.match === 'approximate') {
    notes.push(
      `Shop USA no tiene una categoría exacta para "${category.label}"; se usa la más cercana de su catálogo, así que el arancel puede diferir.`,
    );
  }

  const offer: Offer = {
    ...base,
    available: true,
    totalUsd: round2(freight + taxes),
    breakdown: {
      billableWeightLb,
      ratePerLbUsd,
      freightUsd: round2(freight),
      extraCharges: [],
      taxableBaseKind: rates.taxableBaseKind,
      taxableBaseUsd: round2(declaredValueUsd),
      taxableBaseDisclosed: true,
      insuranceUsd: 0,
      customsFreightUsd: 0,
      daiRate,
      daiUsd: round2(dai),
      vatRate: rates.vatRate,
      vatUsd: round2(vat),
      taxesTotalUsd: round2(taxes),
    },
    transitDays: rates.modes.aereo.transitDays,
    confidence: rates.confidence,
    ratesVerifiedAt: rates.verifiedAt,
    notes,
  };

  return [offer];
}
