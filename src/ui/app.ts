/**
 * Cableado de la pagina: conecta el formulario, el combobox, el motor, la URL
 * y el historial.
 *
 * Vive aqui y no dentro del `.astro` para que sea importable desde las pruebas.
 * El script de la pagina se limita a llamar a `initApp`.
 */

import {
  catalog as defaultCatalog,
  quickboxRates as defaultQuickboxRates,
  rates as defaultRates,
} from '../data/index.js';
import {
  QuoteCache,
  quoteAll,
  quoteQuickboxFor,
  sortOffers,
  validateInput,
} from '../engine/index.js';
import type {
  Catalog,
  Offer,
  ProviderOffer,
  QuickboxRates,
  QuoteResult,
  UnavailableOffer,
} from '../engine/types.js';
import type { QuickboxFetch, QuickboxQuote } from '../engine/providers/quickbox.js';
import { CategoryCombobox } from './combobox.js';
import { HistoryStore, safeLocalStorage } from './history.js';
import { renderHistory, renderResults } from './render.js';
import { buildSearch, parseParams } from './url.js';

const RENDER_DEBOUNCE_MS = 200;
/**
 * El historial se guarda cuando la entrada se estabiliza, no en cada tecla.
 *
 * Mas largo que el debounce de render a proposito: recotizar es barato y debe
 * sentirse inmediato, mientras que guardar una entrada solo tiene sentido
 * cuando el usuario dejo de ajustar. Aun asi no alcanza por si solo, porque no
 * colapsa las pausas naturales entre campos; de eso se encarga la ventana de
 * reemplazo de `HistoryStore`.
 */
const HISTORY_DEBOUNCE_MS = 2500;

export interface AppOptions {
  catalog?: Catalog;
  rates?: typeof defaultRates;
  /** 0 desactiva los debounces; util en pruebas. */
  debounceMs?: number;
  historyDebounceMs?: number;
  document?: Document;
  /** `null` desactiva el historial. Por defecto, `localStorage` si funciona. */
  storage?: Storage | null;
  now?: () => number;
  /** Ventana de reemplazo del historial. 0 guarda cada cotizacion aparte. */
  supersedeWithinMs?: number;
  quickboxRates?: QuickboxRates;
  /** `null` desactiva la consulta en vivo a Quickbox. */
  fetchImpl?: QuickboxFetch | null;
}

export interface AppHandle {
  /** Fuerza un render inmediato, sin esperar el debounce. */
  render: () => void;
  /** Resuelve cuando la consulta a Quickoox en curso termino de pintarse. */
  settled: () => Promise<void>;
  /** Guarda la cotizacion actual en el historial, sin esperar el debounce. */
  saveToHistory: () => void;
  combobox: CategoryCombobox;
  history: HistoryStore;
  quickboxCache: QuoteCache<QuickboxQuote>;
}

