import { describe, expect, it } from 'vitest';

import { quickboxRates } from '../../data/index.js';
import { quoteQuickbox } from './quickbox.js';

/**
 * Prueba de humo contra la API real de Quickbox.
 *
 * NO corre por defecto: sale a la red y depende de un tercero, asi que en CI
 * seria una prueba intermitente. Se corre a mano cuando se quiere confirmar que
 * su contrato sigue igual:
 *
 *   SC_LIVE=1 pnpm vitest run src/engine/providers/quickbox.live.test.ts
 *
 * Si falla, lo mas probable es que Quickbox haya cambiado su API. Eso no rompe
 * el sitio (la tarjeta pasa a "no disponible"), pero hay que revisarlo.
 */
const correr = process.env.SC_LIVE === '1';

describe.runIf(correr)('Quickbox (API real)', () => {
  it('cotiza 1 lb con factura de $100 y arancel al 0%', async () => {
    const [offer] = await quoteQuickbox(
      {
        weightLb: 1,
        declaredValueUsd: 100,
        arancelId: '228.0',
        categoryLabel: 'Cámaras y lentes fotográficos',
        approximate: false,
      },
      { rates: quickboxRates },
    );

    expect(offer?.available).toBe(true);
    if (!offer?.available) throw new Error('no disponible');

    expect(offer.totalUsd).toBeGreaterThan(0);
    expect(offer.breakdown.billableWeightLb).toBe(1);
    expect(offer.breakdown.ratePerLbUsd).toBeGreaterThan(0);
    expect(offer.breakdown.vatRate).toBe(0.13);
    expect(offer.breakdown.extraCharges.length).toBeGreaterThan(0);
  });

  /**
   * El umbral de $300 de El Salvador, verificado contra su propia API: es el
   * mismo que Shop USA lleva en codigo y que Buyex resuelve con una categoria
   * exenta.
   */
  it('no cobra DAI en $300 y si en $301', async () => {
    const base = {
      weightLb: 5,
      arancelId: '227.0',
      categoryLabel: 'Productos de higiene diaria',
      approximate: false,
    };

    const [en300] = await quoteQuickbox(
      { ...base, declaredValueUsd: 300 },
      { rates: quickboxRates },
    );
    const [en301] = await quoteQuickbox(
      { ...base, declaredValueUsd: 301 },
      { rates: quickboxRates },
    );

    if (!en300?.available || !en301?.available) throw new Error('no disponible');
    expect(en300.breakdown.daiUsd).toBe(0);
    expect(en301.breakdown.daiUsd).toBeGreaterThan(0);
  });

  it('bajo el umbral el arancel elegido no cambia el total', async () => {
    const base = {
      weightLb: 5,
      declaredValueUsd: 250,
      categoryLabel: 'Prueba',
      approximate: false,
    };

    const [con0] = await quoteQuickbox(
      { ...base, arancelId: '228.0' },
      { rates: quickboxRates },
    );
    const [con30] = await quoteQuickbox(
      { ...base, arancelId: '240.0' },
      { rates: quickboxRates },
    );

    if (!con0?.available || !con30?.available) throw new Error('no disponible');
    expect(con30.totalUsd).toBe(con0.totalUsd);
  });

  /**
   * El plan Premium cobra menos por libra, pero su API no descuenta las libras
   * prepagadas ni suma el costo del plan. Esta prueba fija ese comportamiento:
   * si algun dia lo corrigen, hay que replantear como se presenta.
   */
  it('el Premium cobra menos por libra y su total ignora el costo del plan', async () => {
    const offers = await quoteQuickbox(
      {
        weightLb: 10,
        declaredValueUsd: 250,
        arancelId: '228.0',
        categoryLabel: 'Cámaras y lentes fotográficos',
        approximate: false,
      },
      { rates: quickboxRates },
    );

    const estandar = offers.find((o) => o.offerId === 'quickbox:aereo:18');
    const premium = offers.find((o) => o.offerId === 'quickbox:aereo:34');
    if (!estandar?.available || !premium?.available) {
      throw new Error('no disponible');
    }

    expect(premium.breakdown.ratePerLbUsd).toBeLessThan(
      estandar.breakdown.ratePerLbUsd,
    );
    expect(premium.totalUsd).toBeLessThan(estandar.totalUsd);
    // Si empezaran a sumar los $99, el total pasaria de largo al del Estandar.
    expect(premium.totalUsd).toBeLessThan(estandar.totalUsd + 99);
    expect(premium.subscription?.costUsd).toBe(99);
  });
});
