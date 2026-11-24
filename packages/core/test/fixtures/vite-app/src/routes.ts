import { defineRoutes } from '@rshono/core';

export const routes = defineRoutes({
  routes: [
    { path: '/', component: () => import('./pages/home') },
    { path: '/items/:id', component: () => import('./pages/item') },
    { path: '/slow', component: () => import('./pages/slow') },
    { path: '/gone', component: () => import('./pages/gone') },
    { path: '/moved', component: () => import('./pages/moved') },
    { path: '/client-page', component: () => import('./pages/client-page') },
    { type: 'endpoint', path: '/api/health', method: 'get', server: () => import('./health') },
  ],
  notFound: { component: () => import('./pages/not-found') },
});
