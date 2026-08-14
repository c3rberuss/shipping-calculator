import { describe, expect, it } from 'vitest';

import { buyexRates, catalog, rates, shopUsaRates } from '../data/index.js';
import { quoteAll, quoteProviders, sortOffers, validateInput } from './index.js';
import type { CategoryResolution, Offer } from './types.js';

const cat = (daiRate: number): CategoryResolution => ({
  kind: 'resolved',
  id: 'test',
  label: 'Categoria de prueba',
  daiRate,
  match: 'direct',
});

const SIN_CATEGORIA: CategoryResolution = { kind: 'none' };

const RATES = { shopusa: shopUsaRates, buyex: buyexRates };

function offerStub(overrides: Partial<Offer>): Offer {
  return {
    available: true,
    offerId: 'stub',
    providerId: 'shopusa',
    providerName: 'Stub',
    mode: 'aereo',
    totalUsd: 0,
    breakdown: {
      billableWeightLb: 1,
      ratePerLbUsd: 0,
      freightUsd: 0,
      extraCharges: [],
      taxableBaseKind: 'invoice',
      taxableBaseUsd: 0,
      taxableBaseDisclosed: true,
      insuranceUsd: 0,
      customsFreightUsd: 0,
      daiRate: 0,
      daiUsd: 0,
      vatRate: 0.13,
      vatUsd: 0,
      taxesTotalUsd: 0,
    },
    transitDays: null,
    confidence: 'exact',
    ratesVerifiedAt: '2026-08-13',
    officialQuoterUrl: 'https://example.com',
    notes: [],
    ...overrides,
  };
}

describe('validateInput', () => {
  it('rechaza peso ausente, cero o negativo', () => {
    expect(validateInput({ weightLb: 0, declaredValueUsd: 100 }).valid).toBe(false);
    expect(validateInput({ weightLb: -1, declaredValueUsd: 100 }).valid).toBe(false);
    expect(validateInput({ weightLb: NaN, declaredValueUsd: 100 }).valid).toBe(false);
  });

  it('rechaza valor declarado negativo pero acepta cero', () => {
    expect(validateInput({ weightLb: 1, declaredValueUsd: -1 }).valid).toBe(false);
    expect(validateInput({ weightLb: 1, declaredValueUsd: 0 }).valid).toBe(true);
  });

  it('acepta una entrada completa', () => {
    expect(validateInput({ weightLb: 5.5, declaredValueUsd: 250 })).toEqual({
      valid: true,
    });
  });
});

describe('sortOffers', () => {
  it('ordena por costo total ascendente', () => {
    const sorted = sortOffers([
      offerStub({ offerId: 'c', totalUsd: 30 }),
      offerStub({ offerId: 'a', totalUsd: 10 }),
      offerStub({ offerId: 'b', totalUsd: 20 }),
    ]);

    expect(sorted.map((o) => o.offerId)).toEqual(['a', 'b', 'c']);
  });

  it('desempata por menor tiempo de entrega cuando ambos lo tienen', () => {
    const sorted = sortOffers([
      offerStub({
        offerId: 'lento',
        totalUsd: 50,
        transitDays: { min: 10, max: 20 },
      }),
      offerStub({
        offerId: 'rapido',
        totalUsd: 50,
        transitDays: { min: 2, max: 5 },
      }),
    ]);

    expect(sorted.map((o) => o.offerId)).toEqual(['rapido', 'lento']);
  });

  it('desempata alfabeticamente cuando no hay tiempos de entrega', () => {
    const sorted = sortOffers([
      offerStub({ offerId: 'z', totalUsd: 50, providerName: 'Zeta' }),
      offerStub({ offerId: 'a', totalUsd: 50, providerName: 'Alfa' }),
    ]);

    expect(sorted.map((o) => o.offerId)).toEqual(['a', 'z']);
  });

  it('produce el mismo orden en llamadas repetidas', () => {
    const input = [
      offerStub({ offerId: 'a', totalUsd: 50, providerName: 'Alfa' }),
      offerStub({ offerId: 'b', totalUsd: 50, providerName: 'Beta' }),
      offerStub({ offerId: 'c', totalUsd: 50, providerName: 'Gama' }),
    ];

    expect(sortOffers(input).map((o) => o.offerId)).toEqual(
      sortOffers([...input].reverse()).map((o) => o.offerId),
    );
  });

  it('no muta el arreglo original', () => {
    const input = [
      offerStub({ offerId: 'b', totalUsd: 20 }),
      offerStub({ offerId: 'a', totalUsd: 10 }),
    ];
    sortOffers(input);

    expect(input.map((o) => o.offerId)).toEqual(['b', 'a']);
  });
});

