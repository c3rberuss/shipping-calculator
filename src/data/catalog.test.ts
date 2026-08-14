import { describe, expect, it } from 'vitest';

import { resolveCategory, searchCategories } from '../engine/catalog.js';
import type { ProviderId } from '../engine/types.js';
import buyexSource from './catalogs/buyex-source.json' with { type: 'json' };
import quickboxSource from './catalogs/quickbox-source.json' with { type: 'json' };
import shopusaSource from './catalogs/shopusa-source.json' with { type: 'json' };
import { catalog } from './index.js';

/**
 * El catalogo unificado es el punto donde una equivocacion pasa mas
 * desapercibida: un mapeo mal puesto no rompe nada, solo produce una
 * comparacion incorrecta. Estas pruebas lo amarran contra los catalogos
 * extraidos de cada proveedor.
 */

const PROVIDERS: ProviderId[] = ['shopusa', 'buyex', 'quickbox'];

const shopusaByName = new Map(shopusaSource.categories.map((c) => [c.name, c]));
const buyexByValue = new Map(
  buyexSource.categories.map((c) => [c.optionValue, c]),
);
const quickboxByArancelId = new Map(
  quickboxSource.categories.map((c) => [c.arancelId, c]),
);

describe('estructura del catalogo', () => {
  it('tiene version y al menos 40 categorias', () => {
    expect(catalog.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(catalog.categories.length).toBeGreaterThanOrEqual(40);
  });

  it('no repite ids', () => {
    const ids = catalog.categories.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('todas las categorias tienen etiqueta y alias de busqueda', () => {
    for (const c of catalog.categories) {
      expect(c.label.length, `categoria ${c.id}`).toBeGreaterThan(0);
      expect(c.aliases.length, `categoria ${c.id}`).toBeGreaterThan(0);
    }
  });
});

describe('completitud de los mapeos', () => {
  /**
   * Criterio de aceptacion del spec 5: ninguna categoria puede carecer de
   * mapeo explicito. `null` declarado es valido; ausente no lo es.
   */
  it('cada categoria declara los tres proveedores, con valor o con null', () => {
    for (const c of catalog.categories) {
      for (const provider of PROVIDERS) {
        expect(
          provider in c.mappings,
          `categoria ${c.id} no declara ${provider}`,
        ).toBe(true);
      }
    }
  });

  it('cada mapeo de Quickbox trae el arancelId que su API espera', () => {
    for (const c of catalog.categories) {
      const mapping = c.mappings.quickbox;
      if (mapping) {
        expect(mapping.arancelId, `categoria ${c.id}`).toBeTruthy();
      }
    }
  });

  it('solo "otros" queda sin cobertura en Quickbox', () => {
    const sin = catalog.categories
      .filter((c) => !c.mappings.quickbox)
      .map((c) => c.id);

    expect(sin).toEqual(['otros']);
  });

  it('todo mapeo declara su tipo de correspondencia', () => {
    for (const c of catalog.categories) {
      for (const provider of PROVIDERS) {
        const mapping = c.mappings[provider];
        if (mapping) {
          expect(
            ['direct', 'approximate'],
            `categoria ${c.id} / ${provider}`,
          ).toContain(mapping.match);
        }
      }
    }
  });
});

describe('coherencia contra los catalogos de origen', () => {
  it('cada mapeo de Shop USA existe en su catalogo y con la misma tasa', () => {
    for (const c of catalog.categories) {
      const mapping = c.mappings.shopusa;
      if (!mapping) continue;

      const source = shopusaByName.get(mapping.name);
      expect(source, `categoria ${c.id}: "${mapping.name}" no existe en Shop USA`)
        .toBeDefined();
      expect(mapping.daiRate, `categoria ${c.id}: tasa distinta a la de origen`)
        .toBe(source?.daiRate);
    }
  });

  it('cada mapeo de Buyex existe en su catalogo y con la misma tasa', () => {
    for (const c of catalog.categories) {
      const mapping = c.mappings.buyex;
      if (!mapping) continue;

      const source = buyexByValue.get(mapping.optionValue ?? '');
      expect(
        source,
        `categoria ${c.id}: opcion ${mapping.optionValue} no existe en Buyex`,
      ).toBeDefined();
      expect(mapping.daiRate, `categoria ${c.id}: tasa distinta a la de origen`)
        .toBe(source?.daiRate);
      expect(mapping.name).toBe(source?.name);
    }
  });

  it('cada mapeo de Quickbox existe en su catalogo y con la misma tasa', () => {
    for (const c of catalog.categories) {
      const mapping = c.mappings.quickbox;
      if (!mapping) continue;

      const source = quickboxByArancelId.get(mapping.arancelId ?? '');
      expect(
        source,
        `categoria ${c.id}: arancel ${mapping.arancelId} no existe en Quickbox`,
      ).toBeDefined();
      expect(mapping.daiRate, `categoria ${c.id}: tasa distinta a la de origen`)
        .toBe(source?.daiRate);
      expect(mapping.name).toBe(source?.name);
    }
  });

  it('las tasas son fracciones, nunca porcentajes', () => {
    for (const c of catalog.categories) {
      for (const provider of PROVIDERS) {
        const mapping = c.mappings[provider];
        if (mapping) {
          expect(mapping.daiRate, `categoria ${c.id} / ${provider}`)
            .toBeGreaterThanOrEqual(0);
          expect(mapping.daiRate, `categoria ${c.id} / ${provider}`)
            .toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('catalogos de origen', () => {
  it('conserva las 64 categorias extraidas de Shop USA', () => {
    expect(shopusaSource.categories).toHaveLength(64);
  });

  it('conserva las 167 categorias extraidas de Buyex', () => {
    expect(buyexSource.categories).toHaveLength(167);
  });

  it('conserva los 264 aranceles obtenidos de la API de Quickbox', () => {
    expect(quickboxSource.categories).toHaveLength(264);
  });

  /**
   * En el catalogo de Buyex la etiqueta de CALZADO dice "15% DAI" pero su
   * atributo data-dai es 14, y es ese el valor que su calculadora usa. Si
   * alguna vez lo corrigen, esta prueba avisa.
   */
  it('preserva la inconsistencia conocida de CALZADO en Buyex', () => {
    const calzado = buyexByValue.get('3');
    expect(calzado?.name).toContain('CALZADO');
    expect(calzado?.name).toContain('15% DAI');
    expect(calzado?.daiRate).toBe(0.14);
  });
});

describe('resolveCategory', () => {
  it('devuelve "none" cuando no hay seleccion', () => {
    expect(resolveCategory(catalog, null, 'shopusa')).toEqual({ kind: 'none' });
  });

  it('trata un id desconocido como si no hubiera seleccion', () => {
    expect(resolveCategory(catalog, 'no-existe', 'buyex')).toEqual({
      kind: 'none',
    });
  });

  it('resuelve la tasa nativa de cada proveedor para la misma categoria', () => {
    const enShopUsa = resolveCategory(catalog, 'audifonos', 'shopusa');
    const enBuyex = resolveCategory(catalog, 'audifonos', 'buyex');

    expect(enShopUsa).toMatchObject({ kind: 'resolved', daiRate: 0.15 });
    expect(enBuyex).toMatchObject({ kind: 'resolved', daiRate: 0 });
  });

  it('devuelve "not-mapped" cuando el proveedor no cubre la categoria', () => {
    expect(resolveCategory(catalog, 'otros', 'buyex')).toEqual({
      kind: 'not-mapped',
      label: 'Otros bienes',
    });
  });

  it('propaga el tipo de correspondencia del mapeo', () => {
    expect(resolveCategory(catalog, 'drones', 'buyex')).toMatchObject({
      match: 'approximate',
    });
    expect(resolveCategory(catalog, 'televisores', 'buyex')).toMatchObject({
      match: 'direct',
    });
  });
});

describe('searchCategories', () => {
  it('devuelve todo el catalogo con consulta vacia', () => {
    expect(searchCategories(catalog, '  ')).toHaveLength(
      catalog.categories.length,
    );
  });

  it('encuentra por etiqueta', () => {
    const found = searchCategories(catalog, 'laptop');
    expect(found.map((c) => c.id)).toContain('laptops-computadoras');
  });

  it('encuentra por alias', () => {
    expect(searchCategories(catalog, 'iphone').map((c) => c.id)).toContain(
      'celulares-tablets',
    );
    expect(searchCategories(catalog, 'air fryer').map((c) => c.id)).toContain(
      'electrodomesticos-cocina',
    );
  });

  it('ignora acentos y mayusculas', () => {
    const conAcento = searchCategories(catalog, 'cámara');
    const sinAcento = searchCategories(catalog, 'CAMARA');

    expect(conAcento.map((c) => c.id)).toContain('camaras');
    expect(sinAcento.map((c) => c.id)).toEqual(conAcento.map((c) => c.id));
  });

  it('devuelve vacio cuando nada coincide', () => {
    expect(searchCategories(catalog, 'zzzzzzz')).toHaveLength(0);
  });
});
