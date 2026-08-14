import { describe, expect, it } from 'vitest';

import { shopUsaRates } from '../../data/index.js';
import type { CategoryResolution } from '../types.js';
import { quoteShopUsa } from './shopusa.js';

/**
 * `official-ui`       verificado contra la calculadora publicada de Shop USA.
 * `replicated-source` derivado de la formula extraida de su bundle de
 *                     produccion. Pendiente de contrastar manualmente contra
 *                     la calculadora oficial (ver criterio de aceptacion del
 *                     spec 5).
 */
type FixtureSource = 'official-ui' | 'replicated-source';

interface Fixture {
  name: string;
  source: FixtureSource;
  weightLb: number;
  declaredValueUsd: number;
  category: CategoryResolution;
  expected: {
    billableWeightLb: number;
    ratePerLbUsd: number;
    freightUsd: number;
    daiUsd: number;
    vatUsd: number;
    totalUsd: number;
  };
}

const cat = (label: string, daiRate: number): CategoryResolution => ({
  kind: 'resolved',
  id: label,
  label,
  daiRate,
  match: 'direct',
});

const SIN_CATEGORIA: CategoryResolution = { kind: 'none' };

const FIXTURES: Fixture[] = [
  {
    name: 'caso conocido de la calculadora oficial: 1 lb, $100, categoria al 15%',
    source: 'official-ui',
    weightLb: 1,
    declaredValueUsd: 100,
    category: cat('Fundas para telefonos y mochilas para laptops', 0.15),
    expected: {
      billableWeightLb: 1,
      ratePerLbUsd: 4.99,
      freightUsd: 4.99,
      daiUsd: 0,
      vatUsd: 13,
      totalUsd: 17.99,
    },
  },
  {
    name: 'peso fraccionario sube a 1 lb completa',
    source: 'replicated-source',
    weightLb: 0.4,
    declaredValueUsd: 50,
    category: SIN_CATEGORIA,
    expected: {
      billableWeightLb: 1,
      ratePerLbUsd: 4.99,
      freightUsd: 4.99,
      daiUsd: 0,
      vatUsd: 6.5,
      totalUsd: 11.49,
    },
  },
  {
    name: 'limite del escalon: 5 lb exactas mantienen la tarifa alta',
    source: 'replicated-source',
    weightLb: 5,
    declaredValueUsd: 200,
    category: SIN_CATEGORIA,
    expected: {
      billableWeightLb: 5,
      ratePerLbUsd: 4.99,
      freightUsd: 24.95,
      daiUsd: 0,
      vatUsd: 26,
      totalUsd: 50.95,
    },
  },
  {
    name: 'cruce de escalon: 5.1 lb factura 6 lb a la tarifa baja, sin acumular',
    source: 'replicated-source',
    weightLb: 5.1,
    declaredValueUsd: 200,
    category: SIN_CATEGORIA,
    expected: {
      billableWeightLb: 6,
      ratePerLbUsd: 4.4,
      freightUsd: 26.4,
      daiUsd: 0,
      vatUsd: 26,
      totalUsd: 52.4,
    },
  },
  {
    name: 'umbral del DAI: $300 exactos no lo activan',
    source: 'replicated-source',
    weightLb: 6,
    declaredValueUsd: 300,
    category: cat('Consolas de videojuegos', 0.15),
    expected: {
      billableWeightLb: 6,
      ratePerLbUsd: 4.4,
      freightUsd: 26.4,
      daiUsd: 0,
      vatUsd: 39,
      totalUsd: 65.4,
    },
  },
  {
    name: 'umbral del DAI: $301 si lo activa',
    source: 'replicated-source',
    weightLb: 6,
    declaredValueUsd: 301,
    category: cat('Consolas de videojuegos', 0.15),
    expected: {
      billableWeightLb: 6,
      ratePerLbUsd: 4.4,
      freightUsd: 26.4,
      daiUsd: 45.15,
      vatUsd: 39.13,
      totalUsd: 110.68,
    },
  },
  {
    name: 'categoria exenta sobre el umbral: DAI cero pero IVA completo',
    source: 'replicated-source',
    weightLb: 10,
    declaredValueUsd: 500,
    category: cat('Laptops, notebooks, servidores y computadoras', 0),
    expected: {
      billableWeightLb: 10,
      ratePerLbUsd: 4.4,
      freightUsd: 44,
      daiUsd: 0,
      vatUsd: 65,
      totalUsd: 109,
    },
  },
  {
    name: 'arancel maximo del catalogo (40%)',
    source: 'replicated-source',
    weightLb: 20,
    declaredValueUsd: 1000,
    category: cat('Categoria al 40%', 0.4),
    expected: {
      billableWeightLb: 20,
      ratePerLbUsd: 4.4,
      freightUsd: 88,
      daiUsd: 400,
      vatUsd: 130,
      totalUsd: 618,
    },
  },
  {
    name: 'peso fraccionario bajo el escalon con DAI activo',
    source: 'replicated-source',
    weightLb: 2.5,
    declaredValueUsd: 350,
    category: cat('Categoria al 5%', 0.05),
    expected: {
      billableWeightLb: 3,
      ratePerLbUsd: 4.99,
      freightUsd: 14.97,
      daiUsd: 17.5,
      vatUsd: 45.5,
      totalUsd: 77.97,
    },
  },
  {
    name: 'valor declarado cero: solo flete',
    source: 'replicated-source',
    weightLb: 0.1,
    declaredValueUsd: 0,
    category: SIN_CATEGORIA,
    expected: {
      billableWeightLb: 1,
      ratePerLbUsd: 4.99,
      freightUsd: 4.99,
      daiUsd: 0,
      vatUsd: 0,
      totalUsd: 4.99,
    },
  },
];

