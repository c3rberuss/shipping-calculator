import { beforeEach, describe, expect, it } from 'vitest';

import {
  HISTORY_KEY,
  HistoryStore,
  entryId,
  safeLocalStorage,
} from './history.js';

/** localStorage en memoria, con fallos inyectables. */
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

const BASE = {
  weightLb: 10,
  declaredValueUsd: 250,
  categoryId: 'ropa',
  categoryLabel: 'Ropa',
  cheapest: { providerName: 'Buyex', mode: 'maritimo' as const, totalUsd: 66.14 },
};

let storage: Storage;
let clock: number;
let store: HistoryStore;

beforeEach(() => {
  storage = fakeStorage();
  clock = 1_000_000;
  // El reemplazo por ventana se prueba aparte; aqui estorbaria.
  store = new HistoryStore(storage, { now: () => clock, supersedeWithinMs: 0 });
});

describe('entryId', () => {
  it('es igual para los mismos inputs', () => {
    expect(entryId({ weightLb: 1, declaredValueUsd: 2, categoryId: 'x' })).toBe(
      entryId({ weightLb: 1, declaredValueUsd: 2, categoryId: 'x' }),
    );
  });

  it('distingue por cada campo', () => {
    const a = entryId({ weightLb: 1, declaredValueUsd: 2, categoryId: 'x' });
    expect(entryId({ weightLb: 9, declaredValueUsd: 2, categoryId: 'x' })).not.toBe(a);
    expect(entryId({ weightLb: 1, declaredValueUsd: 9, categoryId: 'x' })).not.toBe(a);
    expect(entryId({ weightLb: 1, declaredValueUsd: 2, categoryId: 'y' })).not.toBe(a);
  });

  it('distingue "sin categoria" de una categoria concreta', () => {
    expect(entryId({ weightLb: 1, declaredValueUsd: 2, categoryId: null })).not.toBe(
      entryId({ weightLb: 1, declaredValueUsd: 2, categoryId: 'x' }),
    );
  });
});

describe('agregar y listar', () => {
  it('empieza vacio', () => {
    expect(store.list()).toEqual([]);
  });

  it('guarda la entrada con su marca de tiempo', () => {
    store.add(BASE);
    const [entry] = store.list();

    expect(entry?.savedAt).toBe(1_000_000);
    expect(entry?.cheapest.totalUsd).toBe(66.14);
    expect(entry?.categoryLabel).toBe('Ropa');
  });

  it('pone la mas reciente primero', () => {
    store.add(BASE);
    clock += 1000;
    store.add({ ...BASE, weightLb: 20 });

    expect(store.list().map((e) => e.weightLb)).toEqual([20, 10]);
  });

  it('no duplica una cotizacion repetida: la sube y le refresca la fecha', () => {
    store.add(BASE);
    clock += 5000;
    store.add({ ...BASE, weightLb: 20 });
    clock += 5000;
    store.add(BASE);

    const list = store.list();
    expect(list).toHaveLength(2);
    expect(list[0]?.weightLb).toBe(10);
    expect(list[0]?.savedAt).toBe(1_010_000);
  });

  it('respeta el maximo descartando la mas antigua', () => {
    const small = new HistoryStore(storage, {
      max: 3,
      now: () => clock,
      supersedeWithinMs: 0,
    });
    for (let i = 1; i <= 5; i++) {
      clock += 1000;
      small.add({ ...BASE, weightLb: i });
    }

    expect(small.list().map((e) => e.weightLb)).toEqual([5, 4, 3]);
  });

  it('persiste entre instancias', () => {
    store.add(BASE);
    const otra = new HistoryStore(storage, { now: () => clock, supersedeWithinMs: 0 });

    expect(otra.list()).toHaveLength(1);
  });
});

describe('quitar y limpiar', () => {
  it('quita una entrada por id', () => {
    store.add(BASE);
    clock += 1000;
    store.add({ ...BASE, weightLb: 20 });

    const id = store.list()[0]!.id;
    store.remove(id);

    expect(store.list().map((e) => e.weightLb)).toEqual([10]);
  });

  it('ignora un id inexistente', () => {
    store.add(BASE);
    store.remove('no-existe');

    expect(store.list()).toHaveLength(1);
  });

  it('limpia todo', () => {
    store.add(BASE);
    store.clear();

    expect(store.list()).toEqual([]);
  });
});

describe('contenido corrupto', () => {
  it('sobrevive a JSON invalido', () => {
    storage.setItem(HISTORY_KEY, '{no es json');
    expect(store.list()).toEqual([]);
  });

  it('sobrevive a un JSON que no es arreglo', () => {
    storage.setItem(HISTORY_KEY, '{"a":1}');
    expect(store.list()).toEqual([]);
  });

  /** Puede venir de una version anterior del formato o de edicion manual. */
  it('descarta las entradas que no calzan y conserva las validas', () => {
    store.add(BASE);
    const validas = JSON.parse(storage.getItem(HISTORY_KEY)!);
    storage.setItem(
      HISTORY_KEY,
      JSON.stringify([{ basura: true }, ...validas, null, 'texto']),
    );

    expect(store.list()).toHaveLength(1);
  });
});

