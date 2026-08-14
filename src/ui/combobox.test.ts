// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { catalog } from '../data/index.js';
import { CategoryCombobox } from './combobox.js';

/**
 * El combobox es la interaccion mas delicada de la interfaz y la que no se
 * puede validar leyendo el codigo. Se prueba con jsdom.
 */

let input: HTMLInputElement;
let list: HTMLUListElement;
let clearButton: HTMLButtonElement;
let combobox: CategoryCombobox;
let changes: Array<string | null>;

function setup() {
  document.body.innerHTML = `
    <div class="combo">
      <input id="categoria" role="combobox" aria-expanded="false" />
      <button id="limpiar" hidden></button>
      <ul id="lista" role="listbox" hidden></ul>
    </div>
  `;

  input = document.getElementById('categoria') as HTMLInputElement;
  list = document.getElementById('lista') as HTMLUListElement;
  clearButton = document.getElementById('limpiar') as HTMLButtonElement;
  changes = [];

  combobox = new CategoryCombobox(
    { input, list, clearButton },
    { catalog, onChange: (id) => changes.push(id) },
  );
}

function type(value: string) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

function key(k: string) {
  const event = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
  input.dispatchEvent(event);
  return event;
}

function options() {
  return [...list.querySelectorAll('li')];
}

beforeEach(setup);

describe('apertura y filtrado', () => {
  /**
   * Sin tope: truncar la lista dejaria categorias inalcanzables sin que el
   * usuario se entere. Esta prueba existe porque un tope de 50 escondia 4 de
   * las 54 categorias.
   */
  it('abre con todo el catalogo al enfocar vacio, sin truncar', () => {
    input.dispatchEvent(new Event('focus'));

    expect(list.hidden).toBe(false);
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(options()).toHaveLength(catalog.categories.length);
  });

  it('filtra por etiqueta', () => {
    type('laptop');
    expect(options().some((li) => li.textContent?.includes('Laptops'))).toBe(true);
  });

  it('filtra por alias', () => {
    type('iphone');
    expect(options().some((li) => li.dataset.id === 'celulares-tablets')).toBe(true);
  });

  it('ignora acentos', () => {
    type('camara');
    expect(options().some((li) => li.dataset.id === 'camaras')).toBe(true);
  });

  it('cierra la lista cuando nada coincide', () => {
    type('zzzzzz');
    expect(list.hidden).toBe(true);
  });
});

describe('navegacion con teclado', () => {
  it('recorre las opciones con flechas y expone aria-activedescendant', () => {
    type('laptop');
    key('ArrowDown');

    expect(input.getAttribute('aria-activedescendant')).toBe('cat-opt-0');
    expect(options()[0]?.classList.contains('is-active')).toBe(true);
  });

  it('cicla al llegar al final', () => {
    type('lente');
    const total = options().length;
    // Se parte de "ninguna activa", asi que hacen falta total + 1 pulsaciones
    // para volver a la primera.
    for (let i = 0; i < total + 1; i++) key('ArrowDown');

    expect(input.getAttribute('aria-activedescendant')).toBe('cat-opt-0');
  });

  it('ArrowUp sin opcion activa va a la ultima, no a la penultima', () => {
    type('lente');
    const total = options().length;
    expect(total).toBeGreaterThan(2);
    key('ArrowUp');

    expect(input.getAttribute('aria-activedescendant')).toBe(`cat-opt-${total - 1}`);
  });

  it('ArrowUp desde la primera cicla a la ultima', () => {
    type('lente');
    const total = options().length;
    key('ArrowDown');
    key('ArrowUp');

    expect(input.getAttribute('aria-activedescendant')).toBe(`cat-opt-${total - 1}`);
  });

  it('Enter selecciona la opcion activa', () => {
    type('laptop');
    key('ArrowDown');
    key('Enter');

    expect(combobox.categoryId).toBe('laptops-computadoras');
    expect(input.value).toBe('Laptops y computadoras');
    expect(list.hidden).toBe(true);
    expect(changes.at(-1)).toBe('laptops-computadoras');
  });

  it('Enter sin opcion activa no selecciona nada', () => {
    type('laptop');
    const event = key('Enter');

    expect(combobox.categoryId).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });

  it('Escape cierra sin seleccionar', () => {
    type('laptop');
    key('Escape');

    expect(list.hidden).toBe(true);
    expect(combobox.categoryId).toBeNull();
  });

  it('ArrowDown reabre la lista cerrada', () => {
    type('laptop');
    key('Escape');
    key('ArrowDown');

    expect(list.hidden).toBe(false);
  });

  it('previene el scroll de la pagina al navegar', () => {
    type('laptop');
    expect(key('ArrowDown').defaultPrevented).toBe(true);
  });
});