describe('quoteProviders', () => {
  it('devuelve tres ofertas cuando el peso habilita el maritimo', () => {
    const result = quoteProviders(
      { weightLb: 10, declaredValueUsd: 200 },
      { shopusa: cat(0.15), buyex: cat(0.15) },
      RATES,
    );

    expect(result.offers.map((o) => o.offerId).sort()).toEqual([
      'buyex:aereo',
      'buyex:maritimo',
      'shopusa:aereo',
    ]);
    expect(result.unavailable).toHaveLength(0);
  });

  it('separa las ofertas no disponibles sin ocultarlas', () => {
    const result = quoteProviders(
      { weightLb: 2, declaredValueUsd: 200 },
      { shopusa: cat(0.15), buyex: cat(0.15) },
      RATES,
    );

    expect(result.offers.map((o) => o.offerId).sort()).toEqual([
      'buyex:aereo',
      'shopusa:aereo',
    ]);
    expect(result.unavailable).toHaveLength(1);
    expect(result.unavailable[0]?.offerId).toBe('buyex:maritimo');
    expect(result.unavailable[0]?.reason).toBe('below-minimum-weight');
  });

  it('entrega las ofertas ya ordenadas por costo', () => {
    const result = quoteProviders(
      { weightLb: 20, declaredValueUsd: 500 },
      { shopusa: cat(0.15), buyex: cat(0.15) },
      RATES,
    );

    const totals = result.offers.map((o) => o.totalUsd);
    expect(totals).toEqual([...totals].sort((a, b) => a - b));
  });

  it('sin categoria y bajo el umbral, los tres cotizan igual', () => {
    // Bajo $300 ninguno cobra DAI, asi que la categoria no cambia el resultado
    // y no tiene sentido exigirla.
    const result = quoteProviders(
      { weightLb: 10, declaredValueUsd: 100 },
      { shopusa: SIN_CATEGORIA, buyex: SIN_CATEGORIA },
      RATES,
    );

    expect(result.offers.map((o) => o.offerId).sort()).toEqual([
      'buyex:aereo',
      'buyex:maritimo',
      'shopusa:aereo',
    ]);
    expect(result.unavailable).toHaveLength(0);
  });

  it('sin categoria y sobre el umbral, ningun proveedor cotiza', () => {
    const result = quoteProviders(
      { weightLb: 10, declaredValueUsd: 500 },
      { shopusa: SIN_CATEGORIA, buyex: SIN_CATEGORIA },
      RATES,
    );

    expect(result.offers).toHaveLength(0);
    expect(result.unavailable).toHaveLength(3);
    expect(
      result.unavailable.every((o) => o.reason === 'category-required'),
    ).toBe(true);
  });

  it('refleja que las bases gravables difieren entre proveedores', () => {
    const result = quoteProviders(
      { weightLb: 1, declaredValueUsd: 1000 },
      { shopusa: cat(0), buyex: cat(0) },
      RATES,
    );

    const shopusa = result.offers.find((o) => o.providerId === 'shopusa');
    const buyex = result.offers.find((o) => o.offerId === 'buyex:aereo');

    expect(shopusa?.breakdown.taxableBaseUsd).toBe(1000);
    expect(buyex?.breakdown.taxableBaseUsd).toBe(1115);
  });
});

describe('quoteAll', () => {
  it('resuelve la categoria del catalogo a la tasa nativa de cada proveedor', () => {
    // "audifonos" es 15% en Shop USA y 0% en Buyex.
    const result = quoteAll(
      { weightLb: 2, declaredValueUsd: 800, categoryId: 'audifonos' },
      catalog,
      rates,
    );

    const shopusa = result.offers.find((o) => o.providerId === 'shopusa');
    const buyex = result.offers.find((o) => o.offerId === 'buyex:aereo');

    expect(shopusa?.breakdown.daiRate).toBe(0.15);
    expect(buyex?.breakdown.daiRate).toBe(0);
  });

  it('marca no disponible el proveedor sin mapeo para la categoria', () => {
    const result = quoteAll(
      { weightLb: 10, declaredValueUsd: 500, categoryId: 'otros' },
      catalog,
      rates,
    );

    expect(result.offers.map((o) => o.providerId)).toEqual(['shopusa']);
    expect(
      result.unavailable.every((o) => o.reason === 'category-not-mapped'),
    ).toBe(true);
  });

  it('devuelve resultado vacio con entrada invalida, sin lanzar', () => {
    const result = quoteAll(
      { weightLb: 0, declaredValueUsd: 100, categoryId: 'ropa' },
      catalog,
      rates,
    );

    expect(result.offers).toHaveLength(0);
    expect(result.unavailable).toHaveLength(0);
  });

  it('ignora un id de categoria desconocido en vez de fallar', () => {
    const result = quoteAll(
      { weightLb: 2, declaredValueUsd: 100, categoryId: 'categoria-inventada' },
      catalog,
      rates,
    );

    expect(result.offers.length).toBeGreaterThan(0);
  });

  it('conserva el input en el resultado', () => {
    const input = { weightLb: 3, declaredValueUsd: 120, categoryId: 'libros' };
    expect(quoteAll(input, catalog, rates).input).toEqual(input);
  });
});
