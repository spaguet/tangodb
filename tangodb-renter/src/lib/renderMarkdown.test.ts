import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./renderMarkdown";

describe("renderMarkdown", () => {
  it("returns nodes for headings, lists and blockquotes", () => {
    const nodes = renderMarkdown(
      "# Title\n\n> Note\n\n- one\n- two\n\nPlain text."
    );
    expect(nodes.length).toBeGreaterThan(3);
  });
});