export function initApp(options: AppOptions = {}): AppHandle {
  const doc = options.document ?? document;
  const catalog = options.catalog ?? defaultCatalog;
  const rates = options.rates ?? defaultRates;
  const debounceMs = options.debounceMs ?? RENDER_DEBOUNCE_MS;
  const historyDebounceMs = options.historyDebounceMs ?? HISTORY_DEBOUNCE_MS;
  const now = options.now ?? (() => Date.now());

  const storage =
    options.storage !== undefined ? options.storage : safeLocalStorage();
  const history = new HistoryStore(storage, {
    now,
    supersedeWithinMs: options.supersedeWithinMs,
  });

  /** Falla ruidosamente si el markup y el script se desincronizan. */
  function el<T extends HTMLElement>(id: string): T {
    const node = doc.getElementById(id);
    if (!node) throw new Error(`Falta el elemento #${id} en la pagina`);
    return node as T;
  }

  const form = el<HTMLFormElement>('formulario');
  const pesoInput = el<HTMLInputElement>('peso');
  const valorInput = el<HTMLInputElement>('valor');
  const resultados = el<HTMLElement>('resultados');
  const historial = el<HTMLElement>('historial');
  const categoriaHint = el<HTMLElement>('categoria-hint');

  // Umbral bajo el cual ningun proveedor cobra DAI: Shop USA porque solo lo
  // aplica sobre su umbral, Buyex por su exencion. Se lee de los datos para no
  // duplicar la constante.
  const daiExemptBelowUsd = Math.min(
    rates.shopusa.daiThresholdUsd + 0.01,
    rates.buyex.daiExemption.belowUsd,
  );

  const quickboxRates = options.quickboxRates ?? defaultQuickboxRates;
  const fetchImpl = options.fetchImpl === undefined ? undefined : options.fetchImpl;
  const quickboxCache = new QuoteCache<QuickboxQuote>(storage, { now });

  let categoryId: string | null = null;
  let renderTimer: ReturnType<typeof setTimeout> | undefined;
  let historyTimer: ReturnType<typeof setTimeout> | undefined;
  let lastResult: QuoteResult | null = null;
  /** Descarta respuestas de consultas que el usuario ya dejo atras. */
  let currentGeneration = 0;
  let pending: Promise<void> | null = null;

  function categoryLabel(): string | null {
    if (!categoryId) return null;
    return catalog.categories.find((c) => c.id === categoryId)?.label ?? null;
  }

  function updateCategoryHint(declaredValueUsd: number): void {
    const known = Number.isFinite(declaredValueUsd) && declaredValueUsd >= 0;

    if (known && declaredValueUsd < daiExemptBelowUsd) {
      categoriaHint.textContent = `Bajo $${daiExemptBelowUsd} no se cobra arancel, así que la categoría no cambia el total.`;
      return;
    }
    if (known) {
      categoriaHint.textContent =
        'Define el arancel. Sin ella no se puede cotizar sobre ese monto.';
      return;
    }
    categoriaHint.textContent = `${catalog.categories.length} categorías. Solo influye en compras de $${daiExemptBelowUsd} o más.`;
  }

  function renderHistorySection(): void {
    historial.innerHTML = renderHistory(history.list(), now());
  }

  /**
   * Refleja la cotizacion en la barra de direcciones.
   *
   * `replaceState` y no `pushState`: cada tecleo generaria una entrada nueva y
   * el boton Atras dejaria de servir para volver a la pagina anterior.
   */
  function syncUrl(): void {
    const search = buildSearch({
      weightLb: Number.parseFloat(pesoInput.value),
      declaredValueUsd: Number.parseFloat(valorInput.value),
      categoryId,
    });

    const win = doc.defaultView;
    if (!win?.history?.replaceState) return;

    try {
      win.history.replaceState(null, '', `${win.location.pathname}${search}`);
    } catch {
      // Algunos entornos restringen el historial. No es motivo para romper.
    }
  }

  function saveToHistory(): void {
    const result = lastResult;
    const cheapest = result?.offers[0];
    // Solo se guarda lo que llego a comparar: una entrada sin ofertas no
    // aporta nada al volver a abrirla.
    if (!result || !cheapest) return;

    history.add({
      weightLb: result.input.weightLb,
      declaredValueUsd: result.input.declaredValueUsd,
      categoryId: result.input.categoryId,
      categoryLabel: categoryLabel(),
      cheapest: {
        providerName: cheapest.providerName,
        mode: cheapest.mode,
        totalUsd: cheapest.totalUsd,
      },
    });

    renderHistorySection();
  }

  function scheduleHistory(): void {
    clearTimeout(historyTimer);
    if (historyDebounceMs <= 0) {
      saveToHistory();
      return;
    }
    historyTimer = setTimeout(saveToHistory, historyDebounceMs);
  }

  function paint(result: QuoteResult, quickboxPending: boolean): void {
    resultados.innerHTML = renderResults(result, {
      categoryLabel: categoryLabel(),
      daiExemptBelowUsd,
      quickboxPending,
    });
  }

/** Une las ofertas de Quickbox al resultado local, respetando el orden. */
  function merge(base: QuoteResult, quickbox: ProviderOffer[]): QuoteResult {
    return {
      ...base,
      offers: sortOffers([
        ...base.offers,
        ...quickbox.filter((o): o is Offer => o.available),
      ]),
      unavailable: [
        ...base.unavailable,
        ...quickbox.filter((o): o is UnavailableOffer => !o.available),
      ],
    };
  }

  /**
   * Render en dos fases.
   *
   * Shop USA y Buyex se calculan en el navegador y se pintan de inmediato.
   * Quickbox se consulta a su API y se inserta cuando llega. Esperar a la red
   * para pintar todo haria que una consulta lenta retrase resultados que ya
   * estaban listos.
   *
   * `generation` descarta respuestas de consultas viejas: si el usuario sigue
   * escribiendo, la respuesta de la entrada anterior ya no corresponde a lo que
   * esta viendo.
   */
  function render(): void {
    const declaredValueUsd = Number.parseFloat(valorInput.value);
    const input = {
      weightLb: Number.parseFloat(pesoInput.value),
      declaredValueUsd,
      categoryId,
    };

    const result = quoteAll(input, catalog, rates);
    lastResult = result;

    updateCategoryHint(declaredValueUsd);

    const generation = ++currentGeneration;
    const willQueryQuickbox =
      fetchImpl !== null && validateInput(input).valid;

    paint(result, willQueryQuickbox);
    syncUrl();

    if (!willQueryQuickbox) {
      pending = null;
      scheduleHistory();
      return;
    }

    pending = quoteQuickboxFor(input, catalog, {
      rates: quickboxRates,
      ...(fetchImpl ? { fetchImpl } : {}),
      cache: quickboxCache,
    })
      .then((offers) => {
        // Llego tarde: el usuario ya cambio la entrada.
        if (generation !== currentGeneration || offers.length === 0) return;

        const merged = merge(result, offers);
        lastResult = merged;
        paint(merged, false);
        scheduleHistory();
      })
      .catch(() => {
        // `quoteQuickbox` ya convierte los fallos en una oferta no disponible;
        // esto solo cubre un error inesperado del propio merge o del render.
        if (generation !== currentGeneration) return;
        paint(result, false);
        scheduleHistory();
      });
  }

  function scheduleRender(): void {
    clearTimeout(renderTimer);
    if (debounceMs <= 0) {
      render();
      return;
    }
    renderTimer = setTimeout(render, debounceMs);
  }

  const combobox = new CategoryCombobox(
    {
      input: el<HTMLInputElement>('categoria'),
      list: el<HTMLUListElement>('categoria-lista'),
      clearButton: el<HTMLButtonElement>('categoria-limpiar'),
    },
    {
      catalog,
      onChange: (id) => {
        categoryId = id;
        scheduleRender();
      },
    },
  );

  /** Carga inputs en el formulario y recotiza. */
  function hydrate(input: {
    weightLb: number | null;
    declaredValueUsd: number | null;
    categoryId: string | null;
  }): void {
    pesoInput.value = input.weightLb === null ? '' : String(input.weightLb);
    valorInput.value =
      input.declaredValueUsd === null ? '' : String(input.declaredValueUsd);

    // Actualiza `categoryId` a traves del combobox para que el campo y el
    // estado no puedan quedar desincronizados.
    combobox.setCategoryById(input.categoryId);
    categoryId = combobox.categoryId;

    render();
  }

  form.addEventListener('input', scheduleRender);
  form.addEventListener('submit', (event) => event.preventDefault());

  doc.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof Element && !target.closest('.combo')) {
      combobox.close();
    }
  });

  historial.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    const removeId = target.closest<HTMLElement>('[data-remove]')?.dataset.remove;
    if (removeId) {
      history.remove(removeId);
      renderHistorySection();
      return;
    }

    if (target.closest('#historial-limpiar')) {
      history.clear();
      renderHistorySection();
      return;
    }

    const loadId = target.closest<HTMLElement>('[data-id]')?.dataset.id;
    if (loadId) {
      const entry = history.list().find((e) => e.id === loadId);
      if (entry) {
        hydrate({
          weightLb: entry.weightLb,
          declaredValueUsd: entry.declaredValueUsd,
          categoryId: entry.categoryId,
        });
      }
    }
  });

  const fromUrl = parseParams(doc.defaultView?.location.search ?? '');
  if (
    fromUrl.weightLb !== null ||
    fromUrl.declaredValueUsd !== null ||
    fromUrl.categoryId !== null
  ) {
    hydrate(fromUrl);
  } else {
    render();
  }

  renderHistorySection();

  return {
    render,
    settled: async () => {
      await pending;
    },
    saveToHistory,
    combobox,
    history,
    quickboxCache,
  };
}
