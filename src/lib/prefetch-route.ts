const prefetched = new Set<string>();

const routeImports: Record<string, () => Promise<unknown>> = {
  '/charts': () => import('../pages/TradePage'),
  '/positions': () => import('../pages/PositionsPage'),
  '/ai-trade': () => import('../pages/AITradePage'),
  '/analysis': () => import('../pages/AnalysisPage'),
  '/journal': () => import('../pages/AIJournalPage'),
};

export function prefetchRoute(path: string): void {
  if (prefetched.has(path)) return;
  const loader = routeImports[path];
  if (loader) {
    prefetched.add(path);
    loader().catch(() => {
      prefetched.delete(path);
    });
  }
}
