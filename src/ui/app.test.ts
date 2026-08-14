// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { initApp, type AppHandle, type AppOptions } from './app.js';
import type { QuickboxFetch } from '../engine/providers/quickbox.js';

/**
 * Pruebas de integracion del cableado de la pagina.
 *
 * Existen porque el bug "cambio la categoria y la cotizacion no se actualiza"
 * no lo detectaba ninguna prueba: el motor, el render y el combobox estaban
 * cubiertos por separado, pero nadie probaba los tres juntos.
 *
 * El markup replica el de `index.astro`. Si divergen, estas pruebas dejan de
 * representar la pagina real.
 */

const MARKUP = `
  <form id="formulario">
    <input id="peso" type="number" />
    <input id="valor" type="number" />
    <div class="combo">
      <input id="categoria" role="combobox" aria-expanded="false" />
      <button id="categoria-limpiar" hidden></button>
      <ul id="categoria-lista" role="listbox" hidden></ul>
    </div>
    <p id="categoria-hint"></p>
  </form>
  <section id="resultados"></section>
  <section id="historial"></section>
`;

let app: AppHandle;

function results(): string {
  return document.getElementById('resultados')!.innerHTML;
}

function setNumber(id: string, value: string) {
  const input = document.getElementById(id) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Elige una categoria como lo haria el usuario: escribir y hacer clic. */
function pickCategory(query: string, categoryId: string) {
  const input = document.getElementById('categoria') as HTMLInputElement;
  const list = document.getElementById('categoria-lista') as HTMLUListElement;

  input.value = query;
  input.dispatchEvent(new Event('input', { bubbles: true }));

  const option = [...list.querySelectorAll('li')].find(
    (li) => li.dataset.id === categoryId,
  );
  if (!option) throw new Error(`no aparecio la categoria ${categoryId}`);
  option.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
}

/** Totales en el orden en que se muestran. */
function totals(): string[] {
  return [...results().matchAll(/class="offer__total">([^<]+)</g)].map((m) => m[1]!);
}

beforeEach(() => {
  // jsdom comparte `window` entre pruebas del archivo, asi que el query string
  // que deja `replaceState` sobrevive. Sin esto, cada prueba hidrataria el
  // formulario con la cotizacion de la anterior.
  window.history.replaceState(null, '', '/');
  document.body.innerHTML = MARKUP;
  // fetchImpl: null desactiva la consulta en vivo a Quickbox: estas pruebas
  // cubren el cableado local y no deben salir a la red.
  app = initApp({
    debounceMs: 0,
    historyDebounceMs: 0,
    storage: null,
    fetchImpl: null,
  });
});

describe('estado inicial', () => {
  it('pide el peso antes que nada', () => {
    expect(results()).toContain('peso');
  });

  it('cotiza en cuanto hay peso y valor', () => {
    setNumber('peso', '10');
    setNumber('valor', '250');

    expect(results()).toContain('opciones');
    expect(totals().length).toBeGreaterThan(0);
  });
});

describe('cambio de categoria', () => {
  /**
   * El bug reportado. Sobre $300 el arancel depende de la categoria, asi que
   * cambiarla tiene que mover los totales.
   */
  it('recotiza al elegir una categoria', () => {
    setNumber('peso', '2');
    setNumber('valor', '600');

    // Sin categoria, sobre el umbral, nadie cotiza.
    expect(results()).toContain('Elegí la categoría');

    pickCategory('audifonos', 'audifonos');

    expect(results()).not.toContain('Elegí la categoría');
    expect(totals().length).toBeGreaterThan(0);
  });

  it('recotiza al cambiar de una categoria a otra', () => {
    setNumber('peso', '2');
    setNumber('valor', '600');

    pickCategory('audifonos', 'audifonos');
    const conAudifonos = totals();

    pickCategory('ropa', 'ropa');
    const conRopa = totals();

    // Audifonos es 15% en Shop USA y 0% en Buyex; ropa es 15% en ambos.
    expect(conRopa).not.toEqual(conAudifonos);
  });

  it('recotiza al limpiar la categoria', () => {
    setNumber('peso', '2');
    setNumber('valor', '600');
    pickCategory('ropa', 'ropa');
    expect(totals().length).toBeGreaterThan(0);

    const limpiar = document.getElementById('categoria-limpiar') as HTMLButtonElement;
    limpiar.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(results()).toContain('Elegí la categoría');
  });

  it('mantiene la categoria al cambiar peso o valor', () => {
    setNumber('peso', '2');
    setNumber('valor', '600');
    pickCategory('ropa', 'ropa');
    const antes = totals();

    setNumber('peso', '12');
    const despues = totals();

    expect(despues).not.toEqual(antes);
    expect(results()).not.toContain('Elegí la categoría');
    expect(app.combobox.categoryId).toBe('ropa');
  });

  /**
   * Bajo $300 ningun proveedor cobra DAI, asi que cambiar la categoria no mueve
   * los totales. Es correcto, pero sin señales se ve igual que un bug. Los dos
   * tests siguientes fijan las señales que lo distinguen.
   */
  it('bajo el umbral los totales no cambian con la categoria', () => {
    setNumber('peso', '10');
    setNumber('valor', '150');

    pickCategory('ropa', 'ropa');
    const conRopa = totals();

    pickCategory('audifonos', 'audifonos');
    const conAudifonos = totals();

    expect(conAudifonos).toEqual(conRopa);
  });

  it('confirma en los resultados la categoria aplicada', () => {
    setNumber('peso', '10');
    setNumber('valor', '150');
    pickCategory('ropa', 'ropa');

    expect(results()).toContain('results__applied');
    expect(results()).toContain('Ropa');
  });

  it('avisa que bajo el umbral la categoria no mueve el total', () => {
    setNumber('peso', '10');
    setNumber('valor', '150');
    pickCategory('ropa', 'ropa');

    expect(results()).toContain('no afecta el total');
  });

  it('no muestra ese aviso sobre el umbral', () => {
    setNumber('peso', '10');
    setNumber('valor', '600');
    pickCategory('ropa', 'ropa');

    expect(results()).toContain('results__applied');
    expect(results()).not.toContain('no afecta el total');
  });
});

describe('ayuda contextual de la categoria', () => {
  function hint(): string {
    return document.getElementById('categoria-hint')!.textContent ?? '';
  }

  it('explica que no influye bajo el umbral', () => {
    setNumber('peso', '10');
    setNumber('valor', '100');

    expect(hint()).toContain('no cambia el total');
  });

  it('explica que es obligatoria sobre el umbral', () => {
    setNumber('peso', '10');
    setNumber('valor', '600');

    expect(hint()).toContain('Define el arancel');
  });

  it('sin valor, describe el catalogo', () => {
    expect(hint()).toContain('categorías');
  });
});

describe('escribir la categoria sin elegirla de la lista', () => {
  function typeCategory(value: string) {
    const input = document.getElementById('categoria') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('blur'));
  }

  /**
   * Escribir el nombre exacto y salir del campo tiene que aplicar la categoria.
   * Antes se descartaba en silencio y el usuario perdia el trabajo.
   */
  it('acepta el nombre exacto de una categoria', () => {
    setNumber('peso', '2');
    setNumber('valor', '600');

    typeCategory('Ropa');

    expect(app.combobox.categoryId).toBe('ropa');
    expect(results()).not.toContain('Elegí la categoría');
  });

  it('acepta tambien un alias exacto', () => {
    setNumber('peso', '2');
    setNumber('valor', '600');

    typeCategory('iphone');

    expect(app.combobox.categoryId).toBe('celulares-tablets');
  });

  it('ignora mayusculas y acentos', () => {
    setNumber('peso', '2');
    setNumber('valor', '600');

    typeCategory('CAMARAS Y LENTES FOTOGRAFICOS');

    expect(app.combobox.categoryId).toBe('camaras');
  });

  it('descarta texto que no identifica ninguna categoria', () => {
    setNumber('peso', '2');
    setNumber('valor', '600');

    typeCategory('algo que no existe');

    expect(app.combobox.categoryId).toBeNull();
    expect(
      (document.getElementById('categoria') as HTMLInputElement).value,
    ).toBe('');
  });

  it('descarta un texto parcial que no es nombre completo', () => {
    setNumber('peso', '2');
    setNumber('valor', '600');

    typeCategory('rop');

    expect(app.combobox.categoryId).toBeNull();
  });
});

