/** Capture invite token before telegram-web-app.js rewrites location.hash. */
(function () {
  try {
    var query = new URLSearchParams(location.search);
    var hash = new URLSearchParams(String(location.hash || "").replace(/^#/, ""));
    var raw = query.get("token") || hash.get("token") || "";
    var cleaned = String(raw)
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      .trim();
    var match = /^TDB-INV-([0-9a-fA-F]{32})$/.exec(cleaned);
    if (match) {
      window.__TDB_INVITE_TOKEN__ = "TDB-INV-" + match[1].toLowerCase();
    }
  } catch (_e) {
    /* ignore */
  }
})();
