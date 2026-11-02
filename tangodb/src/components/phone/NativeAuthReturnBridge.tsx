import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { App } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { isNativeCrmShell } from "../../lib/platform";
import { NATIVE_AUTH_RETURN_FAILED_EVENT } from "../../lib/nativeAuthHandoff";
import { consumeNativeAuthReturn } from "../../lib/nativeAuthReturn";

/** Catches tangodb://auth-return while the login screen is still showing. */
export default function NativeAuthReturnBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    if (!isNativeCrmShell()) return;
    let cancelled = false;

    const handle = (url: string) => {
      void consumeNativeAuthReturn(url).then((result) => {
        if (cancelled || result === "ignored") return;
        void Browser.close().catch(() => undefined);
        if (result === "ok") {
          navigate("/", { replace: true });
          return;
        }
        window.dispatchEvent(new Event(NATIVE_AUTH_RETURN_FAILED_EVENT));
      });
    };

    const listener = App.addListener("appUrlOpen", (event) => {
      handle(event.url);
    });
    void App.getLaunchUrl().then((launch) => {
      if (launch?.url) handle(launch.url);
    });

    return () => {
      cancelled = true;
      void listener.then((handle) => handle.remove());
    };
  }, [navigate]);

  return null;
}
