import { useQuery } from "@tanstack/react-query";
import { paymentEffectiveAmount } from "../lib/paymentCorrection";
import type { PaymentWithCorrectionMeta } from "../lib/paymentCorrection";
import { fetchAllPostgrestRows } from "../lib/postgrestRange";
import { supabase } from "../lib/supabase";
import { useOrganization } from "../organization/OrganizationProvider";
import { useOrgQueryScope } from "./useOrgQueryScope";

export const personalLessonChargesQueryKey = ["personalLessonCharges"] as const;

export interface PersonalLessonChargeBalance {
  id: string;
  personalLessonId: string;
  clientId: string;
  billedAmount: number;
  paidAmount: number;
  remainingAmount: number;
}

const CHARGES_SELECT = "id, personal_lesson_id, client_id, billed_amount";

type ChargePaymentSlice = Pick<
  PaymentWithCorrectionMeta,
  "amount" | "operationKind" | "personalLessonChargeId"
> & {
  personalLessonId: string | null;
  clientId: string;
};

function netPaidForCharge(
  charge: { id: string; personalLessonId: string; clientId: string },
  payments: ChargePaymentSlice[]
): number {
  return payments
    .filter((payment) => {
      if (payment.personalLessonChargeId === charge.id) return true;
      return (
        payment.personalLessonChargeId == null &&
        payment.personalLessonId === charge.personalLessonId &&
        payment.clientId === charge.clientId
      );
    })
    .reduce((sum, payment) => sum + paymentEffectiveAmount(payment), 0);
}

type RpcChargeRow = {
  id?: unknown;
  personal_lesson_id?: unknown;
  client_id?: unknown;
  billed_amount?: unknown;
  paid_amount?: unknown;
  remaining_amount?: unknown;
};

async function fetchChargeBalancesViaRpc(
  lessonIds: string[]
): Promise<PersonalLessonChargeBalance[]> {
  const { data, error } = await supabase.rpc("get_personal_lesson_charge_balances", {
    p_lesson_ids: lessonIds,
  });
  if (error) throw error;

  const result = data as {
    success?: boolean;
    error_code?: string;
    charges?: RpcChargeRow[];
  } | null;
  if (!result?.success) {
    throw new Error(result?.error_code ?? "personal_lesson_charges_failed");
  }

  return (result.charges ?? []).map((row) => {
    const remainingAmount = Number(row.remaining_amount) || 0;
    const billedAmount =
      row.billed_amount != null ? Number(row.billed_amount) || 0 : 0;
    const paidAmount =
      row.paid_amount != null
        ? Number(row.paid_amount) || 0
        : Math.max(billedAmount - remainingAmount, 0);

    return {
      id: String(row.id),
      personalLessonId: String(row.personal_lesson_id),
      clientId: String(row.client_id),
      billedAmount,
      paidAmount,
      remainingAmount,
    };
  });
}

async function fetchChargeBalancesViaRest(
  lessonIds: string[]
): Promise<PersonalLessonChargeBalance[]> {
  const chargeRows = await fetchAllPostgrestRows((from, to) =>
    supabase
      .from("personal_lesson_charges")
      .select(CHARGES_SELECT)
      .in("personal_lesson_id", lessonIds)
      .range(from, to)
  );

  const charges = chargeRows ?? [];
  if (!charges.length) return [];

  const paymentRows = await fetchAllPostgrestRows((from, to) =>
    supabase
      .from("payments")
      .select(
        "id, amount, operation_kind, personal_lesson_charge_id, personal_lesson_id, client_id"
      )
      .in("personal_lesson_id", lessonIds)
      .range(from, to)
  );

  const payments = paymentRows.map((row) => ({
    amount: Number(row.amount) || 0,
    operationKind: (row.operation_kind as PaymentWithCorrectionMeta["operationKind"]) ?? "payment",
    personalLessonChargeId:
      row.personal_lesson_charge_id != null ? String(row.personal_lesson_charge_id) : null,
    personalLessonId: row.personal_lesson_id != null ? String(row.personal_lesson_id) : null,
    clientId: String(row.client_id ?? ""),
  }));

  return charges.map((row) => {
    const id = String(row.id);
    const billedAmount = Number(row.billed_amount) || 0;
    const personalLessonId = String(row.personal_lesson_id);
    const clientId = String(row.client_id);
    const paidAmount = netPaidForCharge({ id, personalLessonId, clientId }, payments);
    const remainingAmount = Math.max(billedAmount - paidAmount, 0);
    return {
      id,
      personalLessonId,
      clientId,
      billedAmount,
      paidAmount,
      remainingAmount,
    };
  });
}

export function usePersonalLessonChargeBalances(
  lessonIds: string[],
  options?: { enabled?: boolean }
) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const { role } = useOrganization();
  const useRpc = role === "teacher";
  const sortedIds = [...lessonIds].sort().join(",");
  const queryEnabled = orgEnabled && (options?.enabled ?? true) && lessonIds.length > 0;

  return useQuery({
    queryKey: withOrgId([...personalLessonChargesQueryKey, sortedIds, { useRpc }]),
    enabled: queryEnabled,
    queryFn: async (): Promise<PersonalLessonChargeBalance[]> => {
      if (useRpc) return fetchChargeBalancesViaRpc(lessonIds);
      return fetchChargeBalancesViaRest(lessonIds);
    },
    staleTime: 15 * 1000,
  });
}
