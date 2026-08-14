/**
 * Orquestacion del motor.
 *
 * `quoteAll` es el punto de entrada de la UI: recibe lo que el usuario escribio
 * y devuelve las ofertas listas para renderizar. `quoteProviders` queda
 * expuesto para pruebas y para casos donde las categorias ya vienen resueltas.
 */

import { findCategory, resolveCategory } from './catalog.js';
import { quoteBuyex } from './providers/buyex.js';
import { quoteQuickbox, type QuoteQuickboxDeps } from './providers/quickbox.js';
import { quoteShopUsa } from './providers/shopusa.js';
import type {
  BuyexRates,
  Catalog,
  CategoryResolution,
  Offer,
  ProviderId,
  ProviderOffer,
  ProviderQuoteInput,
  QuoteInput,
  QuoteResult,
  ShopUsaRates,
  UnavailableOffer,
} from './types.js';

export type InputValidation =
  | { valid: true }
  | { valid: false; reason: 'weight-required' | 'value-required' };

/**
 * Sin peso o sin valor no hay nada que calcular en ningun proveedor: el valor
 * es la base gravable de los tres. Ver spec 4.1 y 4.2.
 */
export function validateInput(input: {
  weightLb: number;
  declaredValueUsd: number;
}): InputValidation {
  if (!Number.isFinite(input.weightLb) || input.weightLb <= 0) {
    return { valid: false, reason: 'weight-required' };
  }
  if (!Number.isFinite(input.declaredValueUsd) || input.declaredValueUsd < 0) {
    return { valid: false, reason: 'value-required' };
  }
  return { valid: true };
}

/**
 * Orden de presentacion: mas barato primero.
 *
 * Desempate estable (spec 4.10): menor tiempo de entrega si ambos lo tienen,
 * y si persiste, alfabetico por proveedor. El orden no debe variar entre
 * renders con los mismos inputs.
 */
export function sortOffers(offers: Offer[]): Offer[] {
  return [...offers].sort((a, b) => {
    if (a.totalUsd !== b.totalUsd) return a.totalUsd - b.totalUsd;

    if (a.transitDays && b.transitDays && a.transitDays.max !== b.transitDays.max) {
      return a.transitDays.max - b.transitDays.max;
    }

    return a.providerName.localeCompare(b.providerName, 'es');
  });
}

export interface ProviderCategories {
  shopusa: CategoryResolution;
  buyex: CategoryResolution;
}

export interface ProviderRatesBundle {
  shopusa: ShopUsaRates;
  buyex: BuyexRates;
}

export interface ProvidersQuoteResult {
  offers: Offer[];
  unavailable: UnavailableOffer[];
}

export function quoteProviders(
  input: { weightLb: number; declaredValueUsd: number },
  categories: ProviderCategories,
  rates: ProviderRatesBundle,
): ProvidersQuoteResult {
  const results: ProviderOffer[] = [];

  const shopUsaInput: ProviderQuoteInput = {
    ...input,
    category: categories.shopusa,
  };
  const buyexInput: ProviderQuoteInput = {
    ...input,
    category: categories.buyex,
  };

  results.push(...quoteShopUsa(shopUsaInput, rates.shopusa));
  results.push(...quoteBuyex(buyexInput, rates.buyex));

  return {
    offers: sortOffers(results.filter((r): r is Offer => r.available)),
    unavailable: results.filter((r): r is UnavailableOffer => !r.available),
  };
}

/**
 * Punto de entrada de la UI.
 *
 * Resuelve la categoria elegida contra el catalogo de cada proveedor y cotiza.
 * Si la entrada es invalida (sin peso o sin valor) devuelve un resultado vacio
 * en vez de lanzar: la UI muestra su estado inicial, no un error. Ver spec 4.1.
 */
export function quoteAll(
  input: QuoteInput,
  catalog: Catalog,
  rates: ProviderRatesBundle,
): QuoteResult {
  if (!validateInput(input).valid) {
    return { offers: [], unavailable: [], input };
  }

  const result = quoteProviders(
    { weightLb: input.weightLb, declaredValueUsd: input.declaredValueUsd },
    {
      shopusa: resolveCategory(catalog, input.categoryId, 'shopusa'),
      buyex: resolveCategory(catalog, input.categoryId, 'buyex'),
    },
    rates,
  );

  return { ...result, input };
}

export type { ProviderId };
export * from './types.js';
export { quoteBuyex, quoteShopUsa };
export { resolveCategory, searchCategories } from './catalog.js';
export { findCategory };

// ---------------------------------------------------------------------------
// Quickbox: cotizacion en vivo, resuelta aparte
// ---------------------------------------------------------------------------

/**
 * Quickbox no entra en `quoteAll` a proposito.
 *
 * `quoteAll` es sincrono y no toca la red, asi que los dos proveedores locales
 * se muestran de inmediato. Esperar a una API de un tercero para pintar la
 * comparacion entera haria que una consulta lenta retrase resultados que ya
 * estaban listos. La UI resuelve esto en dos fases: pinta lo local y luego
 * inserta la tarjeta de Quickbox cuando llega.
 */
export async function quoteQuickboxFor(
  input: QuoteInput,
  catalog: Catalog,
  deps: QuoteQuickboxDeps,
): Promise<ProviderOffer[]> {
  if (!validateInput(input).valid) return [];

  const category = input.categoryId
    ? findCategory(catalog, input.categoryId)
    : undefined;
  const mapping = category?.mappings.quickbox ?? null;

  return quoteQuickbox(
    {
      weightLb: input.weightLb,
      declaredValueUsd: input.declaredValueUsd,
      arancelId: mapping?.arancelId ?? null,
      categoryLabel: category?.label ?? null,
      approximate: mapping?.match === 'approximate',
    },
    deps,
  );
}

export { quoteQuickbox };
export type { QuickboxQuote, QuoteQuickboxDeps } from './providers/quickbox.js';
export { QuoteCache } from './quote-cache.js';
