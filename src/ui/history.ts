/**
 * Historial local de cotizaciones.
 *
 * Vive en `localStorage` y nunca sale del dispositivo. Ver spec 3.8.
 *
 * Toda operacion contra el almacenamiento va envuelta: en modo privado de
 * Safari, con la cuota llena o con cookies bloqueadas, `localStorage` lanza. El
 * comparador tiene que seguir funcionando sin historial en vez de romperse
 * entero por una funcion accesoria (spec 4.8).
 */

import type { ShippingMode } from '../engine/types.js';

export const HISTORY_KEY = 'sc:history';
export const HISTORY_MAX = 20;

export interface HistoryEntry {
  /** Derivado de los inputs: dos cotizaciones iguales comparten id. */
  id: string;
  weightLb: number;
  declaredValueUsd: number;
  categoryId: string | null;
  categoryLabel: string | null;
  /** Epoch en milisegundos. */
  savedAt: number;
  cheapest: {
    providerName: string;
    mode: ShippingMode;
    totalUsd: number;
  };
}

/**
 * Ventana dentro de la cual una cotizacion nueva reemplaza a la anterior en
 * vez de sumarse.
 *
 * Sin esto el historial guarda estados de transito: al pasar de "10 lb, $250"
 * a "2 lb, $600" queda registrado el instante intermedio "2 lb, $250", que el
 * usuario nunca cotizo. En una prueba real, tres cotizaciones produjeron ocho
 * entradas y llenaron el historial de ruido.
 *
 * Dos minutos separan "sigo ajustando lo mismo" de "vuelvo con otra compra".
 */
export const SUPERSEDE_WINDOW_MS = 2 * 60 * 1000;

export interface HistoryStoreOptions {
  max?: number;
  now?: () => number;
  /** 0 desactiva el reemplazo: toda cotizacion se suma como entrada nueva. */
  supersedeWithinMs?: number;
}

/** Dos cotizaciones con los mismos inputs son la misma entrada. */
export function entryId(input: {
  weightLb: number;
  declaredValueUsd: number;
  categoryId: string | null;
}): string {
  return `${input.weightLb}|${input.declaredValueUsd}|${input.categoryId ?? ''}`;
}

function isEntry(value: unknown): value is HistoryEntry {
  if (typeof value !== 'object' || value === null) return false;
  const e = value as Partial<HistoryEntry>;
  return (
    typeof e.id === 'string' &&
    typeof e.weightLb === 'number' &&
    typeof e.declaredValueUsd === 'number' &&
    typeof e.savedAt === 'number' &&
    typeof e.cheapest === 'object' &&
    e.cheapest !== null &&
    typeof e.cheapest.totalUsd === 'number'
  );
}

export class HistoryStore {
  private readonly storage: Storage | null;
  private readonly max: number;
  private readonly now: () => number;
  private readonly supersedeWithinMs: number;

  constructor(storage: Storage | null, options: HistoryStoreOptions = {}) {
    this.storage = storage;
    this.max = options.max ?? HISTORY_MAX;
    this.now = options.now ?? (() => Date.now());
    this.supersedeWithinMs = options.supersedeWithinMs ?? SUPERSEDE_WINDOW_MS;
  }

  /** `false` cuando el almacenamiento no esta disponible o no funciona. */
  get available(): boolean {
    return this.read() !== null;
  }

  list(): HistoryEntry[] {
    return this.read() ?? [];
  }

  /**
   * Agrega o refresca una entrada y devuelve el historial resultante.
   *
   * Dos reglas de colapso, por motivos distintos:
   *
   * 1. Una cotizacion repetida no se duplica: sube al tope con la fecha nueva.
   * 2. Una cotizacion hecha dentro de la ventana de reemplazo sustituye a la
   *    anterior, porque es la misma sesion de ajuste y los pasos intermedios
   *    no son cotizaciones que el usuario quiera conservar.
   */
  add(entry: Omit<HistoryEntry, 'id' | 'savedAt'>): HistoryEntry[] {
    const current = this.read();
    if (current === null) return [];

    const now = this.now();
    const id = entryId(entry);
    const fresh: HistoryEntry = { ...entry, id, savedAt: now };

    let rest = current.filter((e) => e.id !== id);

    const previous = current[0];
    // Solo se reemplaza al refinar una cotizacion nueva. Si la entrante ya
    // estaba en el historial es una revisita (el usuario la recargo), y borrar
    // la que estaba encima le haria perder la que venia armando.
    const isRevisit = current.some((e) => e.id === id);
    const isRefinement =
      previous !== undefined &&
      previous.id !== id &&
      !isRevisit &&
      this.supersedeWithinMs > 0 &&
      now - previous.savedAt < this.supersedeWithinMs;

    if (isRefinement) {
      rest = rest.filter((e) => e.id !== previous.id);
    }

    const next = [fresh, ...rest].slice(0, this.max);
    this.write(next);
    return next;
  }

  remove(id: string): HistoryEntry[] {
    const current = this.read();
    if (current === null) return [];

    const next = current.filter((e) => e.id !== id);
    this.write(next);
    return next;
  }

  clear(): void {
    if (!this.storage) return;
    try {
      this.storage.removeItem(HISTORY_KEY);
    } catch {
      // Sin historial que limpiar; nada que hacer.
    }
  }

  /** `null` significa "el almacenamiento no esta disponible". */
  private read(): HistoryEntry[] | null {
    if (!this.storage) return null;

    try {
      const raw = this.storage.getItem(HISTORY_KEY);
      if (raw === null) return [];

      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];

      // Se descarta lo que no calce en vez de confiar: el contenido puede venir
      // de una version anterior del formato o haber sido editado a mano.
      return parsed.filter(isEntry).slice(0, this.max);
    } catch {
      return null;
    }
  }

  private write(entries: HistoryEntry[]): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(HISTORY_KEY, JSON.stringify(entries));
    } catch {
      // Cuota llena o escritura bloqueada: se pierde el historial, no la app.
    }
  }
}

/** `localStorage` si es utilizable, `null` si no. No lanza nunca. */
export function safeLocalStorage(win: Window | undefined = globalThis.window): Storage | null {
  try {
    const storage = win?.localStorage;
    if (!storage) return null;
    // Acceder no basta: en algunos navegadores solo falla al escribir.
    const probe = '__sc_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}
