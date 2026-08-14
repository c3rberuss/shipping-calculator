import { describe, expect, it } from 'vitest';

import { escapeHtml, isoDateToLocal, money, percent, weight } from './format.js';

describe('money', () => {
  it('siempre muestra dos decimales', () => {
    expect(money(76.5)).toBe('$76.50');
    expect(money(4)).toBe('$4.00');
    expect(money(0)).toBe('$0.00');
  });

  it('separa miles', () => {
    expect(money(1234.56)).toBe('$1,234.56');
  });
});

describe('percent', () => {
  it('convierte fracciones a porcentaje legible', () => {
    expect(percent(0.15)).toBe('15%');
    expect(percent(0)).toBe('0%');
    expect(percent(0.4)).toBe('40%');
  });

  it('conserva decimales cuando los hay', () => {
    expect(percent(0.145)).toBe('14.5%');
  });

  it('no arrastra ruido de punto flotante', () => {
    expect(percent(0.14)).toBe('14%');
    expect(percent(0.07)).toBe('7%');
  });
});

describe('weight', () => {
  it('singulariza una libra', () => {
    expect(weight(1)).toBe('1 lb');
    expect(weight(2)).toBe('2 lbs');
  });
});

describe('isoDateToLocal', () => {
  /**
   * `new Date('2026-08-13')` se interpreta como UTC y en El Salvador (UTC-6)
   * se renderiza como 12 de agosto. Por eso se parsea a mano.
   */
  it('no corre la fecha un dia hacia atras', () => {
    expect(isoDateToLocal('2026-08-13')).toBe('13/08/2026');
    expect(isoDateToLocal('2026-01-01')).toBe('01/01/2026');
  });

  it('devuelve la entrada tal cual si no tiene el formato esperado', () => {
    expect(isoDateToLocal('sin fecha')).toBe('sin fecha');
  });
});

describe('escapeHtml', () => {
  it('neutraliza los caracteres que romperian el markup', () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;',
    );
  });

  it('escapa el ampersand primero para no doble-escapar', () => {
    expect(escapeHtml('a & <b>')).toBe('a &amp; &lt;b&gt;');
  });
});
