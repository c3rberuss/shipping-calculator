import { describe, expect, it } from 'vitest';

import { buyexRates } from '../../data/index.js';
import { round2 } from '../money.js';
import type { CategoryResolution, ShippingMode } from '../types.js';
import { quoteBuyex } from './buyex.js';

/**
 * Todos los casos derivan de `realizarCalculosAduaneros`, extraida del modulo
 * de estimaciones de Buyex. Ninguno esta aun contrastado manualmente contra su
 * cotizador publicado (ver criterio de aceptacion del spec 5).
 */
interface Fixture {
  name: string;
  mode: ShippingMode;
  weightLb: number;
  declaredValueUsd: number;
  category: CategoryResolution;
  expected: {
    billableWeightLb: number;
    freightUsd: number;
    cifUsd: number;
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
    name: 'aereo, 1 lb, $100, categoria exenta',
    mode: 'aereo',
    weightLb: 1,
    declaredValueUsd: 100,
    category: cat('Laptops', 0),
    expected: {
      billableWeightLb: 1,
      freightUsd: 4.99,
      cifUsd: 111.5,
      daiUsd: 0,
      vatUsd: 14.5,
      // El total sale de los valores crudos, no de los ya redondeados:
      // 4.99 + 14.50 sugiere 19.49, pero el flotante real redondea a 19.48.
      // Es el comportamiento del propio cotizador de Buyex.
      totalUsd: 19.48,
    },
  },
  {
    name: 'aereo, el peso redondea hacia abajo (5.4 -> 5)',
    mode: 'aereo',
    weightLb: 5.4,
    declaredValueUsd: 500,
    category: cat('Accesorios de vestir', 0.15),
    expected: {
      billableWeightLb: 5,
      freightUsd: 24.95,
      cifUsd: 557.5,
      daiUsd: 83.63,
      vatUsd: 83.35,
      totalUsd: 191.92,
    },
  },
  {
    name: 'aereo, el peso redondea hacia arriba (5.5 -> 6)',
    mode: 'aereo',
    weightLb: 5.5,
    declaredValueUsd: 500,
    category: cat('Accesorios de vestir', 0.15),
    expected: {
      billableWeightLb: 6,
      freightUsd: 29.94,
      cifUsd: 557.5,
      daiUsd: 83.63,
      vatUsd: 83.35,
      totalUsd: 196.91,
    },
  },
  {
    name: 'aereo, peso menor a 1 lb se factura como 1 lb',
    mode: 'aereo',
    weightLb: 0.3,
    declaredValueUsd: 50,
    category: cat('Laptops', 0),
    expected: {
      billableWeightLb: 1,
      freightUsd: 4.99,
      cifUsd: 55.75,
      daiUsd: 0,
      vatUsd: 7.25,
      totalUsd: 12.24,
    },
  },
  {
    name: 'aereo, 2.5 lb redondea a 3 lb',
    mode: 'aereo',
    weightLb: 2.5,
    declaredValueUsd: 500,
    category: cat('Categoria al 13%', 0.13),
    expected: {
      billableWeightLb: 3,
      freightUsd: 14.97,
      cifUsd: 557.5,
      daiUsd: 72.48,
      vatUsd: 81.9,
      totalUsd: 169.34,
    },
  },
  {
    name: 'aereo, arancel maximo del catalogo (30%)',
    mode: 'aereo',
    weightLb: 50,
    declaredValueUsd: 2000,
    category: cat('Categoria al 5%', 0.05),
    expected: {
      billableWeightLb: 50,
      freightUsd: 249.5,
      cifUsd: 2230,
      daiUsd: 111.5,
      vatUsd: 304.4,
      // Mismo efecto: 249.50 + 111.50 + 304.40 sugiere 665.40, el crudo da 665.39.
      totalUsd: 665.39,
    },
  },
  {
    name: 'maritimo, peso exacto en el limite de habilitacion (8 lb)',
    mode: 'maritimo',
    weightLb: 8,
    declaredValueUsd: 300,
    category: cat('Accesorios para camara', 0.1),
    expected: {
      billableWeightLb: 8,
      freightUsd: 23.92,
      cifUsd: 334.5,
      daiUsd: 33.45,
      vatUsd: 47.83,
      totalUsd: 105.2,
    },
  },
  {
    name: 'maritimo, 8.4 lb redondea a 8 lb',
    mode: 'maritimo',
    weightLb: 8.4,
    declaredValueUsd: 500,
    category: cat('Categoria al 20%', 0.2),
    expected: {
      billableWeightLb: 8,
      freightUsd: 23.92,
      cifUsd: 557.5,
      daiUsd: 111.5,
      vatUsd: 86.97,
      totalUsd: 222.39,
    },
  },
  {
    name: 'maritimo, carga pesada con arancel del 30%',
    mode: 'maritimo',
    weightLb: 20,
    declaredValueUsd: 1000,
    category: cat('Categoria al 30%', 0.3),
    expected: {
      billableWeightLb: 20,
      freightUsd: 59.8,
      cifUsd: 1115,
      daiUsd: 334.5,
      vatUsd: 188.44,
      // 582.7349999999999 en flotante: Buyex muestra 582.73, no 582.74.
      totalUsd: 582.73,
    },
  },
  {
    name: 'aereo, valor declarado cero: solo flete',
    mode: 'aereo',
    weightLb: 3,
    declaredValueUsd: 0,
    category: cat('Laptops', 0),
    expected: {
      billableWeightLb: 3,
      freightUsd: 14.97,
      cifUsd: 0,
      daiUsd: 0,
      vatUsd: 0,
      totalUsd: 14.97,
    },
  },
];

