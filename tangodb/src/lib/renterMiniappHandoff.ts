/** Production origin of tangodb-renter — BotFather Web App URL and CRM handoff target. */
export const PRODUCTION_RENTER_MINIAPP_ORIGIN = "https://tangodb-renter.vercel.app";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type TelegramWebAppShim = { initData?: string };
type TelegramShim = { WebApp?: TelegramWebAppShim };

export function getRenterMiniappOrigin(): string {
  const fromEnv = import.meta.env.VITE_RENTER_MINIAPP_ORIGIN?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  if (import.meta.env.DEV) return "http://localhost:3002";
  return PRODUCTION_RENTER_MINIAPP_ORIGIN;
}

function isOrgUuid(value: string): boolean {
  return UUID_RE.test(value);
}

function readTelegramInitData(): string {
  const telegram = (window as Window & { Telegram?: TelegramShim }).Telegram;
  return (telegram?.WebApp?.initData ?? "").trim();
}

/** Direct Link `startapp` arrives as GET `tgWebAppStartParam` and/or HMAC `start_param`. */
export function readRenterStartParam(search: string, hash: string, initData: string): string | null {
  const fromQuery = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search)
    .get("tgWebAppStartParam")
    ?.trim();
  if (fromQuery && isOrgUuid(fromQuery)) return fromQuery;

  const hashBody = hash.startsWith("#") ? hash.slice(1) : hash;
  if (hashBody) {
    const hashParams = new URLSearchParams(hashBody);
    const encodedInit = hashParams.get("tgWebAppData");
    if (encodedInit) {
      const fromHash = new URLSearchParams(encodedInit).get("start_param")?.trim() ?? "";
      if (fromHash && isOrgUuid(fromHash)) return fromHash;
    }
  }

  const fromInit = new URLSearchParams(initData).get("start_param")?.trim() ?? "";
  if (fromInit && isOrgUuid(fromInit)) return fromInit;
  return null;
}

export function renterMiniappHandoffUrl(
  renterOrigin: string,
  currentOrigin: string,
  search: string,
  hash: string
): string | null {
  const origin = renterOrigin.replace(/\/$/, "");
  const here = currentOrigin.replace(/\/$/, "");
  if (!origin || origin === here) return null;

  const url = new URL("/", `${origin}/`);
  const startParam = readRenterStartParam(search, hash, "");
  if (startParam) {
    url.searchParams.set("tgWebAppStartParam", startParam);
  }
  url.hash = hash.startsWith("#") ? hash.slice(1) : hash;
  return url.toString();
}

/**
 * BotFather Mini App pointed at CRM must not show team login.
 * Hall-rental Direct Links carry org UUID in startapp — hand off to tangodb-renter.
 */
export function redirectCrmTelegramToRenterMiniapp(): boolean {
  const startParam = readRenterStartParam(
    window.location.search,
    window.location.hash,
    readTelegramInitData()
  );
  if (!startParam) return false;

  const target = renterMiniappHandoffUrl(
    getRenterMiniappOrigin(),
    window.location.origin,
    window.location.search,
    window.location.hash
  );
  if (!target) return false;

  window.location.replace(target);
  return true;
}
