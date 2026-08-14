import { describe, expect, it, vi } from 'vitest';

import { quickboxRates } from '../../data/index.js';
import type { QuickboxFetch } from './quickbox.js';
import {
  breakEvenLb,
  parseQuickboxResponse,
  quickboxCacheKey,
  quoteQuickbox,
} from './quickbox.js';

/**
 * Respuesta real de su API, capturada el 2026-08-13 con
 * peso=1, valor=100, arancel_id=228.0 (Accesorio de Cámara 0%).
 *
 * Se conserva literal, incluidos los flotantes largos, porque es el contrato
 * que estamos consumiendo: si cambia su forma, estas pruebas avisan.
 */
const RESPUESTA_REAL = {
  result: true,
  message: 'Datos consultados exitosamente',
  records: {
    valor: '100.00',
    peso: '1.00',
    costo_libra: '3.30',
    servicios: [
      {
        tipo_gasto: 2,
        nombre: 'Flete Quickbox',
        valor_total: '3.73',
        valor_numerico: 3.7289999999999996,
      },
      {
        tipo_gasto: 4,
        nombre: 'Gestión aeropuerto',
        valor_total: '1.69',
        valor_numerico: 1.6949999999999998,
      },
      {
        tipo_gasto: 18,
        nombre: 'Cobro administrativo cuenta ajena',
        valor_total: '0.46',
        valor_numerico: 0.4618535999999999,
      },
    ],
    impuestos: [
      { tipo_gasto: 9, nombre: 'DAI', valor_total: '0.00', valor_numerico: 0 },
      {
        tipo_gasto: 10,
        nombre: 'IVA - CIF',
        valor_total: '13.62',
        valor_numerico: 13.623999999999999,
      },
    ],
    total_servicios: '5.89',
    total_impuestos: '13.62',
    total_local: '19.51',
    total_dolares: '19.51',
    descripcion_arancel: 'Accesorio de Cámara 0%',
    tasa_impuesto: '13%',
    tasa_cambio: '1.00',
    moneda_local: 'US$.',
    moneda_dolares: 'US$',
  },
};

function fetchStub(payload: unknown, ok = true): QuickboxFetch {
  return vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => payload,
  }));
}

const INPUT = {
  weightLb: 1,
  declaredValueUsd: 100,
  arancelId: '228.0',
  categoryLabel: 'Cámaras y lentes fotográficos',
  approximate: false,
};

/** Solo el plan de pago por envio, que es el comparable cabeza a cabeza. */
async function estandar(
  input = INPUT,
  deps: Parameters<typeof quoteQuickbox>[1],
) {
  const offers = await quoteQuickbox(input, deps);
  const offer = offers.find((o) => o.offerId === 'quickbox:aereo:18');
  if (!offer) throw new Error('no se genero la oferta del plan Estandar');
  return offer;
}

async function premium(deps: Parameters<typeof quoteQuickbox>[1]) {
  const offers = await quoteQuickbox(INPUT, deps);
  const offer = offers.find((o) => o.offerId === 'quickbox:aereo:34');
  if (!offer) throw new Error('no se genero la oferta del plan Premium');
  return offer;
}

describe('quickboxCacheKey', () => {
  it('depende de los datos que determinan la respuesta, plan incluido', () => {
    const base = {
      weightLb: 1,
      declaredValueUsd: 100,
      arancelId: 'a',
      planId: '18',
    };
    expect(quickboxCacheKey({ ...base, planId: '34' })).not.toBe(
      quickboxCacheKey(base),
    );
    expect(quickboxCacheKey(base)).toBe(quickboxCacheKey({ ...base }));
    expect(quickboxCacheKey({ ...base, weightLb: 2 })).not.toBe(
      quickboxCacheKey(base),
    );
    expect(quickboxCacheKey({ ...base, declaredValueUsd: 2 })).not.toBe(
      quickboxCacheKey(base),
    );
    expect(quickboxCacheKey({ ...base, arancelId: 'b' })).not.toBe(
      quickboxCacheKey(base),
    );
  });
});

