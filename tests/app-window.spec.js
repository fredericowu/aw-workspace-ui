// Playwright e2e coverage for the ported AppWindow/WindowShell behavior:
// opening a window from the AppLauncher, dragging it, resizing it from a
// couple of the 8 handles, chrome button order (Maximize/Close — this pass
// didn't wire Minimize, Reload, Pop-out, or Dev Mode, see the shell's
// `actions` prop for where those would plug in later), and the Logs
// search's open/highlight/navigate(Enter/Shift+Enter)/Escape-close flow.

import { test, expect } from "@playwright/test";

async function openFirstAppWindow(page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Apps" }).click();
  const firstCard = page.locator(".applt-card").first();
  await expect(firstCard).toBeVisible();
  const label = await firstCard.locator(".applt-name").textContent();
  await firstCard.click();
  const win = page.locator(".window.shell").first();
  await expect(win).toBeVisible();
  return { win, label };
}

test.describe("AppWindow / WindowShell", () => {
  test("opening an app from the launcher creates a window", async ({ page }) => {
    const { win, label } = await openFirstAppWindow(page);
    await expect(win.locator(".window-titlebar .title")).toHaveText(label.trim());
    // Home empty-state should be gone now that a window is open.
    await expect(page.locator("#home-empty")).toHaveCount(0);
  });

  test("dragging the titlebar moves the window", async ({ page }) => {
    const { win } = await openFirstAppWindow(page);
    const before = await win.boundingBox();
    const titlebar = win.locator(".window-titlebar");
    const tb = await titlebar.boundingBox();

    await page.mouse.move(tb.x + tb.width / 2, tb.y + 10);
    await page.mouse.down();
    await page.mouse.move(tb.x + tb.width / 2 + 120, tb.y + 90, { steps: 10 });
    await page.mouse.up();

    const after = await win.boundingBox();
    expect(after.x).toBeGreaterThan(before.x + 50);
    expect(after.y).toBeGreaterThan(before.y + 50);
  });

  test("resizing from the SE (corner) and E (edge) handles changes width/height", async ({ page }) => {
    const { win } = await openFirstAppWindow(page);

    // Handles extend a few px outside the window box and the window itself
    // clips overflow, so only the sliver inside the box is actually
    // clickable — same as a real user grabbing the edge. Start the drag
    // from just inside the window's own edge/corner rather than the
    // handle's (partly clipped) bounding box.
    const before = await win.boundingBox();
    // 5px in from the corner: close enough to the corner to hit the 12x12
    // .rz-se handle, far enough that the window's 10px border-radius
    // doesn't round it out of the hit-testable area (verified empirically —
    // 1-2px in misses the element entirely under border-radius clipping).
    const seStart = { x: before.x + before.width - 5, y: before.y + before.height - 5 };
    await page.mouse.move(seStart.x, seStart.y);
    await page.mouse.down();
    await page.mouse.move(seStart.x + 100, seStart.y + 80, { steps: 10 });
    await page.mouse.up();
    const afterSe = await win.boundingBox();
    expect(afterSe.width).toBeGreaterThan(before.width + 50);
    expect(afterSe.height).toBeGreaterThan(before.height + 50);

    // Edge handle (E): grows width only, height unchanged.
    const beforeE = await win.boundingBox();
    const eStart = { x: beforeE.x + beforeE.width - 2, y: beforeE.y + beforeE.height / 2 };
    await page.mouse.move(eStart.x, eStart.y);
    await page.mouse.down();
    await page.mouse.move(eStart.x + 80, eStart.y, { steps: 10 });
    await page.mouse.up();
    const afterE = await win.boundingBox();
    expect(afterE.width).toBeGreaterThan(beforeE.width + 40);
    expect(Math.abs(afterE.height - beforeE.height)).toBeLessThan(5);
  });

  test("titlebar chrome shows Maximize then Close, in that order (Minimize not wired this pass)", async ({ page }) => {
    const { win } = await openFirstAppWindow(page);
    const buttons = win.locator(".shell-actions .win-btn");
    await expect(buttons).toHaveCount(2);
    await expect(buttons.nth(0)).toHaveAttribute("title", "Maximize");
    await expect(buttons.nth(1)).toHaveAttribute("title", "Close");

    await buttons.nth(0).click();
    await expect(win).toHaveClass(/shell-maximized/);
    await expect(buttons.nth(0)).toHaveAttribute("title", "Restore");

    await buttons.nth(1).click();
    await expect(win).toHaveCount(0);
  });

  test("Logs search opens, highlights, navigates with Enter/Shift+Enter, and Escape closes it", async ({ page }) => {
    const { win } = await openFirstAppWindow(page);

    // Content-level App/Logs toggle lives in AppWindow's own toolbar, not
    // the shell chrome — switch to Logs first.
    await win.getByRole("button", { name: /Logs/ }).click();
    await expect(win.locator(".appwin-logs")).toBeVisible();

    await win.locator(".appwin-search-btn").click();
    const searchInput = win.locator(".appwin-search-input");
    await expect(searchInput).toBeVisible();
    await expect(searchInput).toBeFocused();

    await searchInput.fill("info");
    const hits = win.locator(".search-hit");
    await expect(hits.first()).toBeVisible();
    const count = await hits.count();
    expect(count).toBeGreaterThan(1);

    await expect(win.locator(".appwin-search-count")).toHaveText(`1 / ${count}`);

    await searchInput.press("Enter");
    await expect(win.locator(".appwin-search-count")).toHaveText(`2 / ${count}`);

    await searchInput.press("Shift+Enter");
    await expect(win.locator(".appwin-search-count")).toHaveText(`1 / ${count}`);

    await searchInput.press("Escape");
    await expect(win.locator(".appwin-search-bar")).toHaveCount(0);
  });
});