describe('recalculo por peso y valor', () => {
  it('recotiza al cambiar el peso', () => {
    setNumber('peso', '10');
    setNumber('valor', '250');
    const antes = totals();

    setNumber('peso', '20');

    expect(totals()).not.toEqual(antes);
  });

  it('habilita el maritimo de Buyex al superar 8 lb', () => {
    setNumber('peso', '5');
    setNumber('valor', '250');
    expect(results()).toContain('offer--unavailable');

    setNumber('peso', '10');
    expect(results()).not.toContain('offer--unavailable');
  });

  it('vuelve al estado inicial si se borra el peso', () => {
    setNumber('peso', '10');
    setNumber('valor', '250');
    setNumber('peso', '');

    expect(results()).toContain('class="empty"');
  });
});

describe('robustez del montaje', () => {
  it('falla ruidosamente si falta un elemento del markup', () => {
    document.body.innerHTML = '<form id="formulario"></form>';
    expect(() =>
      initApp({ debounceMs: 0, storage: null, fetchImpl: null }),
    ).toThrow(/Falta el elemento/);
  });
});

// ---------------------------------------------------------------------------
// Fase 5: URL compartible e historial local
// ---------------------------------------------------------------------------

/** localStorage en memoria para las pruebas de integracion. */
function memoryStorage(): Storage {
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
  } as Storage;
}

