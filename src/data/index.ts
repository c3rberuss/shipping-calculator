/**
 * Carga de tarifas.
 *
 * Los JSON se importan en build time y quedan inlineados en el bundle, asi que
 * Shop USA y Buyex se calculan sin tocar la red. Quickbox es la excepcion: se
 * cotiza en vivo contra su API (fase 4), y lo que se versiona aqui son los
 * parametros de esa consulta, no sus tarifas.
 *
 * El cast es necesario porque TypeScript infiere `string` para los literales
 * del JSON. La forma se valida en `rates.test.ts`.
 */

import type {
  BuyexRates,
  Catalog,
  QuickboxRates,
  ShopUsaRates,
} from '../engine/types.js';

import catalogJson from './catalog.json' with { type: 'json' };
import buyexJson from './rates/buyex.json' with { type: 'json' };
import quickboxJson from './rates/quickbox.json' with { type: 'json' };
import shopUsaJson from './rates/shopusa.json' with { type: 'json' };

export const shopUsaRates = shopUsaJson as ShopUsaRates;
export const buyexRates = buyexJson as BuyexRates;
export const quickboxRates = quickboxJson as QuickboxRates;
export const catalog = catalogJson as Catalog;

export const rates = { shopusa: shopUsaRates, buyex: buyexRates };
