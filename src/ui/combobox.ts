/**
 * Combobox de categorias.
 *
 * Se implementa a mano en vez de con un `<select>` porque el catalogo tiene 54
 * entradas y la busqueda por alias es lo que hace usable la eleccion. Sigue el
 * patron ARIA de combobox con listbox: `aria-expanded`, `aria-activedescendant`
 * y navegacion con flechas, Enter y Escape.
 *
 * Vive separado de la pagina para poder probarlo con jsdom.
 */

import { findByExactLabel, searchCategories } from '../engine/catalog.js';
import type { Catalog, CatalogCategory } from '../engine/types.js';
import { escapeHtml } from './format.js';

export interface ComboboxElements {
  input: HTMLInputElement;
  list: HTMLUListElement;
  clearButton: HTMLButtonElement;
}

export interface ComboboxOptions {
  catalog: Catalog;
  /** Se invoca cada vez que cambia la categoria seleccionada. */
  onChange: (categoryId: string | null) => void;
}

export class CategoryCombobox {
  private readonly input: HTMLInputElement;
  private readonly list: HTMLUListElement;
  private readonly clearButton: HTMLButtonElement;
  private readonly catalog: Catalog;
  private readonly onChange: (categoryId: string | null) => void;

  private selectedId: string | null = null;
  private visible: CatalogCategory[] = [];
  private activeIndex = -1;

  constructor(elements: ComboboxElements, options: ComboboxOptions) {
    this.input = elements.input;
    this.list = elements.list;
    this.clearButton = elements.clearButton;
    this.catalog = options.catalog;
    this.onChange = options.onChange;

    this.bind();
  }

  get categoryId(): string | null {
    return this.selectedId;
  }

  get isOpen(): boolean {
    return !this.list.hidden;
  }

  private bind(): void {
    this.input.addEventListener('input', () => {
      // Escribir invalida la seleccion previa: el texto ya no la representa.
      this.setSelected(null);
      this.clearButton.hidden = this.input.value === '';
      this.open(this.input.value);
    });

    this.input.addEventListener('focus', () => this.open(this.input.value));

    this.input.addEventListener('keydown', (event) => this.onKeydown(event));

    // mousedown y no click: el blur del input cerraria la lista antes de que
    // el click llegue a dispararse.
    this.list.addEventListener('mousedown', (event) => {
      const li = (event.target as HTMLElement).closest('li');
      const id = li?.dataset.id;
      const chosen = this.visible.find((c) => c.id === id);
      if (chosen) {
        event.preventDefault();
        this.select(chosen);
      }
    });

    this.input.addEventListener('blur', () => {
      if (this.selectedId === null && this.input.value !== '') {
        // Si lo escrito identifica sin ambiguedad una categoria, se acepta.
        // Descartarlo obligaria a repetir la busqueda solo por no haber hecho
        // clic en la lista.
        const exact = findByExactLabel(this.catalog, this.input.value);
        if (exact) {
          this.select(exact);
          return;
        }

        // Texto que no corresponde a ninguna categoria si se limpia, para no
        // dar la impresion de que hay una elegida cuando no la hay.
        this.input.value = '';
        this.clearButton.hidden = true;
        this.onChange(null);
      }
      this.close();
    });

    this.clearButton.addEventListener('click', () => {
      this.clear();
      this.input.focus();
    });
  }

  private onKeydown(event: KeyboardEvent): void {
    if (!this.isOpen) {
      if (event.key === 'ArrowDown') this.open(this.input.value);
      return;
    }

    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        this.setActive((this.activeIndex + 1) % this.visible.length);
        break;
      case 'ArrowUp':
        event.preventDefault();
        // Sin opcion activa, subir lleva a la ultima. Sin este caso especial,
        // el modulo desde -1 aterriza en la penultima.
        this.setActive(
          this.activeIndex <= 0
            ? this.visible.length - 1
            : this.activeIndex - 1,
        );
        break;
      case 'Enter': {
        const chosen = this.visible[this.activeIndex];
        if (chosen) {
          event.preventDefault();
          this.select(chosen);
        }
        break;
      }
      case 'Escape':
        this.close();
        break;
    }
  }

  open(query: string): void {
    // Sin tope de opciones a proposito: truncar dejaria categorias inalcanzables
    // sin que el usuario lo note. La lista tiene scroll propio y 54 nodos no son
    // problema. Si el catalogo creciera a cientos, habria que paginar y decirlo.
    this.visible = searchCategories(this.catalog, query);

    if (this.visible.length === 0) {
      this.close();
      return;
    }

    this.list.innerHTML = this.visible
      .map(
        (c, i) =>
          `<li id="cat-opt-${i}" role="option" aria-selected="${
            c.id === this.selectedId
          }" data-id="${escapeHtml(c.id)}">${escapeHtml(c.label)}</li>`,
      )
      .join('');
    this.list.hidden = false;
    this.input.setAttribute('aria-expanded', 'true');
    this.setActive(-1);
  }

  close(): void {
    this.list.hidden = true;
    this.input.setAttribute('aria-expanded', 'false');
    this.input.removeAttribute('aria-activedescendant');
    this.activeIndex = -1;
  }

  clear(): void {
    this.input.value = '';
    this.clearButton.hidden = true;
    this.close();
    this.setSelected(null);
  }

  /**
   * Fija la categoria desde fuera: hidratacion desde la URL o recarga de una
   * entrada del historial. Un id desconocido limpia la seleccion en vez de
   * dejar el campo mostrando algo que no existe.
   */
  setCategoryById(id: string | null): void {
    if (id === null) {
      this.clear();
      return;
    }

    const category = this.catalog.categories.find((c) => c.id === id);
    if (!category) {
      this.clear();
      return;
    }

    this.select(category);
  }

  private select(category: CatalogCategory): void {
    this.input.value = category.label;
    this.clearButton.hidden = false;
    this.close();
    this.setSelected(category.id);
  }

  private setSelected(id: string | null): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.onChange(id);
  }

  private setActive(index: number): void {
    this.activeIndex = index;
    const items = [...this.list.querySelectorAll('li')];
    items.forEach((li, i) => li.classList.toggle('is-active', i === index));

    const active = items[index];
    if (index >= 0 && active) {
      this.input.setAttribute('aria-activedescendant', `cat-opt-${index}`);
      active.scrollIntoView?.({ block: 'nearest' });
    } else {
      this.input.removeAttribute('aria-activedescendant');
    }
  }
}
