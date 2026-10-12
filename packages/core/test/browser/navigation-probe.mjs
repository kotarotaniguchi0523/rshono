export async function emulateBrowserWithoutPrecommit(page) {
  await page.addInitScript(() => {
    const intercept = NavigateEvent.prototype.intercept;
    NavigateEvent.prototype.intercept = function (options) {
      const { precommitHandler: _precommitHandler, ...supported } = options;
      return intercept.call(this, supported);
    };
  });
}
