import { useCallback } from "react";
import { supabase } from "../lib/supabase";

export interface SelfServiceDemoResult {
  organizationId: string | null;
  recoveryCode: string | null;
  alreadyHasOrg: boolean;
}

export function useSelfServiceDemo() {
  const verifyRegistrationChallenge = useCallback(
    async (email: string, turnstileToken: string): Promise<void> => {
      const { data, error } = await supabase.functions.invoke("verify-self-service-registration", {
        body: { email, turnstile_token: turnstileToken },
      });

      if (error) {
        const ctx = (error as { context?: Response }).context;
        if (ctx) {
          try {
            const body = await ctx.json();
            if (body?.error) throw new Error(body.error);
          } catch (parseErr) {
            if (parseErr instanceof Error && parseErr.message !== error.message) throw parseErr;
          }
        }
        throw error;
      }

      if (data?.error) {
        throw new Error(String(data.error));
      }
    },
    []
  );

  const createDemoOrganization = useCallback(async (): Promise<SelfServiceDemoResult> => {
    const { data, error } = await supabase.functions.invoke("create-self-service-demo-org", {
      body: {},
    });

    if (error) {
      const ctx = (error as { context?: Response }).context;
      if (ctx) {
        try {
          const body = await ctx.json();
          if (body?.error) throw new Error(body.error);
        } catch (parseErr) {
          if (parseErr instanceof Error && parseErr.message !== error.message) throw parseErr;
        }
      }
      throw error;
    }

    if (data?.error) {
      throw new Error(String(data.error));
    }

    return {
      organizationId: typeof data?.organization_id === "string" ? data.organization_id : null,
      recoveryCode: typeof data?.recovery_code === "string" ? data.recovery_code : null,
      alreadyHasOrg: Boolean(data?.already_has_org),
    };
  }, []);

  return { verifyRegistrationChallenge, createDemoOrganization };
}
