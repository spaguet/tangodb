import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { makeWallet } from "../../test/fixtures";
import QuoteSummary, { topupAmountFromWallet } from "./QuoteSummary";

describe("QuoteSummary", () => {
  it("shows shortage and top-up CTA when balance is insufficient", async () => {
    const onTopup = vi.fn();
    const wallet = makeWallet({ spendable: 80, debt_amount: 0 });

    render(
      <QuoteSummary
        locale="ru"
        currency="RUB"
        cost={1000}
        prepay={200}
        remainder={800}
        wallet={wallet}
        onTopup={onTopup}
      />
    );

    expect(screen.getByText(/Не хватает/i)).toBeTruthy();
    const cta = screen.getByRole("button", { name: /Пополнить/i });
    await userEvent.click(cta);
    expect(onTopup).toHaveBeenCalledWith(120);
  });

  it("suggests debt plus prepay on CTA when debt is outstanding", async () => {
    const onTopup = vi.fn();
    const wallet = makeWallet({ spendable: 0, debt_amount: 100 });

    render(
      <QuoteSummary
        locale="ru"
        currency="RUB"
        cost={1000}
        prepay={200}
        remainder={800}
        wallet={wallet}
        onTopup={onTopup}
      />
    );

    const cta = screen.getByRole("button", { name: /Пополнить/i });
    await userEvent.click(cta);
    expect(onTopup).toHaveBeenCalledWith(300);
  });

  it("hides top-up CTA when balance covers prepay", () => {
    render(
      <QuoteSummary
        locale="ru"
        currency="RUB"
        cost={1000}
        prepay={200}
        remainder={800}
        wallet={makeWallet({ spendable: 500 })}
        onTopup={vi.fn()}
      />
    );

    expect(screen.queryByRole("button", { name: /Пополнить/i })).toBeNull();
  });
});

describe("topupAmountFromWallet", () => {
  it("returns zero when no shortage", () => {
    expect(topupAmountFromWallet(makeWallet({ spendable: 500 }), 200)).toBe(0);
  });

  it("returns shortage or debt+prepay", () => {
    expect(topupAmountFromWallet(makeWallet({ spendable: 50, debt_amount: 0 }), 200)).toBe(150);
    expect(topupAmountFromWallet(makeWallet({ spendable: 0, debt_amount: 100 }), 200)).toBe(300);
  });
});
