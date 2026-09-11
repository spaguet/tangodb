import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { queryErrorDetail, queryErrorTitle } from "./queryError.ts";
import type { TranslateFn } from "./utils.ts";

const t: TranslateFn = (key) => {
  if (key === "renters.error.notFound") return "Арендатор не найден";
  if (key === "common.error.loadFailed") return "Не удалось загрузить данные";
  if (key === "common.error.forbidden") return "Недостаточно прав";
  return key;
};

describe("queryErrorTitle", () => {
  it("translates a dotted i18n key instead of the generic load-failed title", () => {
    assert.equal(
      queryErrorTitle(new Error("renters.error.notFound"), t),
      "Арендатор не найден"
    );
  });

  it("keeps an explicit message override", () => {
    assert.equal(
      queryErrorTitle(new Error("renters.error.notFound"), t, "Карточка недоступна"),
      "Карточка недоступна"
    );
  });

  it("falls back to load-failed for technical PostgREST text", () => {
    assert.equal(
      queryErrorTitle(new Error("permission denied for function get_renter_detail"), t),
      "Не удалось загрузить данные"
    );
  });
});

describe("queryErrorDetail", () => {
  it("hides the subtitle when it would repeat the translated title", () => {
    const title = queryErrorTitle(new Error("renters.error.notFound"), t);
    assert.equal(queryErrorDetail(new Error("renters.error.notFound"), t, title), null);
  });

  it("maps snake_case RPC codes to human text under a generic title", () => {
    const title = queryErrorTitle(new Error("forbidden"), t);
    assert.equal(queryErrorDetail(new Error("forbidden"), t, title), "Недостаточно прав");
  });
});
