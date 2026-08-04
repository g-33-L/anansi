import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';

process.env.DATABASE_URL ||= 'postgresql://stub:stub@localhost:5432/stub';
process.env.REDIS_URL ||= 'redis://localhost:6379';
process.env.ENCRYPTION_KEY ||= 'a'.repeat(64);
process.env.CSRF_SIGNING_KEY ||= 'a'.repeat(32);
process.env.QUERY_API_KEY ||= 'stub';
process.env.API_KEY_HMAC_SECRET ||= 'b'.repeat(32);
process.env.GITHUB_TOKEN ||= 'stub';
process.env.APP_URL ||= 'http://localhost:8080';

const { landingRoutes } = await import('../src/routes/landing.tsx');
const { docsRoutes } = await import('../src/routes/docs.tsx');

async function renderRoute(routes, path) {
  const res = await routes.request(path);
  return await res.text();
}

const outDir = process.argv[2] || '/tmp/preview';
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

// Rewrite absolute paths so the static preview links resolve to the .html files.
function rewriteForStaticPreview(html) {
  return html
    .replace(/href="\/docs"/g, 'href="docs-overview.html"')
    .replace(/href="\/docs\/quickstart"/g, 'href="docs-quickstart.html"')
    .replace(/href="\/docs\/api-reference"/g, 'href="docs-quickstart.html"') // best-effort
    .replace(/href="\/"/g, 'href="landing.html"')
    .replace(/href="\/portal\/login"/g, 'href="#" data-stub="portal/login"')
    .replace(/href="\/portal\/signup[^"]*"/g, 'href="#" data-stub="portal/signup"');
}

const pages = [
  { route: '/', name: 'landing.html', router: landingRoutes },
  { route: '/', name: 'docs-overview.html', router: docsRoutes },
  { route: '/quickstart', name: 'docs-quickstart.html', router: docsRoutes },
];

for (const p of pages) {
  let html = await renderRoute(p.router, p.route);
  html = rewriteForStaticPreview(html);
  writeFileSync(resolve(outDir, p.name), html);
  console.log('wrote', p.name, '('+html.length+' bytes)');
}
