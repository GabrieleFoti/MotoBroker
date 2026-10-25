import { getViteConfig } from 'astro/config';

export default getViteConfig({
  test: { include: ['src/**/*.test.ts', 'infra/**/*.test.ts'] },
});
