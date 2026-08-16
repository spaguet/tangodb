import { useQuery } from "@tanstack/react-query";
import { paymentEffectiveAmount } from "../lib/paymentCorrection";
import type { PaymentWithCorrectionMeta } from "../lib/paymentCorrection";
import { supabase } from "../lib/supabase";
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

function netPaidForCharge(
  chargeId: string,
  payments: PaymentWithCorrectionMeta[]
): number {
  return payments
    .filter((p) => p.personalLessonChargeId === chargeId)
    .reduce((sum, p) => sum + paymentEffectiveAmount(p), 0);
}

export function usePersonalLessonChargeBalances(
  lessonIds: string[],
  options?: { enabled?: boolean }
) {
  const { enabled: orgEnabled, withOrgId } = useOrgQueryScope();
  const sortedIds = [...lessonIds].sort().join(",");
  const queryEnabled = orgEnabled && (options?.enabled ?? true) && lessonIds.length > 0;

  return useQuery({
    queryKey: withOrgId([...personalLessonChargesQueryKey, sortedIds]),
    enabled: queryEnabled,
    queryFn: async (): Promise<PersonalLessonChargeBalance[]> => {
      const { data: chargeRows, error: chargeError } = await supabase
        .from("personal_lesson_charges")
        .select(CHARGES_SELECT)
        .in("personal_lesson_id", lessonIds);

      if (chargeError) throw chargeError;
      const charges = chargeRows ?? [];
      if (!charges.length) return [];

      const chargeIds = charges.map((c) => String(c.id));

      const { data: paymentRows, error: paymentError } = await supabase
        .from("payments")
        .select("id, amount, operation_kind, personal_lesson_charge_id")
        .in("personal_lesson_charge_id", chargeIds);

      if (paymentError) throw paymentError;

      const payments = (paymentRows ?? []).map((row) => ({
        amount: Number(row.amount) || 0,
        operationKind: (row.operation_kind as PaymentWithCorrectionMeta["operationKind"]) ?? "payment",
        personalLessonChargeId:
          row.personal_lesson_charge_id != null ? String(row.personal_lesson_charge_id) : null,
      }));

      return charges.map((row) => {
        const id = String(row.id);
        const billedAmount = Number(row.billed_amount) || 0;
        const paidAmount = netPaidForCharge(id, payments);
        const remainingAmount = Math.max(billedAmount - paidAmount, 0);
        return {
          id,
          personalLessonId: String(row.personal_lesson_id),
          clientId: String(row.client_id),
          billedAmount,
          paidAmount,
          remainingAmount,
        };
      });
    },
    staleTime: 30 * 1000,
  });
}
