import { defineRoutes } from '@rsvhono/core';

export const routes = defineRoutes({
  routes: [
    { path: '/', component: () => import('./pages/home') },
    { path: '/items/:id', component: () => import('./pages/item') },
    { path: '/slow', component: () => import('./pages/slow') },
    { path: '/gone', component: () => import('./pages/gone') },
    { path: '/moved', component: () => import('./pages/moved') },
    { type: 'endpoint', path: '/api/health', method: 'get', server: () => import('./health') },
  ],
  notFound: { component: () => import('./pages/not-found') },
});