describe('parseQuickboxResponse', () => {
  it('normaliza la respuesta real', () => {
    const q = parseQuickboxResponse(RESPUESTA_REAL);

    expect(q.billableWeightLb).toBe(1);
    expect(q.ratePerLbUsd).toBe(3.3);
    expect(q.freightUsd).toBe(3.73);
    expect(q.daiUsd).toBe(0);
    expect(q.vatUsd).toBe(13.62);
    expect(q.vatRate).toBe(0.13);
    expect(q.totalUsd).toBe(19.51);
    expect(q.arancelDescription).toBe('Accesorio de Cámara 0%');
  });

  it('separa los cargos que no son flete', () => {
    const q = parseQuickboxResponse(RESPUESTA_REAL);

    // 1.6949999999999998 redondea a 1.69, que es justo lo que Quickbox muestra
    // en su propio campo `valor_total`. Nuestro redondeo coincide con el suyo.
    expect(q.extraCharges).toEqual([
      { label: 'Gestión aeropuerto', amountUsd: 1.69 },
      { label: 'Cobro administrativo cuenta ajena', amountUsd: 0.46 },
    ]);
  });

  it('rechaza una respuesta sin result true', () => {
    expect(() =>
      parseQuickboxResponse({ result: false, message: 'Sin datos' }),
    ).toThrow('Sin datos');
  });

  it('rechaza una respuesta sin total', () => {
    expect(() =>
      parseQuickboxResponse({
        result: true,
        records: { ...RESPUESTA_REAL.records, total_dolares: '0.00' },
      }),
    ).toThrow(/total/);
  });

  it('rechaza cualquier cosa que no sea objeto', () => {
    expect(() => parseQuickboxResponse(null)).toThrow();
    expect(() => parseQuickboxResponse('texto')).toThrow();
  });

  it('tolera que falten los arreglos de cargos', () => {
    const q = parseQuickboxResponse({
      result: true,
      records: { total_dolares: '10.00', peso: '1.00' },
    });

    expect(q.totalUsd).toBe(10);
    expect(q.extraCharges).toEqual([]);
    expect(q.freightUsd).toBe(0);
  });
});

