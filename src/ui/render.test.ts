import { describe, expect, it } from 'vitest';

import { catalog, rates } from '../data/index.js';
import { quoteAll } from '../engine/index.js';
import type { QuoteInput } from '../engine/types.js';
import { inputPrompt, renderResults } from './render.js';

/**
 * El renderizado se prueba sobre la cadena HTML, sin navegador. No sustituye
 * una revision visual, pero si atrapa lo que mas se rompe en silencio: montos
 * mal formateados, tarjetas que no aparecen y avisos que se pierden.
 */

function quote(input: Partial<QuoteInput> = {}) {
  return quoteAll(
    { weightLb: 10, declaredValueUsd: 250, categoryId: 'ropa', ...input },
    catalog,
    rates,
  );
}

describe('inputPrompt', () => {
  it('pide el peso primero', () => {
    expect(inputPrompt(NaN, 100)).toContain('peso');
    expect(inputPrompt(0, 100)).toContain('peso');
  });

  it('pide el valor cuando ya hay peso', () => {
    expect(inputPrompt(5, NaN)).toContain('valor');
  });

  it('acepta valor cero', () => {
    expect(inputPrompt(5, 0)).toBeNull();
  });
});

describe('renderResults', () => {
  it('muestra el estado inicial sin peso', () => {
    const html = renderResults(quote({ weightLb: NaN }));
    expect(html).toContain('class="empty"');
    expect(html).toContain('peso');
  });

  it('renderiza una tarjeta por oferta', () => {
    const html = renderResults(quote());
    const cards = html.match(/<article class="offer/g) ?? [];
    expect(cards).toHaveLength(3);
  });

  it('marca como mas barata solo la primera', () => {
    const html = renderResults(quote());
    expect(html.match(/offer--cheapest/g)).toHaveLength(1);
    expect(html.indexOf('offer--cheapest')).toBeLessThan(
      html.indexOf('</article>'),
    );
  });

  it('muestra cuanto se ahorra frente a la mas cara', () => {
    const result = quote();
    const html = renderResults(result);
    const diff = result.offers[result.offers.length - 1]!.totalUsd -
      result.offers[0]!.totalUsd;

    expect(html).toContain('ahorrás');
    expect(html).toContain(`$${diff.toFixed(2)}`);
  });

  it('no marca la mas barata cuando hay una sola oferta', () => {
    // Categoria sin mapeo en Buyex: solo cotiza Shop USA.
    const html = renderResults(
      quote({ declaredValueUsd: 500, categoryId: 'otros' }),
    );
    expect(html).not.toContain('offer--cheapest');
    expect(html).toContain('1 opción');
  });

  it('formatea los montos con dos decimales', () => {
    const html = renderResults(quote());
    expect(html).toMatch(/\$\d[\d,]*\.\d{2}/);
    expect(html).not.toMatch(/\$\d+\.\d{3,}/);
  });

  it('muestra el desglose con base gravable de cada proveedor', () => {
    const html = renderResults(quote({ declaredValueUsd: 500 }));
    expect(html).toContain('Valor de factura');
    expect(html).toContain('CIF');
    expect(html).toContain('Seguro');
    expect(html).toContain('Flete aduanero');
  });

  it('incluye fecha de vigencia y enlace al cotizador oficial en cada oferta', () => {
    const html = renderResults(quote());
    expect(html.match(/Tarifas verificadas el 13\/08\/2026/g)).toHaveLength(3);
    expect(html.match(/Confirmar en su cotizador/g)).toHaveLength(3);
    expect(html).toContain('https://shopusa.la/');
    expect(html).toContain('https://comprabuyex.com/cotizarconbuyex/');
  });

  it('abre enlaces externos de forma segura', () => {
    const html = renderResults(quote());
    const anchors = html.match(/<a href="https[^>]*>/g) ?? [];
    expect(anchors.length).toBeGreaterThan(0);
    for (const a of anchors) {
      expect(a).toContain('rel="noopener noreferrer"');
    }
  });

  it('propaga las notas de cada oferta', () => {
    const html = renderResults(quote());
    expect(html).toContain('volumétrico');
    expect(html).toContain('entregas locales');
  });

  it('lista las ofertas no disponibles con su motivo', () => {
    // Bajo 8 lb el maritimo de Buyex no esta habilitado.
    const html = renderResults(quote({ weightLb: 3 }));
    expect(html).toContain('offer--unavailable');
    expect(html).toContain('No disponibles para este paquete');
    expect(html).toContain('desde 8 lb');
  });

  it('consolida en un solo mensaje cuando a todos les falta la categoria', () => {
    const html = renderResults(
      quote({ declaredValueUsd: 500, categoryId: null }),
    );
    expect(html).toContain('class="empty"');
    expect(html).toContain('categoría');
    expect(html).not.toContain('offer--unavailable');
  });

  /**
   * Con factura sobre $300 y peso bajo 8 lb conviven dos motivos de
   * indisponibilidad: falta la categoria, y el maritimo de Buyex no aplica por
   * peso. Aun asi la accion del usuario es una sola, y consolidar sigue siendo
   * lo correcto.
   */
  it('consolida aunque convivan motivos distintos de indisponibilidad', () => {
    const html = renderResults(
      quote({ weightLb: 5, declaredValueUsd: 800, categoryId: null }),
    );
    expect(html).toContain('class="empty"');
    expect(html).toContain('categoría');
    expect(html).not.toContain('offer--unavailable');
  });

  it('no consolida cuando el problema no se resuelve eligiendo categoria', () => {
    // "otros" no mapea en Buyex: elegir otra categoria es la salida, pero Shop
    // USA si cotiza, asi que hay resultados que mostrar.
    const html = renderResults(
      quote({ declaredValueUsd: 500, categoryId: 'otros' }),
    );
    expect(html).toContain('offer--unavailable');
    expect(html).toContain('no tiene una categoría equivalente');
  });

  it('no exige categoria bajo el umbral de exencion', () => {
    const html = renderResults(quote({ declaredValueUsd: 100, categoryId: null }));
    expect(html).toContain('3 opciones');
  });

  it('advierte cuando el mapeo de categoria es aproximado', () => {
    // "drones" mapea aproximado en Buyex.
    const html = renderResults(
      quote({ declaredValueUsd: 800, categoryId: 'drones' }),
    );
    expect(html).toContain('categoría exacta');
  });

  it('muestra el rango de dias y lo etiqueta como referencial', () => {
    const html = renderResults(quote());

    expect(html).toContain('offer__transit');
    // Shop USA: 7 a 15 dias.
    expect(html).toContain('7 a 15 días');
    expect(html).toContain('referencial');
  });

  it('no imprime valores vacios en ningun campo', () => {
    const html = renderResults(quote());
    expect(html).not.toContain('undefined');
    expect(html).not.toContain('null');
  });

  /**
   * El rango es referencial: si algun proveedor deja de tener dato, la etiqueta
   * debe desaparecer en vez de mostrar un rango vacio.
   */
  it('omite la etiqueta cuando un proveedor no tiene rango', () => {
    const result = quote();
    result.offers[0]!.transitDays = null;
    const html = renderResults(result);

    const etiquetas = html.match(/offer__transit/g) ?? [];
    expect(etiquetas).toHaveLength(result.offers.length - 1);
  });

  it('escapa el contenido dinamico', () => {
    const result = quote();
    result.offers[0]!.providerName = '<img src=x onerror=alert(1)>';
    const html = renderResults(result);

    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });
});
