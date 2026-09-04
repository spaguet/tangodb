import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  renterMiniappCorsHeaders,
  SUPABASE_INVOKE_ALLOW_HEADERS,
} from "./renterMiniappHttp.ts";

Deno.test("renterMiniappCorsHeaders allows Mini App origin and supabase-js invoke headers", () => {
  const prev = Deno.env.get("RENTER_MINIAPP_ORIGIN");
  Deno.env.set("RENTER_MINIAPP_ORIGIN", "https://tangodb-renter.vercel.app");
  try {
    const req = new Request("https://example.supabase.co/functions/v1/renter-qr-upload", {
      headers: { Origin: "https://tangodb-renter.vercel.app" },
    });
    const cors = renterMiniappCorsHeaders(req) as Record<string, string> | null;
    assertEquals(cors?.["Access-Control-Allow-Origin"], "https://tangodb-renter.vercel.app");
    assertEquals(cors?.["Access-Control-Allow-Headers"], SUPABASE_INVOKE_ALLOW_HEADERS);
    assertEquals(SUPABASE_INVOKE_ALLOW_HEADERS.includes("x-supabase-api-version"), true);
  } finally {
    if (prev == null) Deno.env.delete("RENTER_MINIAPP_ORIGIN");
    else Deno.env.set("RENTER_MINIAPP_ORIGIN", prev);
  }
});

Deno.test("renterMiniappCorsHeaders denies CRM origin", () => {
  const prev = Deno.env.get("RENTER_MINIAPP_ORIGIN");
  Deno.env.set("RENTER_MINIAPP_ORIGIN", "https://tangodb-renter.vercel.app");
  try {
    const req = new Request("https://example.supabase.co/functions/v1/renter-qr-upload", {
      headers: { Origin: "https://tangodb.vercel.app" },
    });
    assertEquals(renterMiniappCorsHeaders(req), null);
  } finally {
    if (prev == null) Deno.env.delete("RENTER_MINIAPP_ORIGIN");
    else Deno.env.set("RENTER_MINIAPP_ORIGIN", prev);
  }
});
