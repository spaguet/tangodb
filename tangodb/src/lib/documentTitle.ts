/** Default `<title>` from `index.html` — used when leaving the CRM shell. */
export const APP_DEFAULT_DOCUMENT_TITLE = "TangoDB — Панель Управления Студией Танго";

export function resetAppDocumentTitle(): void {
  document.title = APP_DEFAULT_DOCUMENT_TITLE;
}
