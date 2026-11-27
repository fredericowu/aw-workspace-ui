// Browser regression for the Settings divider limits: 160 px minimum for the
// menu and 320 px minimum for the content pane, measured after real mouse
// drags to both extremes. QA measured 316 px at the right limit because the
// 4 px separator was not counted against the content minimum.
import { test, expect } from '@playwright/test';

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const onPath = (pred) => (url) => pred(url.pathname);

async function stubApi(page) {
  await page.route(onPath((p) => p.startsWith('/api/')), (route) => route.fulfill(json({})));
  await page.route(onPath((p) => p === '/api/auth/status'), (route) => route.fulfill(json({ authenticated: true, mode: 'identity' })));
  await page.route(onPath((p) => p === '/api/apps'), (route) => route.fulfill(json([])));
  await page.route(onPath((p) => p === '/api/guest-users'), (route) => route.fulfill(json([])));
  await page.route(onPath((p) => p === '/api/identity/me'), (route) => route.fulfill(json({
    email: 'fredericowu@gmail.com',
    memberships: [{ workspace: 'aw', role: 'owner' }],
  })));
}

async function widths(page) {
  return page.getByTestId('settings-divider').evaluate((sep) => ({
    nav: sep.previousElementSibling.getBoundingClientRect().width,
    sep: sep.getBoundingClientRect().width,
    content: sep.nextElementSibling.getBoundingClientRect().width,
    total: sep.parentElement.getBoundingClientRect().width,
  }));
}

async function dragTo(page, x) {
  const box = await page.getByTestId('settings-divider').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(x, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
}

for (const vw of [1600, 1280]) {
  test(`divider honors 160 px menu and 320 px content minimums @ ${vw}px`, async ({ page }) => {
    await stubApi(page);
    await page.setViewportSize({ width: vw, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Workspace menu', exact: true }).hover();
    await page.getByRole('button', { name: 'Open Settings' }).click();
    await expect(page.getByTestId('settings-divider')).toBeVisible();

    // Far right: content pane must stop at exactly 320, not below.
    await dragTo(page, vw + 200);
    let w = await widths(page);
    expect(w.content).toBeGreaterThanOrEqual(320);
    expect(Math.round(w.content)).toBe(320);
    expect(Math.round(w.nav + w.sep + w.content)).toBe(Math.round(w.total));

    // Far left: menu must stop at exactly 160.
    await dragTo(page, -200);
    w = await widths(page);
    expect(Math.round(w.nav)).toBe(160);
    expect(w.content).toBeGreaterThanOrEqual(320);
  });
}

test('resizing the Settings window itself cannot shrink the content pane below 320 px', async ({ page }) => {
  await stubApi(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Workspace menu', exact: true }).hover();
  await page.getByRole('button', { name: 'Open Settings' }).click();
  await expect(page.getByTestId('settings-divider')).toBeVisible();

  // Drag the window's right edge far to the left (resize handle on the Rnd).
  const win = page.getByTestId('settings-divider').locator('xpath=ancestor::div[contains(@class,"react-draggable")][1]');
  const wb = await win.boundingBox();
  await page.mouse.move(wb.x + wb.width - 1, wb.y + wb.height / 2);
  await page.mouse.down();
  await page.mouse.move(wb.x + 50, wb.y + wb.height / 2, { steps: 10 });
  await page.mouse.up();

  const w = await widths(page);
  expect(w.content).toBeGreaterThanOrEqual(320);
  expect(Math.round(w.nav)).toBeGreaterThanOrEqual(160);
});
