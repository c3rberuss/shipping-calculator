// @ts-check
import { defineConfig } from 'astro/config';

/*
 * `site` y `base` se inyectan desde el workflow de GitHub Pages
 * (actions/configure-pages expone la URL y el path del repositorio).
 * En local quedan en la raiz para que `pnpm dev` funcione sin configurar nada.
 *
 * Pendiente: fijar el dominio definitivo cuando se resuelva la pregunta
 * abierta 5 del spec (nombre y dominio del proyecto).
 */
export default defineConfig({
  site: process.env.SITE_URL || 'http://localhost:4321',
  base: process.env.BASE_PATH || '/',
  output: 'static',
  trailingSlash: 'ignore',
});
