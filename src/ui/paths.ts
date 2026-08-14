/**
 * Rutas de assets relativas al `base` del sitio.
 *
 * `import.meta.env.BASE_URL` no siempre trae barra final: al desplegar en
 * GitHub Pages, `actions/configure-pages` entrega `base_path` como `/repo`, sin
 * barra, y concatenar directo produce `/repofavicon.svg`. Este helper existe
 * porque ese bug ya se colo una vez.
 */
export function withBase(base: string, path: string): string {
  const left = base.endsWith('/') ? base.slice(0, -1) : base;
  const right = path.startsWith('/') ? path.slice(1) : path;
  return `${left}/${right}`;
}

/** El `base` en forma de URL de directorio, siempre con barra final. */
export function baseHref(base: string): string {
  return base.endsWith('/') ? base : `${base}/`;
}
