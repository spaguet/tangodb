import { useEffect, useState } from "react";

/** Stable idempotency key for the lifetime of an open payment form. */
export function usePaymentFormIdempotency(active: boolean) {
  const [idempotencyKey, setIdempotencyKey] = useState("");

  useEffect(() => {
    if (active) {
      setIdempotencyKey(crypto.randomUUID());
    }
  }, [active]);

  return idempotencyKey;
}

export type PaymentSubmitPhase = "idle" | "saving" | "saved";

export function usePaymentSubmitState() {
  const [phase, setPhase] = useState<PaymentSubmitPhase>("idle");
  const [operationNumber, setOperationNumber] = useState<number | null>(null);

  const begin = () => setPhase("saving");
  const complete = (opNum?: number | null) => {
    setOperationNumber(opNum ?? null);
    setPhase("saved");
  };
  const reset = () => {
    setPhase("idle");
    setOperationNumber(null);
  };

  return { phase, operationNumber, begin, complete, reset };
}
