import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { asJson } from "../lib/json";
import { supabase } from "../lib/supabase";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const organizationRentalQrQueryKey = ["organizationRentalQr"] as const;

export interface OrganizationRentalQrAsset {
  id: string;
  label: string | null;
  mimeType: string;
  isActive: boolean;
  storagePath: string;
  signedUrl: string | null;
  createdAt: string;
}

function mapAsset(row: Record<string, unknown>): OrganizationRentalQrAsset {
  return {
    id: String(row.id),
    label: row.label != null ? String(row.label) : null,
    mimeType: String(row.mime_type ?? ""),
    isActive: Boolean(row.is_active),
    storagePath: String(row.storage_path ?? ""),
    signedUrl: row.signed_url != null ? String(row.signed_url) : null,
    createdAt: String(row.created_at ?? ""),
  };
}

export function useOrganizationRentalQrAssets(enabled = true) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId(organizationRentalQrQueryKey),
    enabled: orgEnabled && enabled,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_organization_rental_qr_assets");
      if (error) throw error;
      const result = data as {
        success?: boolean;
        error?: string;
        assets?: Record<string, unknown>[];
      } | null;
      if (!result?.success) {
        throw new Error(result?.error ?? "hallRent.miniapp.error.qrUpload");
      }
      return (result.assets ?? []).map(mapAsset);
    },
    staleTime: 15 * 1000,
  });
}

export function useUploadOrganizationRentalQr() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      label: string;
      isActive: boolean;
      filename: string;
      contentBase64: string;
    }) => {
      const { data, error } = await supabase.functions.invoke("renter-qr-upload", {
        body: {
          label: input.label,
          is_active: input.isActive,
          filename: input.filename,
          content_base64: input.contentBase64,
        },
      });

      if (error) {
        const ctx = (error as { context?: Response }).context;
        if (ctx) {
          try {
            const payload = (await ctx.json()) as { error?: string };
            if (payload.error) {
              return { success: false as const, error: payload.error };
            }
          } catch (parseError) {
            if (parseError instanceof Error && parseError.message !== error.message) {
              return { success: false as const, error: parseError.message };
            }
          }
        }
        return { success: false as const, error: error.message };
      }

      const payload = data as { success?: boolean; error?: string } | null;
      if (!payload?.success) {
        return { success: false as const, error: payload?.error ?? "renter.qr.uploadFailed" };
      }
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({
          queryKey: organizationRentalQrQueryKey,
          refetchType: "active",
        });
      }
    },
  });
}

export function useUpdateOrganizationRentalQr() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { id: string; label?: string; isActive?: boolean }) => {
      const { data, error } = await supabase.rpc("update_organization_rental_qr_asset", {
        p_payload: asJson({
          id: input.id,
          label: input.label,
          is_active: input.isActive,
        }),
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as { success?: boolean; error?: string } | null;
      if (!result?.success) {
        return { success: false as const, error: result?.error ?? "hallRent.miniapp.error.qrUpdate" };
      }
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({
          queryKey: organizationRentalQrQueryKey,
          refetchType: "active",
        });
      }
    },
  });
}

export function useDeleteOrganizationRentalQr() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.functions.invoke("renter-qr-upload", {
        body: { action: "delete", id },
      });
      if (error) {
        const ctx = (error as { context?: Response }).context;
        if (ctx) {
          try {
            const payload = (await ctx.json()) as { error?: string };
            if (payload.error) {
              return { success: false as const, error: payload.error };
            }
          } catch (parseError) {
            if (parseError instanceof Error && parseError.message !== error.message) {
              return { success: false as const, error: parseError.message };
            }
          }
        }
        return { success: false as const, error: error.message };
      }
      const payload = data as { success?: boolean; error?: string } | null;
      if (!payload?.success) {
        return { success: false as const, error: payload?.error ?? "hallRent.miniapp.error.qrDelete" };
      }
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({
          queryKey: organizationRentalQrQueryKey,
          refetchType: "active",
        });
      }
    },
  });
}