function mount(opts: AppOptions = {}) {
  document.body.innerHTML = MARKUP;
  return initApp({
    debounceMs: 0,
    historyDebounceMs: 0,
    storage: null,
    fetchImpl: null,
    ...opts,
  });
}

function historyHtml(): string {
  return document.getElementById('historial')!.innerHTML;
}

describe('serializacion en la URL', () => {
  it('refleja la cotizacion en el query string', () => {
    setNumber('peso', '5.5');
    setNumber('valor', '250');
    pickCategory('ropa', 'ropa');

    expect(window.location.search).toBe('?w=5.5&v=250&c=ropa');
  });

  it('no deja un "?" suelto cuando no hay nada que compartir', () => {
    app.render();
    expect(window.location.search).toBe('');
  });

  /**
   * `replaceState` y no `pushState`: con pushState cada tecleo agregaria una
   * entrada al historial del navegador y el boton Atras dejaria de servir para
   * salir de la pagina.
   */
  it('no acumula entradas en el historial del navegador', () => {
    const antes = window.history.length;

    setNumber('peso', '1');
    setNumber('peso', '2');
    setNumber('peso', '3');

    expect(window.history.length).toBe(antes);
  });

  it('hidrata el formulario desde la URL al cargar', () => {
    window.history.replaceState(null, '', '/?w=12&v=800&c=camaras');
    const handle = mount();

    expect((document.getElementById('peso') as HTMLInputElement).value).toBe('12');
    expect((document.getElementById('valor') as HTMLInputElement).value).toBe('800');
    expect(handle.combobox.categoryId).toBe('camaras');
    expect(totals().length).toBeGreaterThan(0);
  });

  it('reproduce los mismos resultados que la sesion original', () => {
    setNumber('peso', '12');
    setNumber('valor', '800');
    pickCategory('camaras', 'camaras');
    const original = totals();

    const compartida = window.location.search;
    window.history.replaceState(null, '', `/${compartida}`);
    mount();

    expect(totals()).toEqual(original);
  });

  it('ignora una categoria inexistente en el enlace', () => {
    window.history.replaceState(null, '', '/?w=10&v=100&c=inventada');
    const handle = mount();

    expect(handle.combobox.categoryId).toBeNull();
    expect(totals().length).toBeGreaterThan(0);
  });

  it('aplica los parametros validos aunque otros vengan corruptos', () => {
    window.history.replaceState(null, '', '/?w=abc&v=250&c=ropa');
    mount();

    expect((document.getElementById('peso') as HTMLInputElement).value).toBe('');
    expect((document.getElementById('valor') as HTMLInputElement).value).toBe('250');
    expect(results()).toContain('peso');
  });
});

