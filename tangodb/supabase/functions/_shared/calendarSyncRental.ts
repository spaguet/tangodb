/**
 * Hall-rental sync for calendar-sync-worker (GCAL-5).
 * Writes only to the organization binding with purpose=rentals.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildRentalGoogleEvent,
  googleEventIdFromUuid,
  hashGoogleEventPayload,
} from "./calendarSyncPayload.ts";
import {
  type OutboxJob,
  siteUrl,
  nestedName,
  markJobDone,
  loadOrgContext,
  loadActiveOrgBinding,
  loadLinksForSource,
  deleteGoogleEventForLink,
  deleteLinkRow,
  maybeClearOrgBindingCleanup,
  removeStaleRecipientLinks,
  upsertOrgLinkRow,
  recordOrgBindingSuccess,
  syncEventToGoogle,
  handleSyncJobError,
  type EventLinkRow,
} from "./calendarSyncCommon.ts";
import { logEvent } from "./supabase.ts";
import type { GoogleOAuthConfig } from "./googleOAuth.ts";

type RentalRow = {
  id: string;
  organization_id: string;
  rental_date: string;
  time_start: string;
  time_end: string;
  booking_status: string;
  purpose: string | null;
  locations: { name: string } | { name: string }[] | null;
  renters: { display_name: string } | { display_name: string }[] | null;
};

function nestedRenterName(
  value: RentalRow["renters"]
): string {
  if (!value) return "";
  if (Array.isArray(value)) return value[0]?.display_name ?? "";
  return value.display_name ?? "";
}

async function loadRental(
  admin: SupabaseClient,
  organizationId: string,
  rentalId: string
): Promise<RentalRow | null> {
  const { data } = await admin
    .from("rentals")
    .select(
      "id, organization_id, rental_date, time_start, time_end, booking_status, purpose, locations(name), renters(display_name)"
    )
    .eq("organization_id", organizationId)
    .eq("id", rentalId)
    .maybeSingle();

  return (data as RentalRow | null) ?? null;
}

function rentalOccupiesHall(rental: RentalRow): boolean {
  return rental.booking_status === "confirmed";
}

function findOrgLink(
  links: EventLinkRow[],
  bindingId: string,
  occurrenceDate: string
): EventLinkRow | null {
  return (
    links.find(
      (link) =>
        link.recipient_kind === "organization" &&
        link.organization_binding_id === bindingId &&
        link.occurrence_date === occurrenceDate &&
        link.sync_status !== "detached"
    ) ?? null
  );
}

function hasDetachedOrgLink(
  links: EventLinkRow[],
  bindingId: string,
  occurrenceDate: string
): boolean {
  return links.some(
    (link) =>
      link.recipient_kind === "organization" &&
      link.organization_binding_id === bindingId &&
      link.occurrence_date === occurrenceDate &&
      link.sync_status === "detached"
  );
}

export async function deleteRental(
  admin: SupabaseClient,
  config: GoogleOAuthConfig,
  job: OutboxJob
): Promise<void> {
  if (!job.occurrence_date) {
    await markJobDone(admin, job.id);
    return;
  }

  const links = (await loadLinksForSource(
    admin,
    job.organization_id,
    "rental",
    job.source_id
  )).filter((link) => link.occurrence_date === job.occurrence_date);

  for (const link of links) {
    await deleteGoogleEventForLink(admin, config, link);
    await deleteLinkRow(admin, link.id);
    if (link.organization_binding_id) {
      await maybeClearOrgBindingCleanup(
        admin,
        job.organization_id,
        link.organization_binding_id
      );
    }
  }

  await markJobDone(admin, job.id);
  logEvent("gcal_sync_delete_done", {
    organization_id: job.organization_id,
    source_type: job.source_type,
    source_id: job.source_id,
    occurrence_date: job.occurrence_date,
  });
}

export async function upsertRental(
  admin: SupabaseClient,
  config: GoogleOAuthConfig,
  job: OutboxJob
): Promise<void> {
  if (!job.occurrence_date) {
    await markJobDone(admin, job.id);
    return;
  }

  const occurrenceDate = job.occurrence_date;
  const rental = await loadRental(admin, job.organization_id, job.source_id);

  if (!rental || !rentalOccupiesHall(rental)) {
    await deleteRental(admin, config, job);
    return;
  }

  const orgBinding = await loadActiveOrgBinding(admin, job.organization_id, "rentals");
  const allLinks = await loadLinksForSource(
    admin,
    job.organization_id,
    "rental",
    rental.id
  );

  if (!orgBinding) {
    await markJobDone(admin, job.id);
    return;
  }

  await removeStaleRecipientLinks(admin, config, allLinks, {
    occurrenceDate,
    memberBindingId: null,
    organizationBindingId: orgBinding.id,
  });

  if (hasDetachedOrgLink(allLinks, orgBinding.id, occurrenceDate)) {
    await markJobDone(admin, job.id);
    return;
  }

  const orgContext = await loadOrgContext(admin, rental.organization_id);
  const payload = buildRentalGoogleEvent({
    rentalId: rental.id,
    organizationId: rental.organization_id,
    rentalDate: rental.rental_date,
    timeStart: rental.time_start,
    timeEnd: rental.time_end,
    timeZone: orgContext.timezone,
    renterName: nestedRenterName(rental.renters),
    purpose: rental.purpose,
    locationName: nestedName(rental.locations),
    organizationName: orgContext.organizationName,
    scheduleUrl: `${siteUrl()}/schedule`,
  });
  const desiredHash = await hashGoogleEventPayload(payload);
  const deterministicEventId = googleEventIdFromUuid(rental.id);
  const currentLink = findOrgLink(allLinks, orgBinding.id, occurrenceDate);

  if (currentLink?.desired_hash === desiredHash && currentLink.sync_status === "synced") {
    await markJobDone(admin, job.id);
    return;
  }

  try {
    const { eventId, etag } = await syncEventToGoogle(
      admin,
      config,
      orgBinding,
      payload,
      desiredHash,
      deterministicEventId,
      currentLink
    );

    await upsertOrgLinkRow(admin, {
      organizationId: rental.organization_id,
      organizationBindingId: orgBinding.id,
      sourceType: "rental",
      sourceId: rental.id,
      occurrenceDate,
      googleEventId: eventId,
      googleEtag: etag,
      desiredHash,
    });
    await recordOrgBindingSuccess(admin, orgBinding.id);

    logEvent("gcal_sync_upsert_done", {
      organization_id: rental.organization_id,
      source_type: "rental",
      source_id: rental.id,
      occurrence_date: occurrenceDate,
      recipient_kind: "organization",
      link_status: "synced",
    });
    await markJobDone(admin, job.id);
  } catch (err) {
    await handleSyncJobError(admin, job, null, orgBinding.id, currentLink, err);
    logEvent("gcal_sync_job_error", {
      organization_id: job.organization_id,
      source_type: job.source_type,
      source_id: job.source_id,
      error_code: err instanceof Error ? err.message : "sync_failed",
      http_status: null,
    });
  }
}
