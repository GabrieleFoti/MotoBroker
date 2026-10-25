// Config pubblica del pannello admin: nessun segreto qui (userPoolId/clientId/apiUrl
// sono identificatori pubblici, non credenziali). Override possibile via .env (Vite/Astro)
// con VITE_CMS_API_URL / VITE_CMS_USER_POOL_ID / VITE_CMS_CLIENT_ID / VITE_CMS_REGION,
// utile per i test E2E che puntano a un ambiente diverso.
export const CMS_CONFIG = {
  apiUrl: import.meta.env.VITE_CMS_API_URL || 'https://4i4hverz39.execute-api.us-east-1.amazonaws.com',
  userPoolId: import.meta.env.VITE_CMS_USER_POOL_ID || 'us-east-1_VsUpLgY2g',
  clientId: import.meta.env.VITE_CMS_CLIENT_ID || '328r334ipir5d3fgp1mlh4vd3l',
  region: import.meta.env.VITE_CMS_REGION || 'us-east-1',
  // Per mostrare le anteprime foto esistenti via raw.githubusercontent.com (repo pubblico,
  // nessuna autenticazione necessaria). Il branch è override-abile per i test E2E (cms-test).
  githubOwner: import.meta.env.VITE_CMS_GITHUB_OWNER || 'GabrieleFoti',
  githubRepo: import.meta.env.VITE_CMS_GITHUB_REPO || 'MotoBroker',
  githubBranch: import.meta.env.VITE_CMS_GITHUB_BRANCH || 'main',
};

export function rawPhotoUrl(slug, filename) {
  const { githubOwner, githubRepo, githubBranch } = CMS_CONFIG;
  return `https://raw.githubusercontent.com/${githubOwner}/${githubRepo}/${githubBranch}/moto/${encodeURIComponent(slug)}/${encodeURIComponent(filename)}?v=${Date.now()}`;
}