describe('quoteShopUsa', () => {
  for (const f of FIXTURES) {
    it(`[${f.source}] ${f.name}`, () => {
      const [offer] = quoteShopUsa(
        {
          weightLb: f.weightLb,
          declaredValueUsd: f.declaredValueUsd,
          category: f.category,
        },
        shopUsaRates,
      );

      expect(offer).toBeDefined();
      if (!offer || !offer.available) {
        throw new Error('se esperaba una oferta disponible');
      }

      expect(offer.breakdown.billableWeightLb).toBe(f.expected.billableWeightLb);
      expect(offer.breakdown.ratePerLbUsd).toBe(f.expected.ratePerLbUsd);
      expect(offer.breakdown.freightUsd).toBe(f.expected.freightUsd);
      expect(offer.breakdown.daiUsd).toBe(f.expected.daiUsd);
      expect(offer.breakdown.vatUsd).toBe(f.expected.vatUsd);
      expect(offer.totalUsd).toBe(f.expected.totalUsd);
    });
  }

  it('grava sobre el valor de factura, no sobre el CIF', () => {
    const [offer] = quoteShopUsa(
      { weightLb: 1, declaredValueUsd: 250, category: SIN_CATEGORIA },
      shopUsaRates,
    );
    if (!offer || !offer.available) throw new Error('oferta no disponible');

    expect(offer.breakdown.taxableBaseKind).toBe('invoice');
    expect(offer.breakdown.taxableBaseUsd).toBe(250);
    expect(offer.breakdown.insuranceUsd).toBe(0);
    expect(offer.breakdown.customsFreightUsd).toBe(0);
  });

  it('exige categoria solo cuando el valor supera el umbral del DAI', () => {
    const [sinCategoriaBajoUmbral] = quoteShopUsa(
      { weightLb: 1, declaredValueUsd: 300, category: SIN_CATEGORIA },
      shopUsaRates,
    );
    expect(sinCategoriaBajoUmbral?.available).toBe(true);

    const [sinCategoriaSobreUmbral] = quoteShopUsa(
      { weightLb: 1, declaredValueUsd: 301, category: SIN_CATEGORIA },
      shopUsaRates,
    );
    expect(sinCategoriaSobreUmbral?.available).toBe(false);
    if (sinCategoriaSobreUmbral?.available === false) {
      expect(sinCategoriaSobreUmbral.reason).toBe('category-required');
    }
  });

  it('advierte siempre sobre la regla de peso volumetrico no implementada', () => {
    const [offer] = quoteShopUsa(
      { weightLb: 3, declaredValueUsd: 100, category: SIN_CATEGORIA },
      shopUsaRates,
    );
    if (!offer || !offer.available) throw new Error('oferta no disponible');

    expect(offer.notes.some((n) => n.includes('volumétrico'))).toBe(true);
  });
});