describe('seleccion con mouse', () => {
  it('selecciona con mousedown, no con click', () => {
    type('libro');
    const option = options().find((li) => li.dataset.id === 'libros');
    option?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));

    expect(combobox.categoryId).toBe('libros');
    expect(input.value).toBe('Libros');
  });
});

describe('limpieza y estado', () => {
  it('muestra el boton de limpiar solo cuando hay texto', () => {
    expect(clearButton.hidden).toBe(true);
    type('ropa');
    expect(clearButton.hidden).toBe(false);
  });

  it('el boton de limpiar borra texto y seleccion', () => {
    type('ropa');
    key('ArrowDown');
    key('Enter');
    expect(combobox.categoryId).toBe('ropa');

    clearButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(combobox.categoryId).toBeNull();
    expect(input.value).toBe('');
    expect(clearButton.hidden).toBe(true);
    expect(changes.at(-1)).toBeNull();
  });

  it('escribir invalida la seleccion previa', () => {
    type('ropa');
    key('ArrowDown');
    key('Enter');
    expect(combobox.categoryId).toBe('ropa');

    type('rop');
    expect(combobox.categoryId).toBeNull();
  });

  it('descarta al salir el texto que no identifica ninguna categoria', () => {
    type('lapt');
    input.dispatchEvent(new Event('blur'));

    expect(input.value).toBe('');
    expect(combobox.categoryId).toBeNull();
  });

  /**
   * Escribir el nombre completo y salir sin hacer clic en la lista es un flujo
   * natural. Descartarlo obligaba a repetir la busqueda sin motivo.
   */
  it('acepta al salir el texto que coincide exactamente con una categoria', () => {
    type('Libros');
    input.dispatchEvent(new Event('blur'));

    expect(combobox.categoryId).toBe('libros');
    expect(input.value).toBe('Libros');
    expect(clearButton.hidden).toBe(false);
  });

  it('acepta al salir un alias exacto', () => {
    type('macbook');
    input.dispatchEvent(new Event('blur'));

    expect(combobox.categoryId).toBe('laptops-computadoras');
    // Se normaliza a la etiqueta oficial, no al alias escrito.
    expect(input.value).toBe('Laptops y computadoras');
  });

  it('conserva la etiqueta al salir si hay seleccion valida', () => {
    type('laptop');
    key('ArrowDown');
    key('Enter');
    input.dispatchEvent(new Event('blur'));

    expect(input.value).toBe('Laptops y computadoras');
    expect(combobox.categoryId).toBe('laptops-computadoras');
  });

  it('no notifica cambios redundantes', () => {
    type('rop');
    type('ropa');

    expect(changes).toHaveLength(0);
  });

  it('marca aria-selected en la opcion elegida al reabrir', () => {
    type('libro');
    key('ArrowDown');
    key('Enter');
    input.dispatchEvent(new Event('focus'));

    const elegida = options().find((li) => li.dataset.id === 'libros');
    expect(elegida?.getAttribute('aria-selected')).toBe('true');
  });
});

describe('seguridad', () => {
  it('escapa las etiquetas del catalogo al construir la lista', () => {
    const hostil = {
      ...catalog,
      categories: [
        {
          id: 'x',
          label: '<img src=x onerror=alert(1)>',
          aliases: ['x'],
          mappings: { shopusa: null, buyex: null, quickbox: null },
        },
      ],
    };

    document.body.innerHTML = `
      <input id="i" /><button id="b" hidden></button><ul id="l" hidden></ul>
    `;
    const i = document.getElementById('i') as HTMLInputElement;
    const l = document.getElementById('l') as HTMLUListElement;
    const b = document.getElementById('b') as HTMLButtonElement;

    const combo = new CategoryCombobox(
      { input: i, list: l, clearButton: b },
      { catalog: hostil, onChange: vi.fn() },
    );
    combo.open('');

    expect(l.querySelector('img')).toBeNull();
    expect(l.textContent).toContain('<img');
  });
});
