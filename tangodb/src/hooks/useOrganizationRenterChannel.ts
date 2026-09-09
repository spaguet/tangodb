import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { asJson } from "../lib/json";
import { supabase } from "../lib/supabase";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const organizationRenterChannelQueryKey = ["organizationRenterChannel"] as const;

export type ReceiptNotifyStatus = "bound" | "need_start" | "need_bot_in_group" | "unconfigured";

export interface OrganizationRenterChannel {
  telegramChatUrl: string | null;
  botUsername: string | null;
  telegramBotId: string | null;
  appShortName: string | null;
  tokenSet: boolean;
  tokenLast4: string | null;
  miniappUrl: string | null;
  telegramReceiptChatId: number | null;
  telegramReceiptChatBoundAt: string | null;
  telegramReceiptNotifyStatus: ReceiptNotifyStatus;
}

function mapNotifyStatus(value: unknown): ReceiptNotifyStatus {
  if (
    value === "bound" ||
    value === "need_start" ||
    value === "need_bot_in_group" ||
    value === "unconfigured"
  ) {
    return value;
  }
  return "unconfigured";
}

function mapChannel(row: Record<string, unknown>): OrganizationRenterChannel {
  const chatIdRaw = row.telegram_receipt_chat_id;
  const chatId = chatIdRaw != null && chatIdRaw !== "" ? Number(chatIdRaw) : null;
  return {
    telegramChatUrl: row.telegram_chat_url != null ? String(row.telegram_chat_url) : null,
    botUsername: row.bot_username != null ? String(row.bot_username) : null,
    telegramBotId: row.telegram_bot_id != null ? String(row.telegram_bot_id) : null,
    appShortName: row.app_short_name != null ? String(row.app_short_name) : null,
    tokenSet: Boolean(row.token_set),
    tokenLast4: row.token_last4 != null ? String(row.token_last4) : null,
    miniappUrl: row.miniapp_url != null ? String(row.miniapp_url) : null,
    telegramReceiptChatId: chatId != null && Number.isFinite(chatId) && chatId !== 0 ? chatId : null,
    telegramReceiptChatBoundAt:
      row.telegram_receipt_chat_bound_at != null ? String(row.telegram_receipt_chat_bound_at) : null,
    telegramReceiptNotifyStatus: mapNotifyStatus(row.telegram_receipt_notify_status),
  };
}

export function useOrganizationRenterChannel(enabled = true) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();

  return useQuery({
    queryKey: withOrgId(organizationRenterChannelQueryKey),
    enabled: orgEnabled && enabled,
    queryFn: async (): Promise<OrganizationRenterChannel> => {
      const { data, error } = await supabase.rpc("get_organization_renter_channel");
      if (error) throw error;
      const result = data as Record<string, unknown> | null;
      if (!result?.success) {
        throw new Error(String(result?.error ?? "hallRent.miniapp.error.saveChannel"));
      }
      return mapChannel(result);
    },
    staleTime: 30 * 1000,
  });
}

export function useUpdateOrganizationRenterChannel() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { telegramChatUrl: string; appShortName: string }) => {
      const { data, error } = await supabase.rpc("update_organization_renter_channel", {
        p_payload: asJson({
          telegram_chat_url: input.telegramChatUrl,
          app_short_name: input.appShortName,
        }),
      });
      if (error) return { success: false as const, error: error.message };
      const result = data as Record<string, unknown> | null;
      if (!result?.success) {
        return {
          success: false as const,
          error: String(result?.error ?? "hallRent.miniapp.error.saveChannel"),
        };
      }
      return { success: true as const, channel: mapChannel(result) };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({
          queryKey: organizationRenterChannelQueryKey,
          refetchType: "active",
        });
      }
    },
  });
}

export function useSaveOrganizationRenterBot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { botToken: string; appShortName?: string }) => {
      const { data, error } = await supabase.functions.invoke("renter-telegram-set-bot", {
        body: {
          bot_token: input.botToken,
          app_short_name: input.appShortName || undefined,
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
        return {
          success: false as const,
          error: payload?.error ?? "renter.channel.botSaveFailed",
        };
      }
      return { success: true as const };
    },
    onSuccess: (result) => {
      if (result.success) {
        void queryClient.invalidateQueries({
          queryKey: organizationRenterChannelQueryKey,
          refetchType: "active",
        });
      }
    },
  });
}
