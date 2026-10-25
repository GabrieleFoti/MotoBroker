import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://motobroker.it',
  integrations: [
    sitemap({
      filter: (page) => !page.includes('/admin'),
    }),
  ],
  vite: {
    // amazon-cognito-identity-js (usata solo dal pannello /admin) assume l'ambiente
    // Node: fornisce i globali minimi necessari per farla girare nel browser.
    define: {
      global: 'globalThis',
    },
    optimizeDeps: {
      include: ['amazon-cognito-identity-js', 'buffer'],
    },
  },
});