function offerFor(
  mode: ShippingMode,
  input: { weightLb: number; declaredValueUsd: number; category: CategoryResolution },
) {
  const offers = quoteBuyex(input, buyexRates);
  const offer = offers.find((o) => o.mode === mode);
  if (!offer) throw new Error(`no se genero oferta para ${mode}`);
  return offer;
}

describe('quoteBuyex (Prealerta)', () => {
  for (const f of FIXTURES) {
    it(`[replicated-source] ${f.name}`, () => {
      const offer = offerFor(f.mode, {
        weightLb: f.weightLb,
        declaredValueUsd: f.declaredValueUsd,
        category: f.category,
      });

      if (!offer.available) throw new Error('se esperaba una oferta disponible');

      expect(offer.breakdown.billableWeightLb).toBe(f.expected.billableWeightLb);
      expect(offer.breakdown.freightUsd).toBe(f.expected.freightUsd);
      expect(offer.breakdown.taxableBaseUsd).toBe(f.expected.cifUsd);
      expect(offer.breakdown.daiUsd).toBe(f.expected.daiUsd);
      expect(offer.breakdown.vatUsd).toBe(f.expected.vatUsd);
      expect(offer.totalUsd).toBe(f.expected.totalUsd);
    });
  }

  it('devuelve siempre las dos modalidades como ofertas independientes', () => {
    const offers = quoteBuyex(
      { weightLb: 10, declaredValueUsd: 200, category: cat('Laptops', 0) },
      buyexRates,
    );

    expect(offers).toHaveLength(2);
    expect(offers.map((o) => o.offerId)).toEqual(['buyex:aereo', 'buyex:maritimo']);
    expect(offers.every((o) => o.available)).toBe(true);
  });

  it('deshabilita el maritimo bajo 8 lb sin forzar el peso al minimo', () => {
    const offer = offerFor('maritimo', {
      weightLb: 7.9,
      declaredValueUsd: 300,
      category: cat('Laptops', 0),
    });

    expect(offer.available).toBe(false);
    if (!offer.available) {
      expect(offer.reason).toBe('below-minimum-weight');
      expect(offer.detail).toContain('8 lb');
    }
  });

  it('mantiene el aereo disponible cuando el maritimo no lo esta', () => {
    const offers = quoteBuyex(
      { weightLb: 2, declaredValueUsd: 100, category: cat('Laptops', 0) },
      buyexRates,
    );

    expect(offers.find((o) => o.mode === 'aereo')?.available).toBe(true);
    expect(offers.find((o) => o.mode === 'maritimo')?.available).toBe(false);
  });

  it('exige categoria en ambas modalidades sobre el umbral de exencion', () => {
    const offers = quoteBuyex(
      { weightLb: 10, declaredValueUsd: 500, category: SIN_CATEGORIA },
      buyexRates,
    );

    expect(offers.every((o) => !o.available)).toBe(true);
    for (const offer of offers) {
      if (!offer.available) expect(offer.reason).toBe('category-required');
    }
  });

  /**
   * Buyex no lleva umbral de exencion en su formula: lo implementa como una
   * categoria al 0% que el usuario elige a mano. Lo replicamos automaticamente
   * porque, de lo contrario, Buyex saldria artificialmente caro en toda compra
   * bajo $300, que es la mayoria, y la comparacion dejaria de ser honesta.
   */
  describe('exencion de DAI bajo $300', () => {
    it('anula el DAI bajo el umbral aunque la categoria tenga arancel', () => {
      const offer = offerFor('aereo', {
        weightLb: 1,
        declaredValueUsd: 299.99,
        category: cat('Ropa', 0.15),
      });
      if (!offer.available) throw new Error('oferta no disponible');

      expect(offer.breakdown.daiRate).toBe(0);
      expect(offer.breakdown.daiUsd).toBe(0);
      expect(offer.notes.some((n) => n.includes('EXENTA DE DAI'))).toBe(true);
    });

    it('aplica el DAI desde $300 exactos, porque la exencion es "menores a"', () => {
      const offer = offerFor('aereo', {
        weightLb: 1,
        declaredValueUsd: 300,
        category: cat('Ropa', 0.15),
      });
      if (!offer.available) throw new Error('oferta no disponible');

      expect(offer.breakdown.daiRate).toBe(0.15);
      expect(offer.breakdown.daiUsd).toBeGreaterThan(0);
    });

    it('cotiza sin categoria bajo el umbral, porque el DAI seria cero igual', () => {
      const offers = quoteBuyex(
        { weightLb: 10, declaredValueUsd: 150, category: SIN_CATEGORIA },
        buyexRates,
      );

      expect(offers.every((o) => o.available)).toBe(true);
    });

    it('cobra IVA aunque el DAI este exento', () => {
      const offer = offerFor('aereo', {
        weightLb: 1,
        declaredValueUsd: 100,
        category: cat('Ropa', 0.15),
      });
      if (!offer.available) throw new Error('oferta no disponible');

      expect(offer.breakdown.vatUsd).toBe(14.5);
    });
  });

  it('marca como no disponible una categoria sin equivalente en Buyex', () => {
    const offers = quoteBuyex(
      {
        weightLb: 10,
        declaredValueUsd: 500,
        category: { kind: 'not-mapped', label: 'Otros bienes' },
      },
      buyexRates,
    );

    expect(offers.every((o) => !o.available)).toBe(true);
    for (const offer of offers) {
      if (!offer.available) {
        expect(offer.reason).toBe('category-not-mapped');
        expect(offer.detail).toContain('Otros bienes');
      }
    }
  });

  it('advierte cuando el mapeo de categoria es aproximado', () => {
    const offer = offerFor('aereo', {
      weightLb: 1,
      declaredValueUsd: 500,
      category: {
        kind: 'resolved',
        id: 'drones',
        label: 'Drones',
        daiRate: 0,
        match: 'approximate',
      },
    });
    if (!offer.available) throw new Error('oferta no disponible');

    expect(offer.notes.some((n) => n.includes('categoría exacta'))).toBe(true);
  });

  it('construye el CIF con seguro del 1.5% y flete aduanero del 10%', () => {
    const offer = offerFor('aereo', {
      weightLb: 1,
      declaredValueUsd: 1000,
      category: cat('Laptops', 0),
    });
    if (!offer.available) throw new Error('oferta no disponible');

    expect(offer.breakdown.taxableBaseKind).toBe('cif');
    expect(offer.breakdown.insuranceUsd).toBe(15);
    expect(offer.breakdown.customsFreightUsd).toBe(100);
    expect(offer.breakdown.taxableBaseUsd).toBe(1115);
  });

  it('no suma el precio del articulo al total (modalidad Prealerta)', () => {
    const offer = offerFor('aereo', {
      weightLb: 1,
      declaredValueUsd: 1000,
      category: cat('Laptops', 0),
    });
    if (!offer.available) throw new Error('oferta no disponible');

    expect(offer.totalUsd).toBeLessThan(1000);
    // Tolerancia de un centavo a proposito: ver el test siguiente.
    expect(offer.totalUsd).toBeCloseTo(
      offer.breakdown.freightUsd + offer.breakdown.taxesTotalUsd,
      2,
    );
  });

  /**
   * Comportamiento heredado del propio cotizador de Buyex, no un defecto
   * nuestro: el total se calcula sobre los valores crudos y se redondea al
   * final, mientras que cada linea del desglose se redondea por separado. Con
   * ciertos montos las lineas no suman exactamente el total.
   *
   * La UI debe mostrar el total tal cual, sin recalcularlo desde el desglose,
   * porque es el numero que el proveedor cobra.
   */
  it('el total puede diferir un centavo de la suma de las lineas redondeadas', () => {
    const offer = offerFor('aereo', {
      weightLb: 1,
      declaredValueUsd: 100,
      category: cat('Laptops', 0),
    });
    if (!offer.available) throw new Error('oferta no disponible');

    const sumaDeLineas = round2(
      offer.breakdown.freightUsd + offer.breakdown.taxesTotalUsd,
    );

    expect(sumaDeLineas).toBe(19.49);
    expect(offer.totalUsd).toBe(19.48);
  });
});
