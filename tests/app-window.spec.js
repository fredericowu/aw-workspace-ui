// The hand-ported WindowShell/AppLauncher (.window.shell, .applt-card,
// .shell-actions, ...) this spec used to cover was replaced wholesale by a
// literal copy of the real production dashboard (src/app/) — see AGENTS.md
// "copia primeiro, refatora depois". Its DOM (react-rnd based WindowManager,
// no stable class hooks yet) doesn't map onto the old selectors, so the
// drag/resize/logs-search coverage that used to live here is deferred to
// the redesign pass that follows this copy.
//
// For now this only smoke-tests the one thing that must be true from turn
// one of the copy: the app is NOT public — with no session cookie it shows
// the real login screen instead of the dashboard.

import { test, expect } from "@playwright/test";

test.describe("auth gate", () => {
  test("unauthenticated visit shows the login screen, not the dashboard", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByPlaceholder("Password")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    // Dashboard chrome must not be present while unauthenticated.
    await expect(page.locator("[data-window-key]")).toHaveCount(0);
  });
});
