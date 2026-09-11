import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeWallet } from "../../test/fixtures";
import QuoteSummary, { topupAmountFromWallet } from "./QuoteSummary";

describe("QuoteSummary", () => {
  it("shows amount due and top-up CTA for 100% minus balance", async () => {
    const onTopup = vi.fn();
    const wallet = makeWallet({ spendable: 80, debt_amount: 0 });

    render(
      <QuoteSummary
        locale="ru"
        currency="RUB"
        cost={1000}
        prepay={500}
        remainder={500}
        wallet={wallet}
        onTopup={onTopup}
      />
    );

    expect(screen.getByText(/К оплате/i)).toBeTruthy();
    expect(screen.queryByText(/Долг:/i)).toBeNull();
    const cta = screen.getByRole("button", { name: /Пополнить/i });
    await userEvent.click(cta);
    expect(onTopup).toHaveBeenCalledWith(920);
  });

  it("shows debt in the quote and suggests debt plus 100% on CTA", async () => {
    const onTopup = vi.fn();
    const wallet = makeWallet({ spendable: 0, debt_amount: 100 });

    render(
      <QuoteSummary
        locale="ru"
        currency="RUB"
        cost={1000}
        prepay={500}
        remainder={500}
        wallet={wallet}
        onTopup={onTopup}
      />
    );

    expect(screen.getByText(/Долг:/i)).toBeTruthy();
    expect(screen.getByText(/К оплате/i)).toBeTruthy();
    const cta = screen.getByRole("button", { name: /Пополнить/i });
    await userEvent.click(cta);
    expect(onTopup).toHaveBeenCalledWith(1100);
  });

  it("hides top-up CTA when balance covers 100% cost", () => {
    render(
      <QuoteSummary
        locale="ru"
        currency="RUB"
        cost={1000}
        prepay={500}
        remainder={500}
        wallet={makeWallet({ spendable: 1000 })}
        onTopup={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: /Пополнить/i })).toBeNull();
    expect(screen.queryByText(/К оплате/i)).toBeNull();
  });

  it("still suggests the remaining 50% when balance only covers activation prepay", async () => {
    const onTopup = vi.fn();
    render(
      <QuoteSummary
        locale="ru"
        currency="RUB"
        cost={1000}
        prepay={500}
        remainder={500}
        wallet={makeWallet({ spendable: 500 })}
        onTopup={onTopup}
      />
    );

    const cta = screen.getByRole("button", { name: /Пополнить/i });
    await userEvent.click(cta);
    expect(onTopup).toHaveBeenCalledWith(500);
  });
});

describe("topupAmountFromWallet", () => {
  it("returns zero when no shortage versus 100%", () => {
    expect(topupAmountFromWallet(makeWallet({ spendable: 1000 }), 1000)).toBe(0);
  });

  it("returns 100% shortage or debt+cost", () => {
    expect(topupAmountFromWallet(makeWallet({ spendable: 50, debt_amount: 0 }), 1000)).toBe(950);
    expect(topupAmountFromWallet(makeWallet({ spendable: 0, debt_amount: 100 }), 1000)).toBe(1100);
  });
});
