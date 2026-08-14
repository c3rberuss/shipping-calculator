/**
 * Cache de cotizaciones en vivo.
 *
 * Quickbox es el unico proveedor que se consulta por red. Sin cache, cada
 * tecleo en el formulario dispararia una peticion a la API de un tercero, y el
 * trafico escalaria con la cantidad de visitantes. Con cache, una cotizacion
 * repetida (recargar la pagina, abrir un enlace compartido, volver sobre una
 * entrada del historial, o simplemente corregir un dato y deshacer) no vuelve a
 * salir a la red.
 *
 * Dos niveles:
 *
 * 1. Memoria: vive lo que dure la pestaña. Instantaneo.
 * 2. `localStorage` con vencimiento: sobrevive recargas y visitas posteriores.
 *
 * Se degrada sin ruido: si el almacenamiento no esta disponible, funciona solo
 * con el nivel de memoria.
 */

export const CACHE_KEY = 'sc:quickbox-cache';
/** Las tarifas de casillero no cambian a diario; un dia es prudente. */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** Tope de entradas persistidas, para no crecer sin limite. */
export const CACHE_MAX = 200;

interface CacheRecord<T> {
  value: T;
  storedAt: number;
}

export interface QuoteCacheOptions {
  ttlMs?: number;
  max?: number;
  now?: () => number;
}

export class QuoteCache<T> {
  private readonly memory = new Map<string, CacheRecord<T>>();
  private readonly storage: Storage | null;
  private readonly ttlMs: number;
  private readonly max: number;
  private readonly now: () => number;

  constructor(storage: Storage | null, options: QuoteCacheOptions = {}) {
    this.storage = storage;
    this.ttlMs = options.ttlMs ?? CACHE_TTL_MS;
    this.max = options.max ?? CACHE_MAX;
    this.now = options.now ?? (() => Date.now());
    this.hydrate();
  }

  get size(): number {
    return this.memory.size;
  }

  get(key: string): T | undefined {
    const record = this.memory.get(key);
    if (!record) return undefined;

    if (this.now() - record.storedAt >= this.ttlMs) {
      this.memory.delete(key);
      this.persist();
      return undefined;
    }
    return record.value;
  }

  set(key: string, value: T): void {
    this.memory.set(key, { value, storedAt: this.now() });
    this.prune();
    this.persist();
  }

  clear(): void {
    this.memory.clear();
    if (!this.storage) return;
    try {
      this.storage.removeItem(CACHE_KEY);
    } catch {
      // Nada que limpiar.
    }
  }

  /** Descarta lo vencido y recorta al tope, empezando por lo mas viejo. */
  private prune(): void {
    const now = this.now();
    for (const [key, record] of this.memory) {
      if (now - record.storedAt >= this.ttlMs) this.memory.delete(key);
    }

    if (this.memory.size <= this.max) return;

    const byAge = [...this.memory.entries()].sort(
      (a, b) => a[1].storedAt - b[1].storedAt,
    );
    for (const [key] of byAge.slice(0, this.memory.size - this.max)) {
      this.memory.delete(key);
    }
  }

  private hydrate(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(CACHE_KEY);
      if (!raw) return;

      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return;

      const now = this.now();
      for (const [key, record] of Object.entries(parsed)) {
        // Se valida la forma: el contenido puede venir de una version anterior.
        if (
          typeof record === 'object' &&
          record !== null &&
          typeof (record as CacheRecord<T>).storedAt === 'number' &&
          'value' in record &&
          now - (record as CacheRecord<T>).storedAt < this.ttlMs
        ) {
          this.memory.set(key, record as CacheRecord<T>);
        }
      }
      this.prune();
    } catch {
      // Cache corrupto: se ignora y se empieza vacio.
    }
  }

  private persist(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(
        CACHE_KEY,
        JSON.stringify(Object.fromEntries(this.memory)),
      );
    } catch {
      // Cuota llena: el nivel de memoria sigue sirviendo.
    }
  }
}
