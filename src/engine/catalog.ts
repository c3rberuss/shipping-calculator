/**
 * Traduccion de la categoria elegida por el usuario al catalogo de cada
 * proveedor.
 *
 * El usuario elige una sola vez sobre el catalogo unificado; aqui se resuelve
 * a la entrada nativa de cada proveedor, con SU tasa de arancel. Nunca se
 * aplica una tasa por defecto ni un cero implicito cuando falta el mapeo: eso
 * produciria una comparacion incorrecta sin que el usuario lo note.
 */

import type {
  Catalog,
  CatalogCategory,
  CategoryResolution,
  ProviderId,
} from './types.js';

export function findCategory(
  catalog: Catalog,
  categoryId: string,
): CatalogCategory | undefined {
  return catalog.categories.find((c) => c.id === categoryId);
}

export function resolveCategory(
  catalog: Catalog,
  categoryId: string | null,
  providerId: ProviderId,
): CategoryResolution {
  if (categoryId === null) return { kind: 'none' };

  const category = findCategory(catalog, categoryId);
  // Un id desconocido (URL manipulada, catalogo viejo en un enlace compartido)
  // se trata como si no hubiera seleccion. Ver spec 4.9.
  if (!category) return { kind: 'none' };

  const mapping = category.mappings[providerId];
  if (!mapping) return { kind: 'not-mapped', label: category.label };

  return {
    kind: 'resolved',
    id: category.id,
    label: category.label,
    daiRate: mapping.daiRate,
    match: mapping.match,
  };
}

/**
 * Categoria cuya etiqueta o alias coincide exactamente con el texto.
 *
 * Permite aceptar lo que el usuario escribio aunque no haya elegido de la
 * lista: descartar un texto que identifica sin ambiguedad una categoria es
 * perder trabajo suyo sin motivo.
 */
export function findByExactLabel(
  catalog: Catalog,
  text: string,
): CatalogCategory | undefined {
  const needle = normalize(text.trim());
  if (needle === '') return undefined;

  return catalog.categories.find(
    (c) =>
      normalize(c.label) === needle ||
      c.aliases.some((a) => normalize(a) === needle),
  );
}

/** Busqueda por etiqueta y alias, para el selector de la fase 3. */
export function searchCategories(
  catalog: Catalog,
  query: string,
): CatalogCategory[] {
  const q = normalize(query.trim());
  if (q === '') return catalog.categories;

  return catalog.categories.filter(
    (c) =>
      normalize(c.label).includes(q) ||
      c.aliases.some((a) => normalize(a).includes(q)),
  );
}

/** Sin acentos y en minusculas, para que "camara" encuentre "cámara". */
function normalize(value: string): string {
  return value
    .normalize('NFD')
    // Rango de marcas diacriticas combinantes.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}
