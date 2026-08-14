import { beforeEach, describe, expect, it } from 'vitest';

import { CACHE_KEY, QuoteCache } from './quote-cache.js';

/**
 * La cache existe para no golpear la API de un tercero en cada tecleo. Estas
 * pruebas cubren lo que hace que sirva: que no vuelva a consultar lo repetido,
 * que venza, y que nunca rompa la app si el almacenamiento falla.
 */

function fakeStorage(overrides: Partial<Storage> = {}): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (k: string) => data.get(k) ?? null,
    key: (i: number) => [...data.keys()][i] ?? null,
    removeItem: (k: string) => void data.delete(k),
    setItem: (k: string, v: string) => void data.set(k, v),
    ...overrides,
  } as Storage;
}

const TTL = 60_000;
let storage: Storage;
let clock: number;
let cache: QuoteCache<{ total: number }>;

beforeEach(() => {
  storage = fakeStorage();
  clock = 1_000_000;
  cache = new QuoteCache(storage, { ttlMs: TTL, now: () => clock });
});

describe('lectura y escritura', () => {
  it('devuelve undefined para una clave que no existe', () => {
    expect(cache.get('nada')).toBeUndefined();
  });

  it('devuelve lo guardado', () => {
    cache.set('a', { total: 19.51 });
    expect(cache.get('a')).toEqual({ total: 19.51 });
  });

  it('sobrescribe una clave existente', () => {
    cache.set('a', { total: 1 });
    cache.set('a', { total: 2 });

    expect(cache.get('a')).toEqual({ total: 2 });
    expect(cache.size).toBe(1);
  });
});

describe('vencimiento', () => {
  it('sirve la entrada hasta el limite del TTL', () => {
    cache.set('a', { total: 1 });
    clock += TTL - 1;

    expect(cache.get('a')).toEqual({ total: 1 });
  });

  it('descarta la entrada al cumplirse el TTL', () => {
    cache.set('a', { total: 1 });
    clock += TTL;

    expect(cache.get('a')).toBeUndefined();
  });

  it('no rehidrata entradas ya vencidas', () => {
    cache.set('a', { total: 1 });
    clock += TTL + 1;

    const nueva = new QuoteCache<{ total: number }>(storage, {
      ttlMs: TTL,
      now: () => clock,
    });
    expect(nueva.get('a')).toBeUndefined();
  });
});

describe('persistencia', () => {
  it('sobrevive a la recarga de la pagina', () => {
    cache.set('a', { total: 19.51 });

    const nueva = new QuoteCache<{ total: number }>(storage, {
      ttlMs: TTL,
      now: () => clock,
    });
    expect(nueva.get('a')).toEqual({ total: 19.51 });
  });

  it('limpia el almacenamiento al vaciarse', () => {
    cache.set('a', { total: 1 });
    cache.clear();

    expect(cache.get('a')).toBeUndefined();
    expect(storage.getItem(CACHE_KEY)).toBeNull();
  });
});

describe('tope de entradas', () => {
  it('descarta las mas viejas al pasarse del tope', () => {
    const chica = new QuoteCache<{ total: number }>(storage, {
      ttlMs: TTL,
      max: 3,
      now: () => clock,
    });

    for (let i = 1; i <= 5; i++) {
      clock += 100;
      chica.set(`k${i}`, { total: i });
    }

    expect(chica.size).toBe(3);
    expect(chica.get('k1')).toBeUndefined();
    expect(chica.get('k5')).toEqual({ total: 5 });
  });
});

describe('contenido corrupto', () => {
  it('empieza vacia si el JSON es invalido', () => {
    storage.setItem(CACHE_KEY, '{no es json');
    const nueva = new QuoteCache(storage, { ttlMs: TTL, now: () => clock });

    expect(nueva.size).toBe(0);
  });

  it('descarta entradas sin la forma esperada', () => {
    storage.setItem(
      CACHE_KEY,
      JSON.stringify({
        buena: { value: { total: 1 }, storedAt: clock },
        mala: { value: { total: 2 } },
        peor: 'texto',
      }),
    );
    const nueva = new QuoteCache<{ total: number }>(storage, {
      ttlMs: TTL,
      now: () => clock,
    });

    expect(nueva.size).toBe(1);
    expect(nueva.get('buena')).toEqual({ total: 1 });
  });
});

/**
 * La cache es una optimizacion. Si el almacenamiento no esta disponible debe
 * seguir funcionando en memoria, no romper la cotizacion.
 */
describe('almacenamiento no disponible', () => {
  it('funciona en memoria sin almacenamiento', () => {
    const memoria = new QuoteCache<{ total: number }>(null, {
      ttlMs: TTL,
      now: () => clock,
    });

    memoria.set('a', { total: 1 });
    expect(memoria.get('a')).toEqual({ total: 1 });
    expect(() => memoria.clear()).not.toThrow();
  });

  it('no lanza si escribir falla por cuota', () => {
    const roto = new QuoteCache<{ total: number }>(
      fakeStorage({
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
      }),
      { ttlMs: TTL, now: () => clock },
    );

    expect(() => roto.set('a', { total: 1 })).not.toThrow();
    // El nivel de memoria sigue sirviendo.
    expect(roto.get('a')).toEqual({ total: 1 });
  });

  it('no lanza si leer falla', () => {
    expect(
      () =>
        new QuoteCache(
          fakeStorage({
            getItem: () => {
              throw new Error('bloqueado');
            },
          }),
          { ttlMs: TTL, now: () => clock },
        ),
    ).not.toThrow();
  });
});
