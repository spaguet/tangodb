import { Component, type ReactNode } from "react";
import { reportClientError } from "../../lib/reportClientError";
import { useI18n } from "../../hooks/useI18n";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

function DefaultErrorFallback() {
  const { t } = useI18n();

  return (
    <div className="p-6 text-center text-rose-600">
      <p className="font-semibold">{t("common.error.boundaryTitle")}</p>
      <p className="text-xs text-slate-500 mt-1">{t("common.error.boundaryHint")}</p>
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    reportClientError(error, {
      area: "boundary",
      action: "ErrorBoundary",
      meta: { componentStack: info.componentStack },
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback ?? <DefaultErrorFallback />
      );
    }
    return this.props.children;
  }
}
