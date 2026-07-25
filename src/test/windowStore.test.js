import { beforeEach, describe, expect, it } from "vitest";
import { windowStore } from "../components/windowStore.js";

describe("windowStore", () => {
  beforeEach(() => {
    localStorage.clear();
    windowStore.states = {};
    windowStore.zOrder = [];
    windowStore.maximizedKey = null;
  });

  it("seeds geometry on first access and persists it to localStorage", () => {
    const g = windowStore.getGeometry("win-a", { x: 60, y: 60, width: 480, height: 380 });
    expect(g).toEqual({ x: 60, y: 60, width: 480, height: 380 });
    expect(JSON.parse(localStorage.getItem("aw-window-states"))["win-a"]).toEqual(g);
  });

  it("cascades default position for each subsequently seeded window", () => {
    const g1 = windowStore.getGeometry("win-a", { x: 60, y: 60, width: 480, height: 380 });
    const g2 = windowStore.getGeometry("win-b", { x: 60, y: 60, width: 480, height: 380 });
    expect(g2.x).toBe(g1.x + 24);
    expect(g2.y).toBe(g1.y + 24);
  });

  it("merges partial geometry updates without clobbering the rest", () => {
    windowStore.getGeometry("win-a", { x: 60, y: 60, width: 480, height: 380 });
    windowStore.setGeometry("win-a", { width: 600 });
    expect(windowStore.states["win-a"]).toEqual({ x: 60, y: 60, width: 600, height: 380 });
  });

  it("bringToFront moves a key to the end of zOrder and getZIndex reflects rank", () => {
    windowStore.bringToFront("win-a");
    windowStore.bringToFront("win-b");
    windowStore.bringToFront("win-a");
    expect(windowStore.zOrder).toEqual(["win-b", "win-a"]);
    expect(windowStore.getZIndex("win-a")).toBe(2);
    expect(windowStore.getZIndex("win-b")).toBe(1);
  });

  it("toggleMaximize flips maximized state and always brings the window to front", () => {
    windowStore.bringToFront("win-a");
    windowStore.bringToFront("win-b");
    expect(windowStore.isMaximized("win-a")).toBe(false);
    windowStore.toggleMaximize("win-a");
    expect(windowStore.isMaximized("win-a")).toBe(true);
    expect(windowStore.getZIndex("win-a")).toBe(9000);
    expect(windowStore.zOrder[windowStore.zOrder.length - 1]).toBe("win-a");
    windowStore.toggleMaximize("win-a");
    expect(windowStore.isMaximized("win-a")).toBe(false);
  });

  it("remove() clears geometry, zOrder entry, and maximized flag for that key", () => {
    windowStore.getGeometry("win-a", { x: 60, y: 60, width: 480, height: 380 });
    windowStore.bringToFront("win-a");
    windowStore.toggleMaximize("win-a");
    windowStore.remove("win-a");
    expect(windowStore.states["win-a"]).toBeUndefined();
    expect(windowStore.zOrder).not.toContain("win-a");
    expect(windowStore.isMaximized("win-a")).toBe(false);
  });
});