describe('historial local', () => {
  let storage: Storage;
  let clock: number;

  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    storage = memoryStorage();
    clock = 1_700_000_000_000;
    // Sin ventana de reemplazo, para poder verificar entradas por separado.
    app = mount({ storage, now: () => clock, supersedeWithinMs: 0 });
  });

  it('guarda la cotizacion una vez que hay resultados', () => {
    setNumber('peso', '10');
    setNumber('valor', '250');

    expect(app.history.list()).toHaveLength(1);
    expect(historyHtml()).toContain('Cotizaciones anteriores');
  });

  it('muestra el proveedor mas barato de cada entrada', () => {
    setNumber('peso', '10');
    setNumber('valor', '250');

    const [entry] = app.history.list();
    expect(entry?.cheapest.providerName).toBe('Buyex');
    expect(historyHtml()).toContain('Buyex');
  });

  it('no guarda cotizaciones sin resultados', () => {
    setNumber('peso', '2');
    setNumber('valor', '600');

    expect(results()).toContain('Elegí la categoría');
    expect(app.history.list()).toHaveLength(0);
    expect(historyHtml()).toBe('');
  });

  it('no duplica la misma cotizacion', () => {
    setNumber('peso', '10');
    setNumber('valor', '250');
    setNumber('peso', '20');
    clock += 1000;
    setNumber('peso', '10');

    expect(app.history.list()).toHaveLength(2);
  });

  it('recarga una entrada al hacer clic', () => {
    setNumber('peso', '10');
    setNumber('valor', '250');
    pickCategory('ropa', 'ropa');
    const original = totals();

    clock += 1000;
    setNumber('peso', '3');
    setNumber('valor', '50');
    expect(totals()).not.toEqual(original);

    const anterior = [...document.querySelectorAll('#historial [data-id]')].find(
      (b) => (b as HTMLElement).dataset.id?.startsWith('10|250'),
    )!;
    anterior.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect((document.getElementById('peso') as HTMLInputElement).value).toBe('10');
    expect(app.combobox.categoryId).toBe('ropa');
    expect(totals()).toEqual(original);
  });

  it('quita una entrada concreta', () => {
    setNumber('peso', '10');
    setNumber('valor', '250');
    clock += 1000;
    setNumber('peso', '20');
    expect(app.history.list()).toHaveLength(2);

    const quitar = document.querySelector('#historial [data-remove]')!;
    quitar.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(app.history.list()).toHaveLength(1);
  });

  it('borra todo el historial', () => {
    setNumber('peso', '10');
    setNumber('valor', '250');

    document
      .getElementById('historial-limpiar')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(app.history.list()).toHaveLength(0);
    expect(historyHtml()).toBe('');
  });

  it('sobrevive a la recarga de la pagina', () => {
    setNumber('peso', '10');
    setNumber('valor', '250');

    window.history.replaceState(null, '', '/');
    const recargada = mount({ storage, now: () => clock, supersedeWithinMs: 0 });

    expect(recargada.history.list()).toHaveLength(1);
    expect(historyHtml()).toContain('Cotizaciones anteriores');
  });

  /** Spec 4.8: sin almacenamiento el comparador sigue funcionando. */
  it('funciona sin localStorage disponible', () => {
    const sinStorage = mount({ storage: null });

    setNumber('peso', '10');
    setNumber('valor', '250');

    expect(totals().length).toBeGreaterThan(0);
    expect(sinStorage.history.list()).toEqual([]);
    expect(historyHtml()).toBe('');
  });

  it('no rompe si el almacenamiento falla al escribir', () => {
    const roto = {
      ...memoryStorage(),
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    } as unknown as Storage;
    mount({ storage: roto });

    expect(() => {
      setNumber('peso', '10');
      setNumber('valor', '250');
    }).not.toThrow();
    expect(totals().length).toBeGreaterThan(0);
  });
});

