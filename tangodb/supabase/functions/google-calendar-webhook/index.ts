import { createServiceClient, logEvent } from "../_shared/supabase.ts";
import { constantTimeEqual, lookupWatchChannel } from "../_shared/googleCalendarWatch.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(null, { status: 405 });
  }

  const channelId = (req.headers.get("X-Goog-Channel-ID") ?? "").trim();
  const resourceId = (req.headers.get("X-Goog-Resource-ID") ?? "").trim();
  const channelToken = req.headers.get("X-Goog-Channel-Token") ?? "";
  const resourceState = (req.headers.get("X-Goog-Resource-State") ?? "").trim();

  if (!channelId || !resourceId) {
    return new Response(null, { status: 400 });
  }

  const admin = createServiceClient();

  try {
    const watch = await lookupWatchChannel(admin, channelId);
    if (!watch) {
      logEvent("gcal_webhook_unknown_channel", { channel_id: channelId });
      return new Response(null, { status: 404 });
    }

    // Lookup is already by channel_id; comparing it to itself is a no-op (S38/L4).
    if (!constantTimeEqual(watch.resource_id, resourceId)) {
      return new Response(null, { status: 403 });
    }
    if (!constantTimeEqual(watch.channel_token, channelToken)) {
      return new Response(null, { status: 403 });
    }

    if (resourceState === "sync") {
      const bindingId =
        watch.binding_kind === "member"
          ? watch.member_binding_id
          : watch.organization_binding_id;

      if (bindingId) {
        const { error } = await admin.rpc("enqueue_binding_incremental_sync", {
          p_binding_kind: watch.binding_kind,
          p_binding_id: bindingId,
        });

        if (error) {
          logEvent("gcal_webhook_enqueue_error", {
            channel_id: channelId,
            message: error.message,
          });
        }
      }
    }

    if (resourceState === "not_exists") {
      logEvent("gcal_webhook_channel_expired", {
        channel_id: channelId,
        binding_kind: watch.binding_kind,
      });
    }
  } catch (err) {
    logEvent("gcal_webhook_error", {
      channel_id: channelId,
      message: err instanceof Error ? err.message : "unknown",
    });
    return new Response(null, { status: 500 });
  }

  return new Response(null, { status: 200 });
});
