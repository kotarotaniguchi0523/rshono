import { defineRoutes } from '@rsvhono/core';

export const routes = defineRoutes([
  { path: '/', component: () => import('./pages/home') },
  // Through the app's own alias, to a directory's index file: both are the resolver's business.
  { path: '/aliased', component: () => import('~pages/aliased') },
]);
