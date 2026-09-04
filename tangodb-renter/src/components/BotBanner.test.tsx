import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import BotBanner from "./BotBanner";

describe("BotBanner", () => {
  it("hides when bot is started and write access is allowed", () => {
    const { container } = render(
      <BotBanner
        locale="ru"
        botStarted
        allowsWrite
        botUrl="https://t.me/studio"
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("shows blocked banner when bot started but write is denied", () => {
    render(
      <BotBanner
        locale="ru"
        botStarted
        allowsWrite={false}
        botUrl="https://t.me/fe1studio"
      />
    );
    expect(screen.getByText(/заблокировали бота/i)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Разблокировать бота" })).toBeTruthy();
  });

  it("shows CTA link when bot URL is provided", () => {
    render(
      <BotBanner locale="ru" botStarted={false} allowsWrite={false} botUrl="https://t.me/fe1studio" />
    );
    const link = screen.getByRole("link", { name: "Открыть бота" });
    expect(link.getAttribute("href")).toBe("https://t.me/fe1studio");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("shows banner without CTA when bot URL is missing", () => {
    render(<BotBanner locale="en" botStarted={false} allowsWrite={false} botUrl={null} />);
    expect(screen.getByText(/Open the studio bot/i)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
