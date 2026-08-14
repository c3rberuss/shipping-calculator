import { describe, expect, it } from 'vitest';

import { baseHref, withBase } from './paths.js';

/**
 * El caso que motiva estas pruebas: `actions/configure-pages` entrega el base
 * como `/repo`, sin barra final, y la concatenacion directa produjo
 * `/repofavicon.svg` en el primer build para GitHub Pages.
 */
describe('withBase', () => {
  it('agrega la barra cuando el base no la trae', () => {
    expect(withBase('/shipping-calculator', 'favicon.svg')).toBe(
      '/shipping-calculator/favicon.svg',
    );
  });

  it('no duplica la barra cuando el base la trae', () => {
    expect(withBase('/shipping-calculator/', 'favicon.svg')).toBe(
      '/shipping-calculator/favicon.svg',
    );
  });

  it('tolera que la ruta empiece con barra', () => {
    expect(withBase('/repo', '/favicon.svg')).toBe('/repo/favicon.svg');
    expect(withBase('/repo/', '/favicon.svg')).toBe('/repo/favicon.svg');
  });

  it('funciona en la raiz del dominio', () => {
    expect(withBase('/', 'favicon.svg')).toBe('/favicon.svg');
  });
});

describe('baseHref', () => {
  it('siempre termina en barra', () => {
    expect(baseHref('/')).toBe('/');
    expect(baseHref('/repo')).toBe('/repo/');
    expect(baseHref('/repo/')).toBe('/repo/');
  });
});
