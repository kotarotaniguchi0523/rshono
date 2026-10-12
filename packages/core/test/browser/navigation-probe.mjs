import { expect } from '@playwright/test';

export async function emulateBrowserWithoutPrecommit(page) {
  await page.addInitScript(() => {
    const intercept = NavigateEvent.prototype.intercept;
    NavigateEvent.prototype.intercept = function (options) {
      const { precommitHandler: _precommitHandler, ...supported } = options;
      return intercept.call(this, supported);
    };
  });
}

export async function startRouterCall(page, method, href, slot = 'primary') {
  await expect(page.locator('[data-nav-router]')).toBeVisible();
  await page.evaluate(
    ({ method, href, slot }) => {
      const router = document.querySelector('[data-nav-router]').router;
      const key = `data-navigation-result-${slot}`;
      const record = (result) => sessionStorage.setItem(key, JSON.stringify(result));
      record({ state: 'waiting' });
      const result = method === 'push' || method === 'replace' ? router[method](href) : router[method]();
      void result.then(
        (outcome) => record({ state: 'resolved', kind: outcome.kind, url: outcome.url?.href, heading: document.querySelector('h1')?.textContent }),
        (error) => record({ state: 'rejected', name: error.name }),
      );
    },
    { method, href, slot },
  );
}

export async function routerResult(page, slot = 'primary') {
  return page.evaluate((slot) => JSON.parse(sessionStorage.getItem(`data-navigation-result-${slot}`) ?? 'null'), slot);
}
