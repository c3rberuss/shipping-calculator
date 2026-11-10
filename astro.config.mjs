// @ts-check
import { defineConfig } from 'astro/config';

/*
 * El sitio se publica en un dominio propio, servido desde la raiz.
 *
 * `site` y `base` quedan fijos a proposito: antes se inyectaban desde
 * actions/configure-pages, pero ese valor depende de si el dominio ya estaba
 * configurado al momento del build. Un build hecho antes de asignar el dominio
 * salio con base `/shipping-calculator/` y todos los assets dieron 404.
 */
export default defineConfig({
  site: 'https://ship.josueamaya.dev',
  base: '/',
  output: 'static',
  trailingSlash: 'ignore',
});