/**
 * Sin esta regla, ajustar el formulario campo por campo dejaba en el historial
 * estados que el usuario nunca cotizo. Medido en una corrida real: tres
 * cotizaciones producian ocho entradas.
 */
describe('el historial guarda cotizaciones, no pulsaciones', () => {
  let storage: Storage;
  let clock: number;

  beforeEach(() => {
    window.history.replaceState(null, '', '/');
    storage = memoryStorage();
    clock = 1_700_000_000_000;
    app = mount({ storage, now: () => clock });
  });

  it('colapsa el ajuste de una misma cotizacion en una sola entrada', () => {
    setNumber('peso', '10');
    clock += 1500;
    setNumber('valor', '250');
    clock += 2000;
    pickCategory('ropa', 'ropa');
    clock += 3000;
    setNumber('peso', '2');
    clock += 1500;
    setNumber('valor', '600');

    const list = app.history.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.weightLb).toBe(2);
    expect(list[0]?.declaredValueUsd).toBe(600);
  });

  it('separa cotizaciones hechas en momentos distintos', () => {
    setNumber('peso', '10');
    setNumber('valor', '250');

    clock += 10 * 60 * 1000;
    setNumber('peso', '25');
    setNumber('valor', '1200');

    expect(app.history.list()).toHaveLength(2);
  });

  it('recargar una entrada vieja no borra la que se estaba armando', () => {
    setNumber('peso', '10');
    setNumber('valor', '250');

    clock += 10 * 60 * 1000;
    setNumber('peso', '25');
    setNumber('valor', '1200');
    expect(app.history.list()).toHaveLength(2);

    clock += 1000;
    const vieja = [...document.querySelectorAll('#historial [data-id]')].find(
      (b) => (b as HTMLElement).dataset.id?.startsWith('10|250'),
    )!;
    vieja.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(app.history.list()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Fase 4: Quickbox en vivo, render en dos fases
// ---------------------------------------------------------------------------

const RESPUESTA_QUICKBOX = {
  result: true,
  records: {
    peso: '10.00',
    costo_libra: '3.30',
    servicios: [
      { tipo_gasto: 2, nombre: 'Flete Quickbox', valor_numerico: 37.29 },
      { tipo_gasto: 4, nombre: 'Gestión aeropuerto', valor_numerico: 16.95 },
    ],
    impuestos: [
      { tipo_gasto: 9, nombre: 'DAI', valor_numerico: 0 },
      { tipo_gasto: 10, nombre: 'IVA - CIF', valor_numerico: 34.06 },
    ],
    total_impuestos: '34.06',
    total_dolares: '88.30',
    descripcion_arancel: 'Ropa 15%',
    tasa_impuesto: '13%',
  },
};

function quickboxStub(payload: unknown = RESPUESTA_QUICKBOX, ok = true) {
  const fn = vi.fn(async () => ({
    ok,
    status: ok ? 200 : 503,
    json: async () => payload,
  }));
  return fn as unknown as QuickboxFetch & typeof fn;
}

describe('Quickbox en vivo', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/');
  });

  it('pinta lo local de inmediato y Quickbox como pendiente', () => {
    const stub = quickboxStub();
    app = mount({ fetchImpl: stub });

    setNumber('peso', '10');
    setNumber('valor', '250');

    // Sin esperar la promesa: los dos locales ya estan.
    expect(totals().length).toBeGreaterThan(0);
    expect(results()).toContain('offer--pending');
    expect(results()).toContain('Consultando');
  });

  it('inserta la oferta de Quickbox al llegar la respuesta', async () => {
    app = mount({ fetchImpl: quickboxStub() });

    setNumber('peso', '10');
    setNumber('valor', '250');
    await app.settled();

    expect(results()).not.toContain('offer--pending');
    expect(results()).toContain('Quickbox');
    expect(results()).toContain('$88.30');
  });

  it('ubica a Quickbox en el orden por precio', async () => {
    app = mount({ fetchImpl: quickboxStub() });

    setNumber('peso', '10');
    setNumber('valor', '250');
    await app.settled();

    const montos = totals().map((t) => Number(t.replace(/[$,]/g, '')));
    expect(montos).toEqual([...montos].sort((a, b) => a - b));
    expect(montos).toContain(88.3);
  });

  /** Depender de un tercero implica que va a fallar; los otros dos siguen. */
  it('si su API falla, los otros dos igual se comparan', async () => {
    app = mount({ fetchImpl: quickboxStub({}, false) });

    setNumber('peso', '10');
    setNumber('valor', '250');
    await app.settled();

    expect(totals().length).toBe(3);
    expect(results()).toContain('offer--unavailable');
    expect(results()).toContain('Los demás proveedores');
  });

  it('no deja la tarjeta cargando para siempre si falla', async () => {
    app = mount({ fetchImpl: quickboxStub({}, false) });

    setNumber('peso', '10');
    setNumber('valor', '250');
    await app.settled();

    expect(results()).not.toContain('offer--pending');
  });

  it('no consulta si la entrada esta incompleta', () => {
    const stub = quickboxStub();
    app = mount({ fetchImpl: stub });

    setNumber('peso', '10');

    expect(stub).not.toHaveBeenCalled();
  });

  it('no consulta cuando la consulta en vivo esta desactivada', () => {
    const stub = quickboxStub();
    app = mount({ fetchImpl: null });

    setNumber('peso', '10');
    setNumber('valor', '250');

    expect(stub).not.toHaveBeenCalled();
    expect(results()).not.toContain('offer--pending');
  });

  it('reutiliza la cache para una cotizacion repetida', async () => {
    const stub = quickboxStub();
    const storage = memoryStorage();
    app = mount({ fetchImpl: stub, storage });

    setNumber('peso', '10');
    setNumber('valor', '250');
    await app.settled();

    setNumber('peso', '5');
    await app.settled();
    setNumber('peso', '10');
    await app.settled();

    // Dos pesos distintos por dos planes: cuatro consultas. La repetida sale
    // entera de cache.
    expect(stub).toHaveBeenCalledTimes(4);
  });

  /**
   * Si el usuario sigue escribiendo, la respuesta de la entrada anterior ya no
   * corresponde a lo que esta viendo y no debe pintarse.
   */
  it('descarta la respuesta de una consulta que el usuario dejo atras', async () => {
    let resolverPrimera: ((v: unknown) => void) | undefined;
    let llamadas = 0;

    const stub = vi.fn(async () => {
      llamadas++;
      if (llamadas === 1) {
        await new Promise((r) => {
          resolverPrimera = r;
        });
        return { ok: true, status: 200, json: async () => RESPUESTA_QUICKBOX };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ...RESPUESTA_QUICKBOX,
          records: { ...RESPUESTA_QUICKBOX.records, total_dolares: '150.00' },
        }),
      };
    });

    app = mount({
      fetchImpl: stub as unknown as QuickboxFetch,
    });

    setNumber('peso', '10');
    setNumber('valor', '250');
    // Segunda consulta antes de que responda la primera. Ambos valores quedan
    // bajo el umbral para que no entre en juego la exigencia de categoria.
    setNumber('valor', '260');
    resolverPrimera?.({});
    await app.settled();

    // Gana la ultima, no la que respondio despues.
    expect(results()).toContain('$150.00');
    expect(results()).not.toContain('$88.30');
  });

  it('guarda en el historial el mas barato incluyendo a Quickbox', async () => {
    const storage = memoryStorage();
    app = mount({
      fetchImpl: quickboxStub({
        ...RESPUESTA_QUICKBOX,
        records: { ...RESPUESTA_QUICKBOX.records, total_dolares: '10.00' },
      }),
      storage,
    });

    setNumber('peso', '10');
    setNumber('valor', '250');
    await app.settled();

    expect(app.history.list()[0]?.cheapest.providerName).toBe(
      'Quickbox Estándar',
    );
  });
});
