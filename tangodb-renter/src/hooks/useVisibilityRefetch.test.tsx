import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useVisibilityRefetch } from "./useVisibilityRefetch";

describe("useVisibilityRefetch", () => {
  afterEach(() => {
    delete (window as { Telegram?: unknown }).Telegram;
  });

  it("refetches on window focus", () => {
    const onRefetch = vi.fn();
    renderHook(() => useVisibilityRefetch(onRefetch));

    window.dispatchEvent(new Event("focus"));
    expect(onRefetch).toHaveBeenCalledTimes(1);
  });

  it("refetches when document becomes visible", () => {
    const onRefetch = vi.fn();
    renderHook(() => useVisibilityRefetch(onRefetch));

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onRefetch).toHaveBeenCalledTimes(1);
  });

  it("subscribes to Telegram visibilityChanged when WebApp is present", () => {
    const onRefetch = vi.fn();
    const handlers = new Map<string, () => void>();
    const onEvent = vi.fn((event: string, handler: () => void) => {
      handlers.set(event, handler);
    });
    const offEvent = vi.fn();

    window.Telegram = {
      WebApp: { onEvent, offEvent },
    } as never;

    const { unmount } = renderHook(() => useVisibilityRefetch(onRefetch));

    expect(onEvent).toHaveBeenCalledWith("visibilityChanged", expect.any(Function));
    handlers.get("visibilityChanged")?.();
    expect(onRefetch).toHaveBeenCalledTimes(1);

    unmount();
    expect(offEvent).toHaveBeenCalledWith("visibilityChanged", expect.any(Function));
  });
});
