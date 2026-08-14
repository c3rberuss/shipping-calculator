import { describe, expect, it } from 'vitest';

import { buyexRates, quickboxRates, shopUsaRates } from './index.js';

/**
 * Las tarifas son datos versionados que se editan a mano cuando un proveedor
 * cambia sus precios. Estas pruebas protegen la forma del archivo y las
 * constantes extraidas del codigo de cada proveedor: si alguien las toca sin
 * querer, el deploy falla antes de publicar un calculo incorrecto.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

describe('tarifas de Shop USA', () => {
  it('conserva las constantes extraidas de su calculadora', () => {
    expect(shopUsaRates.vatRate).toBe(0.13);
    expect(shopUsaRates.daiThresholdUsd).toBe(300);
    expect(shopUsaRates.taxableBaseKind).toBe('invoice');
    expect(shopUsaRates.weightRounding).toBe('ceil');
    expect(shopUsaRates.confidence).toBe('exact');
  });

  it('define los dos escalones de tarifa, con el ultimo abierto', () => {
    const tiers = shopUsaRates.modes.aereo.tiers;

    expect(tiers).toHaveLength(2);
    expect(tiers[0]).toEqual({ maxLb: 5, ratePerLb: 4.99 });
    expect(tiers[1]).toEqual({ maxLb: null, ratePerLb: 4.4 });
  });

  it('lleva fecha de verificacion y enlace al cotizador oficial', () => {
    expect(shopUsaRates.verifiedAt).toMatch(ISO_DATE);
    expect(shopUsaRates.officialQuoterUrl).toMatch(/^https:\/\//);
    expect(shopUsaRates.sourceUrl).toMatch(/^https:\/\//);
  });
});

describe('tarifas de Buyex', () => {
  it('conserva las constantes extraidas de su modulo de estimaciones', () => {
    expect(buyexRates.vatRate).toBe(0.13);
    expect(buyexRates.insuranceRate).toBe(0.015);
    expect(buyexRates.customsFreightRate).toBe(0.1);
    expect(buyexRates.taxableBaseKind).toBe('cif');
    expect(buyexRates.weightRounding).toBe('round');
    expect(buyexRates.minBillableLb).toBe(1);
    expect(buyexRates.confidence).toBe('exact');
  });

  it('replica la modalidad Prealerta, no COTI TODO INCLUIDO', () => {
    expect(buyexRates.serviceType).toBe('prealerta');
  });

  it('define aereo sin minimo y maritimo habilitado desde 8 lb', () => {
    expect(buyexRates.modes.aereo.ratePerLb).toBe(4.99);
    expect(buyexRates.modes.aereo.minWeightLb).toBeNull();

    expect(buyexRates.modes.maritimo.ratePerLb).toBe(2.99);
    expect(buyexRates.modes.maritimo.minWeightLb).toBe(8);
  });

  it('registra las exclusiones que el proveedor declara', () => {
    expect(buyexRates.excludes.length).toBeGreaterThan(0);
  });

  it('lleva fecha de verificacion y enlace al cotizador oficial', () => {
    expect(buyexRates.verifiedAt).toMatch(ISO_DATE);
    expect(buyexRates.officialQuoterUrl).toMatch(/^https:\/\//);
    expect(buyexRates.sourceUrl).toMatch(/^https:\/\//);
  });
});

/**
 * Ningun proveedor publica dias de transito. Estos rangos vienen de la
 * experiencia real de uso y son referenciales, en dias corridos. La UI los
 * etiqueta como tales.
 */
describe('tiempos de entrega', () => {
  it('los tres proveedores tienen rango', () => {
    expect(shopUsaRates.modes.aereo.transitDays).toEqual({ min: 7, max: 15 });
    expect(buyexRates.modes.aereo.transitDays).toEqual({ min: 3, max: 5 });
    expect(buyexRates.modes.maritimo.transitDays).toEqual({ min: 15, max: 20 });
    expect(quickboxRates.modes.aereo.transitDays).toEqual({ min: 3, max: 5 });
  });

  it('ningun rango esta invertido', () => {
    const rangos = [
      shopUsaRates.modes.aereo.transitDays,
      buyexRates.modes.aereo.transitDays,
      buyexRates.modes.maritimo.transitDays,
      quickboxRates.modes.aereo.transitDays,
    ];

    for (const r of rangos) {
      expect(r).not.toBeNull();
      expect(r!.min).toBeGreaterThan(0);
      expect(r!.max).toBeGreaterThanOrEqual(r!.min);
    }
  });

  it('el maritimo de Buyex es el mas lento, como corresponde', () => {
    const maritimo = buyexRates.modes.maritimo.transitDays!;
    const aereo = buyexRates.modes.aereo.transitDays!;

    expect(maritimo.min).toBeGreaterThan(aereo.max);
  });
});

/**
 * Quickbox no lleva tarifas replicadas: su API calcula y devuelve el monto. Lo
 * que se versiona son los parametros de la consulta, y eso es lo que se protege.
 */
describe('parametros de Quickbox', () => {
  it('apunta a El Salvador y al plan de pago por envio', () => {
    expect(quickboxRates.paisId).toBe('3');
    expect(quickboxRates.plans[0]?.planId).toBe('18');
    expect(quickboxRates.plans[0]?.costoPlanUsd).toBe(0);
  });

  it('incluye el plan Premium con su costo y libras', () => {
    const premium = quickboxRates.plans.find((p) => p.nombre === 'Premium');

    expect(premium?.planId).toBe('34');
    expect(premium?.costoPlanUsd).toBe(99);
    expect(premium?.duracionMeses).toBe(12);
    expect(premium?.librasIncluidas).toBe(33);
    expect(premium?.costoLibraUsd).toBe(3);
  });

  it('el primer plan es el de pago por envio, que es el comparable', () => {
    expect(quickboxRates.plans[0]?.costoPlanUsd).toBe(0);
    expect(
      quickboxRates.plans.slice(1).every((p) => p.costoPlanUsd > 0),
    ).toBe(true);
  });

  it('se marca como cotizacion en vivo, no como formula replicada', () => {
    expect(quickboxRates.confidence).toBe('live');
  });

  it('lleva timeout para que una API lenta no bloquee la comparacion', () => {
    expect(quickboxRates.timeoutMs).toBeGreaterThan(0);
    expect(quickboxRates.timeoutMs).toBeLessThanOrEqual(10_000);
  });

  it('conserva el umbral de DAI y el arancel para cotizar sin categoria', () => {
    expect(quickboxRates.daiThresholdUsd).toBe(300);
    expect(quickboxRates.noCategoryArancel.arancelId).toBeTruthy();
  });
});
