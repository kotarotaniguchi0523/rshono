import { defineRoutes } from '@rsvhono/core';

export const routes = defineRoutes([{ path: '/', component: () => import('./pages/home') }]);
