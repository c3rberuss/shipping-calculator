/**
 * Motor de Buyex, modalidad Prealerta.
 *
 * Formula replicada de `realizarCalculosAduaneros` en su modulo de
 * estimaciones. Codigo original:
 *
 *   const pesoCobrado = esPrealerta ? Math.max(1, Math.round(pesoOriginal)) : pesoOriginal;
 *   const transporteResult = costoPorLibra * pesoCobrado;
 *   const seguro = precioOriginal * SEGURO_ADUANERO_TASA;      // 0.015
 *   const fleteAduanero = precioOriginal * FLETE_ADUANERO_TASA; // 0.10
 *   const cif = precioOriginal + seguro + fleteAduanero;
 *   const daiResult = cif * (categoriaDai / 100);
 *   const iva = (cif + daiResult) * IVA_TASA;                   // 0.13
 *   const impuesto = daiResult + iva;
 *   const total = (esPrealerta ? 0 : precioOriginal) + transporteResult + impuesto;
 *
 * Se usa Prealerta por decision de producto: el caso de uso es "ya compre,
 * quiero traerlo", donde el precio del articulo no forma parte del costo de
 * envio. Ver spec 3.6.
 *
 * Diferencias con Shop USA que hay que preservar, no normalizar:
 *
 * 1. El redondeo de peso es `Math.round` con minimo de 1 lb, no `Math.ceil`.
 *    Un paquete de 5.4 lb factura 5 lb aqui y 6 lb en Shop USA.
 * 2. La base gravable es el CIF (precio * 1.115), no el valor de factura, y el
 *    IVA se aplica sobre CIF + DAI.
 * 3. El "flete aduanero" del 10% es un valor teorico para construir el CIF. No
 *    es el transporte que Buyex cobra.
 */

import { round2 } from '../money.js';
import type {
  BuyexModeRates,
  BuyexRates,
  Offer,
  ProviderOffer,
  ProviderQuoteInput,
  ShippingMode,
} from '../types.js';

const MODES: ShippingMode[] = ['aereo', 'maritimo'];

const MODE_LABEL: Record<ShippingMode, string> = {
  aereo: 'aéreo',
  maritimo: 'marítimo',
};

function quoteMode(
  input: ProviderQuoteInput,
  rates: BuyexRates,
  mode: ShippingMode,
  modeRates: BuyexModeRates,
): ProviderOffer {
  const { weightLb, declaredValueUsd, category } = input;

  const base = {
    offerId: `buyex:${mode}`,
    providerId: rates.providerId,
    providerName: rates.providerName,
    mode,
    officialQuoterUrl: rates.officialQuoterUrl,
  };

  // Gate de disponibilidad, no minimo facturable: por debajo de este peso el
  // cotizador de Buyex deshabilita la opcion. No se fuerza el peso al minimo.
  if (modeRates.minWeightLb !== null && weightLb < modeRates.minWeightLb) {
    return {
      ...base,
      available: false,
      reason: 'below-minimum-weight',
      detail: `Buyex habilita el ${MODE_LABEL[mode]} desde ${modeRates.minWeightLb} lb.`,
    };
  }

  if (category.kind === 'not-mapped') {
    return {
      ...base,
      available: false,
      reason: 'category-not-mapped',
      detail: `Buyex no tiene una categoría equivalente a "${category.label}".`,
    };
  }

  const exempt = declaredValueUsd < rates.daiExemption.belowUsd;

  // Bajo el umbral de exencion el DAI es cero para cualquier categoria, asi
  // que no hace falta pedirla. Por encima si, porque el DAI se calcula sobre
  // el CIF y depende del arancel.
  if (category.kind === 'none' && !exempt) {
    return {
      ...base,
      available: false,
      reason: 'category-required',
      detail: 'Buyex necesita la categoría para calcular el DAI sobre el CIF.',
    };
  }

  const billableWeightLb = Math.max(
    rates.minBillableLb,
    Math.round(weightLb),
  );
  const freight = modeRates.ratePerLb * billableWeightLb;

  const insurance = declaredValueUsd * rates.insuranceRate;
  const customsFreight = declaredValueUsd * rates.customsFreightRate;
  const cif = declaredValueUsd + insurance + customsFreight;

  const daiRate = exempt || category.kind !== 'resolved' ? 0 : category.daiRate;
  const dai = cif * daiRate;
  const vat = (cif + dai) * rates.vatRate;
  const taxes = dai + vat;

  const notes = [
    `Las tarifas no incluyen ${rates.excludes.join(' ni ')}.`,
    'El peso se redondea al entero más cercano, con mínimo de 1 lb.',
  ];
  if (exempt) {
    notes.push(
      `El DAI no aplica: en el cotizador de Buyex esto corresponde a elegir "${rates.daiExemption.sourceName}".`,
    );
  } else if (category.kind === 'resolved' && category.match === 'approximate') {
    notes.push(
      `Buyex no tiene una categoría exacta para "${category.label}"; se usa la más cercana de su catálogo, así que el arancel puede diferir.`,
    );
  }

  const offer: Offer = {
    ...base,
    available: true,
    totalUsd: round2(freight + taxes),
    breakdown: {
      billableWeightLb,
      ratePerLbUsd: modeRates.ratePerLb,
      freightUsd: round2(freight),
      extraCharges: [],
      taxableBaseKind: rates.taxableBaseKind,
      taxableBaseUsd: round2(cif),
      taxableBaseDisclosed: true,
      insuranceUsd: round2(insurance),
      customsFreightUsd: round2(customsFreight),
      daiRate,
      daiUsd: round2(dai),
      vatRate: rates.vatRate,
      vatUsd: round2(vat),
      taxesTotalUsd: round2(taxes),
    },
    transitDays: modeRates.transitDays,
    confidence: rates.confidence,
    ratesVerifiedAt: rates.verifiedAt,
    notes,
  };

  return offer;
}

export function quoteBuyex(
  input: ProviderQuoteInput,
  rates: BuyexRates,
): ProviderOffer[] {
  return MODES.map((mode) => quoteMode(input, rates, mode, rates.modes[mode]));
}