describe('quoteQuickbox', () => {
  it('devuelve una oferta con el total que calculo Quickbox', async () => {
    const offer = await estandar(INPUT, {
      rates: quickboxRates,
      fetchImpl: fetchStub(RESPUESTA_REAL),
    });

    expect(offer.available).toBe(true);
    if (!offer.available) throw new Error('oferta no disponible');

    expect(offer.providerName).toBe('Quickbox Estándar');
    expect(offer.totalUsd).toBe(19.51);
    expect(offer.confidence).toBe('live');
  });

  it('envia los parametros que su API espera', async () => {
    const stub = fetchStub(RESPUESTA_REAL);
    await quoteQuickbox(INPUT, { rates: quickboxRates, fetchImpl: stub });

    // Una consulta por plan.
    expect(stub).toHaveBeenCalledTimes(2);
    const [url, init] = vi.mocked(stub).mock.calls[0]!;
    expect(url).toBe('https://node.qs.gt/cotizador');
    expect(init.method).toBe('POST');

    const body = new URLSearchParams(init.body);
    expect(body.get('peso')).toBe('1');
    expect(body.get('valor')).toBe('100');
    expect(body.get('arancel_id')).toBe('228.0');
    // 3 = El Salvador; 18 = plan Estandar.
    expect(body.get('pais_id')).toBe('3');
    expect(body.get('plan_id')).toBe('18');
  });

  it('expone los cargos extra en el desglose', async () => {
    const offer = await estandar(INPUT, {
      rates: quickboxRates,
      fetchImpl: fetchStub(RESPUESTA_REAL),
    });
    if (!offer.available) throw new Error('oferta no disponible');

    expect(offer.breakdown.extraCharges.map((c) => c.label)).toEqual([
      'Gestión aeropuerto',
      'Cobro administrativo cuenta ajena',
    ]);
  });

  /**
   * Su IVA se llama "IVA - CIF" pero no devuelven el CIF. Marcarlo como no
   * publicado evita que la UI muestre el valor de factura como si fuera la base.
   */
  it('marca la base gravable como no publicada', async () => {
    const offer = await estandar(INPUT, {
      rates: quickboxRates,
      fetchImpl: fetchStub(RESPUESTA_REAL),
    });
    if (!offer.available) throw new Error('oferta no disponible');

    expect(offer.breakdown.taxableBaseDisclosed).toBe(false);
    expect(offer.breakdown.taxableBaseKind).toBe('cif');
  });

  it('lee el porcentaje del arancel del texto que devuelve', async () => {
    const offer = await estandar(INPUT, {
      rates: quickboxRates,
      fetchImpl: fetchStub({
        ...RESPUESTA_REAL,
        records: {
          ...RESPUESTA_REAL.records,
          descripcion_arancel: 'Accesorio de Aseo Personal 15%',
        },
      }),
    });
    if (!offer.available) throw new Error('oferta no disponible');

    expect(offer.breakdown.daiRate).toBe(0.15);
  });

  it('advierte que el flete ya incluye IVA', async () => {
    const offer = await estandar(INPUT, {
      rates: quickboxRates,
      fetchImpl: fetchStub(RESPUESTA_REAL),
    });
    if (!offer.available) throw new Error('oferta no disponible');

    expect(offer.notes.some((n) => n.includes('incluyen el IVA'))).toBe(true);
  });

  it('advierte cuando el mapeo de arancel es aproximado', async () => {
    const offer = await estandar(
      { ...INPUT, approximate: true },
      { rates: quickboxRates, fetchImpl: fetchStub(RESPUESTA_REAL) },
    );
    if (!offer.available) throw new Error('oferta no disponible');

    expect(offer.notes.some((n) => n.includes('arancel exacto'))).toBe(true);
  });

  describe('categoria sin mapeo', () => {
    it('no consulta la API y devuelve no disponible', async () => {
      const stub = fetchStub(RESPUESTA_REAL);
      const offers = await quoteQuickbox(
        { ...INPUT, arancelId: null, categoryLabel: 'Otros bienes' },
        { rates: quickboxRates, fetchImpl: stub },
      );

      expect(stub).not.toHaveBeenCalled();
      // Un solo aviso: la causa no depende del plan.
      expect(offers).toHaveLength(1);
      const [offer] = offers;
      expect(offer?.available).toBe(false);
      if (offer && !offer.available) {
        expect(offer.reason).toBe('category-not-mapped');
        expect(offer.detail).toContain('Otros bienes');
      }
    });
  });

  /**
   * Depender de un tercero significa que va a fallar alguna vez. Cuando pasa,
   * la comparacion de los otros dos proveedores no debe romperse.
   */
  describe('cuando su API falla', () => {
    it('devuelve no disponible ante un error HTTP', async () => {
      const offer = await estandar(INPUT, {
        rates: quickboxRates,
        fetchImpl: fetchStub({}, false),
      });

      expect(offer.available).toBe(false);
      if (!offer.available) {
        expect(offer.reason).toBe('provider-unreachable');
        expect(offer.detail).toContain('HTTP 500');
        expect(offer.detail).toContain('Los demás proveedores');
      }
    });

    it('devuelve no disponible si la red falla', async () => {
      const offer = await estandar(INPUT, {
        rates: quickboxRates,
        fetchImpl: vi.fn(async () => {
          throw new Error('conexión rechazada');
        }) as unknown as QuickboxFetch,
      });

      expect(offer.available).toBe(false);
      if (!offer.available) expect(offer.reason).toBe('provider-unreachable');
    });

    it('devuelve no disponible si responde algo inesperado', async () => {
      const offer = await estandar(INPUT, {
        rates: quickboxRates,
        fetchImpl: fetchStub({ cualquier: 'cosa' }),
      });

      expect(offer.available).toBe(false);
      if (!offer.available) expect(offer.reason).toBe('provider-unreachable');
    });

    it('mantiene el enlace a su cotizador oficial para poder confirmar a mano', async () => {
      const offer = await estandar(INPUT, {
        rates: quickboxRates,
        fetchImpl: fetchStub({}, false),
      });

      expect(offer.officialQuoterUrl).toContain('quickboxusa.com');
    });
  });

  describe('cache', () => {
    it('no vuelve a consultar una cotizacion ya vista', async () => {
      const stub = fetchStub(RESPUESTA_REAL);
      const store = new Map<string, ReturnType<typeof parseQuickboxResponse>>();
      const cache = {
        get: (k: string) => store.get(k),
        set: (k: string, v: ReturnType<typeof parseQuickboxResponse>) =>
          void store.set(k, v),
      };

      await quoteQuickbox(INPUT, { rates: quickboxRates, fetchImpl: stub, cache });
      await quoteQuickbox(INPUT, { rates: quickboxRates, fetchImpl: stub, cache });

      // Dos planes en la primera vuelta; la segunda sale toda de cache.
      expect(stub).toHaveBeenCalledTimes(2);
    });

    it('consulta de nuevo si algun dato cambia', async () => {
      const stub = fetchStub(RESPUESTA_REAL);
      const store = new Map<string, ReturnType<typeof parseQuickboxResponse>>();
      const cache = {
        get: (k: string) => store.get(k),
        set: (k: string, v: ReturnType<typeof parseQuickboxResponse>) =>
          void store.set(k, v),
      };

      await quoteQuickbox(INPUT, { rates: quickboxRates, fetchImpl: stub, cache });
      await quoteQuickbox(
        { ...INPUT, weightLb: 2 },
        { rates: quickboxRates, fetchImpl: stub, cache },
      );

      // Dos planes por cada peso distinto.
      expect(stub).toHaveBeenCalledTimes(4);
    });

    it('no guarda en cache una consulta que fallo', async () => {
      const store = new Map<string, ReturnType<typeof parseQuickboxResponse>>();
      const cache = {
        get: (k: string) => store.get(k),
        set: (k: string, v: ReturnType<typeof parseQuickboxResponse>) =>
          void store.set(k, v),
      };

      await quoteQuickbox(INPUT, {
        rates: quickboxRates,
        fetchImpl: fetchStub({}, false),
        cache,
      });

      expect(store.size).toBe(0);
    });
  });
});

