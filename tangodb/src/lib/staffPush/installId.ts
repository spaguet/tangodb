/** Stable per-WebView install id for push token registration. */
const INSTALL_ID_KEY = "tangodb-crm-install-id";

export function getCrmInstallId(): string {
  if (typeof localStorage === "undefined") return "web-anonymous";
  let id = localStorage.getItem(INSTALL_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(INSTALL_ID_KEY, id);
  }
  return id;
}
