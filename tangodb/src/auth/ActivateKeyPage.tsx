import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { KeyRound, ShoppingBag } from "lucide-react";
import { DEMO_PURCHASE_PATH } from "../lib/demoLicense";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";
import { useOrganization } from "../organization/OrganizationProvider";
import { useGuestI18n } from "../hooks/useI18n";
import type { I18nKey } from "../lib/i18n/keys";
import {
  AuthButton,
  AuthError,
  AuthField,
  AuthLayout,
  AuthLink,
  AuthSuccess,
} from "./AuthLayout";

function parseActivationError(
  err: unknown,
  t: (key: I18nKey) => string
): string {
  if (!(err instanceof Error)) return t("license.activate.errorGeneric");

  const message = err.message;
  if (message === "Invalid access key") return t("license.activate.invalidKey");
  if (message === "Session expired") return t("license.activate.sessionExpired");
  if (message === "Activation failed") return t("license.activate.serverError");
  if (message.includes("email required")) return t("license.activate.emailRequired");
  if (message === "origin_not_allowed") return t("license.activate.corsError");
  if (message.includes("Edge Function")) return t("license.activate.serviceUnavailable");
  return message;
}

function activationErrorFromBody(body: { error?: string; debug?: string } | null): Error | null {
  if (!body?.error) return null;
  const message = body.debug ? `${body.error}: ${body.debug}` : body.error;
  return new Error(message);
}

export default function ActivateKeyPage() {
  const { t } = useGuestI18n();
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { memberships, organizationId, refreshOrganization } = useOrganization();
  const [key, setKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const hasMembership = memberships.length > 0;
  const crmPath = !hasMembership ? null : organizationId ? "/" : "/select-organization";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke("activate-access-key", {
        body: { key: key.trim().replace(/\s+/g, "") },
      });

      if (fnError) {
        const ctx = (fnError as { context?: Response }).context;
        if (ctx) {
          const body = (await ctx.json().catch(() => null)) as { error?: string; debug?: string } | null;
          const parsedError = activationErrorFromBody(body);
          if (parsedError) throw parsedError;
        }
        throw fnError;
      }

      if (!data?.ok) {
        throw new Error(
          typeof data?.error === "string" ? data.error : t("license.activate.errorGeneric")
        );
      }

      const orgId = typeof data.organization_id === "string" ? data.organization_id : null;
      if (!orgId) {
        throw new Error(t("license.activate.orgNotCreated"));
      }

      setSuccess(t("license.activate.keyAccepted"));
      const { error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) throw refreshError;
      await refreshOrganization();

      navigate(data.upgraded ? "/" : "/onboarding", { replace: true });
    } catch (err) {
      setSuccess(null);
      setError(parseActivationError(err, t));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="TangoDB" subtitle={t("auth.activateKey.subtitle")}>
      <div className="space-y-3 text-sm text-slate-600">
        <div className="flex items-start gap-3 bg-indigo-50 border border-indigo-100 rounded-lg px-3 py-2">
          <KeyRound className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
          <p>{t("auth.activateKey.intro")}</p>
        </div>
        <ul className="text-xs text-slate-500 space-y-1.5 list-disc pl-4">
          <li>{t("auth.activateKey.demoKeyHint")}</li>
          <li>{t("auth.activateKey.lifetimeKeyHint")}</li>
          <li>
            {t("auth.activateKey.purchaseHint")}{" "}
            <Link to={DEMO_PURCHASE_PATH} className="text-indigo-600 hover:underline font-medium">
              {t("demo.purchaseCta")}
            </Link>
            .
          </li>
          <li>{t("auth.activateKey.stripeSoonHint")}</li>
        </ul>
      </div>

      <AuthError message={error} />
      <AuthSuccess message={success} />

      <Link
        to={DEMO_PURCHASE_PATH}
        className="w-full flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold border border-indigo-200 text-indigo-700 hover:bg-indigo-50 transition-colors"
      >
        <ShoppingBag className="w-4 h-4" />
        {t("demo.purchaseCta")}
      </Link>

      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField
          label={t("auth.activateKey.accessKeyLabel")}
          value={key}
          onChange={setKey}
          placeholder="TDB-LIFE-XXXX-XXXX-XXXX"
          required
        />
        <AuthButton loading={loading}>{t("license.activate.submit")}</AuthButton>
      </form>

      <div className="text-sm text-slate-500 text-center space-y-2">
        {crmPath ? (
          <p>
            <AuthLink to={crmPath}>{t("auth.activateKey.goToCrm")}</AuthLink>
          </p>
        ) : (
          <p className="text-xs">{t("auth.activateKey.crmLockedHint")}</p>
        )}
        <p>
          <AuthLink to="/accept-invite">{t("auth.activateKey.hasInvite")}</AuthLink>
          {" · "}
          <button
            type="button"
            onClick={() => void signOut().then(() => navigate("/login", { replace: true }))}
            className="text-indigo-600 hover:text-indigo-700 font-medium cursor-pointer"
          >
            {t("nav.signOut")}
          </button>
        </p>
      </div>
    </AuthLayout>
  );
}