/**
 * Su API cobra $3.00/lb con el plan Premium pero NO descuenta las 33 libras
 * prepagadas ni suma el costo del plan. Mostrar ese total como si fuera
 * comparable con el pago por envio seria enganoso: hay $99 al ano escondidos.
 */
describe('plan Premium', () => {
  it('cotiza los dos planes', async () => {
    const offers = await quoteQuickbox(INPUT, {
      rates: quickboxRates,
      fetchImpl: fetchStub(RESPUESTA_REAL),
    });

    expect(offers.map((o) => o.offerId)).toEqual([
      'quickbox:aereo:18',
      'quickbox:aereo:34',
    ]);
  });

  it('envia el plan_id de cada plan', async () => {
    const stub = fetchStub(RESPUESTA_REAL);
    await quoteQuickbox(INPUT, { rates: quickboxRates, fetchImpl: stub });

    const planes = vi
      .mocked(stub)
      .mock.calls.map(([, init]) => new URLSearchParams(init.body).get('plan_id'));
    expect(planes).toEqual(['18', '34']);
  });

  it('nombra las ofertas con su plan', async () => {
    const offer = await premium({
      rates: quickboxRates,
      fetchImpl: fetchStub(RESPUESTA_REAL),
    });
    if (!offer.available) throw new Error('oferta no disponible');

    expect(offer.providerName).toBe('Quickbox Premium');
  });

  it('marca la oferta con suscripcion y su punto de equilibrio', async () => {
    const offer = await premium({
      rates: quickboxRates,
      fetchImpl: fetchStub(RESPUESTA_REAL),
    });
    if (!offer.available) throw new Error('oferta no disponible');

    expect(offer.subscription).toEqual({
      planName: 'Premium',
      costUsd: 99,
      periodMonths: 12,
      includedLb: 33,
      // $99 / $3.30 por libra del plan Estandar = 30 lb.
      breakEvenLbPerPeriod: 30,
    });
  });

  it('advierte que el total no incluye el costo del plan', async () => {
    const offer = await premium({
      rates: quickboxRates,
      fetchImpl: fetchStub(RESPUESTA_REAL),
    });
    if (!offer.available) throw new Error('oferta no disponible');

    expect(
      offer.notes.some((n) => n.includes('no descuenta las 33 libras')),
    ).toBe(true);
  });

  it('el plan de pago por envio no lleva marca de suscripcion', async () => {
    const offer = await estandar(INPUT, {
      rates: quickboxRates,
      fetchImpl: fetchStub(RESPUESTA_REAL),
    });
    if (!offer.available) throw new Error('oferta no disponible');

    expect(offer.subscription).toBeUndefined();
  });
});

describe('breakEvenLb', () => {
  const pagoPorEnvio = {
    planId: '18',
    nombre: 'Estándar',
    costoPlanUsd: 0,
    duracionMeses: 0,
    librasIncluidas: 0,
    costoLibraUsd: 3.3,
  };

  it('calcula desde cuantas libras conviene el plan', () => {
    expect(
      breakEvenLb(
        {
          planId: '34',
          nombre: 'Premium',
          costoPlanUsd: 99,
          duracionMeses: 12,
          librasIncluidas: 33,
          costoLibraUsd: 3,
        },
        pagoPorEnvio,
      ),
    ).toBe(30);
  });

  it('redondea hacia arriba: media libra no alcanza para amortizar', () => {
    expect(
      breakEvenLb({ ...pagoPorEnvio, costoPlanUsd: 100, costoLibraUsd: 3 }, pagoPorEnvio),
    ).toBe(31);
  });

  it('es cero para un plan sin costo fijo', () => {
    expect(breakEvenLb(pagoPorEnvio, pagoPorEnvio)).toBe(0);
  });
});