/**
 * En modo privado de Safari, con la cuota llena o con cookies bloqueadas,
 * `localStorage` lanza. El comparador tiene que seguir funcionando. Spec 4.8.
 */
describe('almacenamiento no disponible', () => {
  it('funciona sin almacenamiento', () => {
    const sin = new HistoryStore(null);

    expect(sin.available).toBe(false);
    expect(sin.list()).toEqual([]);
    expect(() => sin.add(BASE)).not.toThrow();
    expect(() => sin.clear()).not.toThrow();
    expect(sin.list()).toEqual([]);
  });

  it('no lanza si la lectura falla', () => {
    const roto = new HistoryStore(
      fakeStorage({
        getItem: () => {
          throw new Error('bloqueado');
        },
      }),
    );

    expect(roto.available).toBe(false);
    expect(roto.list()).toEqual([]);
  });

  it('no lanza si la escritura falla por cuota', () => {
    const lleno = new HistoryStore(
      fakeStorage({
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
      }),
    );

    expect(() => lleno.add(BASE)).not.toThrow();
  });

  it('no lanza si borrar falla', () => {
    const roto = new HistoryStore(
      fakeStorage({
        removeItem: () => {
          throw new Error('bloqueado');
        },
      }),
    );

    expect(() => roto.clear()).not.toThrow();
  });
});

describe('safeLocalStorage', () => {
  it('devuelve null cuando no hay window', () => {
    expect(safeLocalStorage(undefined)).toBeNull();
  });

  it('devuelve null cuando acceder lanza', () => {
    const win = {
      get localStorage(): Storage {
        throw new Error('bloqueado por politica');
      },
    } as unknown as Window;

    expect(safeLocalStorage(win)).toBeNull();
  });

  /** Algunos navegadores solo fallan al escribir, no al leer la propiedad. */
  it('devuelve null cuando existe pero no deja escribir', () => {
    const win = {
      localStorage: fakeStorage({
        setItem: () => {
          throw new Error('QuotaExceededError');
        },
      }),
    } as unknown as Window;

    expect(safeLocalStorage(win)).toBeNull();
  });

  it('devuelve el almacenamiento cuando funciona', () => {
    const ls = fakeStorage();
    const win = { localStorage: ls } as unknown as Window;

    expect(safeLocalStorage(win)).toBe(ls);
  });

  it('no deja residuos de la prueba de escritura', () => {
    const ls = fakeStorage();
    safeLocalStorage({ localStorage: ls } as unknown as Window);

    expect(ls.length).toBe(0);
  });
});

/**
 * Sin esta regla el historial guarda estados de transito: al pasar de
 * "10 lb, $250" a "2 lb, $600" queda registrado el intermedio "2 lb, $250",
 * que el usuario nunca cotizo. En una prueba real, tres cotizaciones
 * produjeron ocho entradas.
 */
describe('reemplazo dentro de la ventana de ajuste', () => {
  let ajustable: HistoryStore;
  const VENTANA = 120_000;

  beforeEach(() => {
    ajustable = new HistoryStore(storage, {
      now: () => clock,
      supersedeWithinMs: VENTANA,
    });
  });

  it('sustituye la entrada anterior si el cambio es inmediato', () => {
    ajustable.add(BASE);
    clock += 500;
    ajustable.add({ ...BASE, weightLb: 2 });
    clock += 500;
    ajustable.add({ ...BASE, weightLb: 2, declaredValueUsd: 600 });

    const list = ajustable.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.weightLb).toBe(2);
    expect(list[0]?.declaredValueUsd).toBe(600);
  });

  it('conserva ambas cuando pasa mas que la ventana', () => {
    ajustable.add(BASE);
    clock += VENTANA + 1;
    ajustable.add({ ...BASE, weightLb: 2 });

    expect(ajustable.list()).toHaveLength(2);
  });

  it('el limite de la ventana no reemplaza', () => {
    ajustable.add(BASE);
    clock += VENTANA;
    ajustable.add({ ...BASE, weightLb: 2 });

    expect(ajustable.list()).toHaveLength(2);
  });

  it('solo colapsa contra la mas reciente, no contra todo el historial', () => {
    ajustable.add(BASE);
    clock += VENTANA + 1;
    ajustable.add({ ...BASE, weightLb: 2 });
    clock += 100;
    ajustable.add({ ...BASE, weightLb: 3 });

    // La primera sobrevive; la segunda fue reemplazada por la tercera.
    expect(ajustable.list().map((e) => e.weightLb)).toEqual([3, 10]);
  });

  it('volver a una cotizacion vieja no borra la que se estaba ajustando', () => {
    ajustable.add(BASE);
    clock += VENTANA + 1;
    ajustable.add({ ...BASE, weightLb: 50 });
    clock += 100;
    // Recargar la primera: mismo id, asi que sube en vez de duplicarse, y no
    // debe eliminar la de 50 lb por estar dentro de la ventana.
    ajustable.add(BASE);

    expect(ajustable.list().map((e) => e.weightLb).sort((a, b) => a - b)).toEqual([
      10, 50,
    ]);
  });
});
