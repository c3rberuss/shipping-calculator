import { describe, expect, it } from 'vitest';

import { buildSearch, parseParams } from './url.js';

describe('parseParams', () => {
  it('lee los tres parametros', () => {
    expect(parseParams('?w=5.5&v=250&c=laptops-computadoras')).toEqual({
      weightLb: 5.5,
      declaredValueUsd: 250,
      categoryId: 'laptops-computadoras',
    });
  });

  it('acepta el query string con o sin interrogacion', () => {
    expect(parseParams('w=2&v=10&c=ropa')).toEqual(parseParams('?w=2&v=10&c=ropa'));
  });

  it('devuelve todo nulo sin parametros', () => {
    expect(parseParams('')).toEqual({
      weightLb: null,
      declaredValueUsd: null,
      categoryId: null,
    });
  });

  /**
   * Se descarta parametro por parametro, no el enlace entero: si el peso viene
   * corrupto pero el valor no, conservar el valor le ahorra trabajo al usuario.
   * Ver spec 4.9.
   */
  it('ignora solo los parametros invalidos', () => {
    expect(parseParams('?w=abc&v=250&c=ropa')).toEqual({
      weightLb: null,
      declaredValueUsd: 250,
      categoryId: 'ropa',
    });
  });

  it('rechaza numeros fuera de rango', () => {
    expect(parseParams('?w=-3').weightLb).toBeNull();
    expect(parseParams('?w=0').weightLb).toBeNull();
    expect(parseParams('?v=-1').declaredValueUsd).toBeNull();
  });

  it('acepta valor declarado cero', () => {
    expect(parseParams('?v=0').declaredValueUsd).toBe(0);
  });

  it('rechaza infinitos y notacion cientifica invalida', () => {
    expect(parseParams('?w=Infinity').weightLb).toBeNull();
    expect(parseParams('?w=NaN').weightLb).toBeNull();
  });

  it('trata la categoria vacia como ausente', () => {
    expect(parseParams('?c=').categoryId).toBeNull();
    expect(parseParams('?c=%20%20').categoryId).toBeNull();
  });

  it('no valida que la categoria exista: eso lo resuelve el catalogo', () => {
    expect(parseParams('?c=inventada').categoryId).toBe('inventada');
  });
});

describe('buildSearch', () => {
  it('serializa los tres parametros', () => {
    expect(
      buildSearch({ weightLb: 5.5, declaredValueUsd: 250, categoryId: 'ropa' }),
    ).toBe('?w=5.5&v=250&c=ropa');
  });

  it('omite lo que no aporta', () => {
    expect(
      buildSearch({ weightLb: 5, declaredValueUsd: null, categoryId: null }),
    ).toBe('?w=5');
  });

  it('devuelve cadena vacia sin datos, para no dejar un "?" suelto', () => {
    expect(
      buildSearch({ weightLb: null, declaredValueUsd: null, categoryId: null }),
    ).toBe('');
    expect(
      buildSearch({ weightLb: NaN, declaredValueUsd: NaN, categoryId: null }),
    ).toBe('');
  });

  it('conserva el valor declarado cero', () => {
    expect(
      buildSearch({ weightLb: 1, declaredValueUsd: 0, categoryId: null }),
    ).toBe('?w=1&v=0');
  });

  it('es reversible con parseParams', () => {
    const input = {
      weightLb: 12.5,
      declaredValueUsd: 899.99,
      categoryId: 'camaras',
    };
    expect(parseParams(buildSearch(input))).toEqual(input);
  });
});
