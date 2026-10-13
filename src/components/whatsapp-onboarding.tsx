"use client";

import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  MessageCircle,
} from "lucide-react";
import Script from "next/script";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import {
  beginWhatsAppSignupAction,
  checkWhatsAppConnectionAction,
  completeWhatsAppSignupAction,
} from "@/app/projects/channels/whatsapp/onboarding-actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseWhatsAppSignupEvent } from "@/lib/whatsapp-signup-events";

type FacebookSdk = {
  init(options: {
    appId: string;
    version: string;
    xfbml: boolean;
    cookie: boolean;
    autoLogAppEvents: boolean;
  }): void;
  login(
    callback: (response: { authResponse?: { code?: string } }) => void,
    options: Record<string, unknown>,
  ): void;
};
type SignupAttempt = {
  state: string;
  pin: string;
  code?: string;
  selection?: { businessAccountId: string; phoneNumberId: string };
  submitting: boolean;
};

export function WhatsAppOnboarding({
  projectId,
  connected,
  settings,
}: {
  projectId: number;
  connected: boolean;
  settings: { appId: string; configId: string; apiVersion: string } | null;
}) {
  const [sdkReady, setSdkReady] = useState(false);
  const [step, setStep] = useState<
    "idle" | "ready" | "meta" | "saving" | "done"
  >("idle");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const attempt = useRef<SignupAttempt | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submit = useRef<() => void>(() => {});
  const isConnected = connected || step === "done";
  const busy = pending || step === "meta" || step === "saving";

  const reset = useCallback((text: string) => {
    attempt.current = null;
    if (timer.current) clearTimeout(timer.current);
    setStep("idle");
    setError(text);
  }, []);

  submit.current = () => {
    const current = attempt.current;
    if (!current?.code || !current.selection || current.submitting) return;
    current.submitting = true;
    if (timer.current) clearTimeout(timer.current);
    setStep("saving");
    startTransition(async () => {
      try {
        const result = await completeWhatsAppSignupAction({
          projectId,
          state: current.state,
          pin: current.pin,
          code: current.code,
          ...current.selection,
        });
        if (attempt.current !== current) return;
        if (result.error) {
          reset(result.error);
          return;
        }
        attempt.current = null;
        setPin("");
        setStep("done");
        setMessage(
          `WhatsApp connected: ${result.displayPhoneNumber}. Send a message from your phone to test Lia.`,
        );
      } catch {
        reset(
          "The connection could not be completed. Please refresh and try again.",
        );
      }
    });
  };

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (!attempt.current || attempt.current.submitting) return;
      const parsed = parseWhatsAppSignupEvent(event.origin, event.data);
      if (!parsed) return;
      if (parsed.kind === "finished") {
        attempt.current.selection = parsed;
        submit.current();
      } else {
        reset(
          parsed.kind === "unsupported"
            ? "Connecting an existing WhatsApp Business mobile app is not supported by this launcher yet. Ask your administrator for help."
            : parsed.kind === "incomplete"
              ? "Meta did not return a selected number. Please reconnect and complete all the steps."
              : "Meta setup was cancelled or could not finish. You can try again.",
        );
      }
    };
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      attempt.current = null;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [reset]);

  function sdk() {
    return (window as Window & { FB?: FacebookSdk }).FB;
  }

  function prepare() {
    if (!/^\d{6}$/.test(pin)) {
      setError("Enter a six-digit security PIN before continuing.");
      return;
    }
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        const result = await beginWhatsAppSignupAction(projectId);
        if (!result.state) {
          reset(result.error ?? "Could not start signup. Please try again.");
          return;
        }
        attempt.current = { state: result.state, pin, submitting: false };
        setStep("ready");
      } catch {
        reset("Could not start signup. Please refresh and try again.");
      }
    });
  }

  function launch() {
    const fb = sdk();
    const current = attempt.current;
    if (!fb || !settings || !current) {
      reset("Meta is not ready. Refresh the page and try again.");
      return;
    }
    setStep("meta");
    // Keep FB.login in the direct click gesture so browsers allow the popup.
    timer.current = setTimeout(
      () => {
        if (attempt.current === current && !current.submitting)
          reset(
            "Meta signup has not completed. Close the Meta window and try again when you are ready.",
          );
      },
      15 * 60 * 1000,
    );
    try {
      fb.login(
        (response) => {
          if (attempt.current !== current || current.submitting) return;
          if (!response.authResponse?.code) {
            reset(
              "Meta setup was cancelled. Your current connection has not changed.",
            );
            return;
          }
          current.code = response.authResponse.code;
          submit.current();
        },
        {
          config_id: settings.configId,
          response_type: "code",
          override_default_response_type: true,
          extras: { setup: {}, sessionInfoVersion: "3" },
        },
      );
    } catch {
      reset(
        "The Meta window could not open. Allow popups for Lia and try again.",
      );
    }
  }

  function checkConnection() {
    setError("");
    setMessage("");
    startTransition(async () => {
      try {
        const result = await checkWhatsAppConnectionAction(projectId);
        if (result.error) setError(result.error);
        else setMessage(result.message ?? "Connection checked.");
      } catch {
        setError("Could not check the connection. Please try again.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <MessageCircle className="h-5 w-5" />
          Connect WhatsApp
        </CardTitle>
        <CardDescription>
          Connect your business number to this project's chatbot using your Meta
          account.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Prepare your business number and security PIN.</li>
          <li>Sign in to Meta, select your business and verify your number.</li>
          <li>Return here and send a message to test your chatbot.</li>
        </ol>
        {!settings ? (
          <output className="block rounded-md bg-muted p-3 text-sm">
            Quick connect is not ready yet. Your Lia administrator needs to
            finish the one-time Meta setup.
          </output>
        ) : (
          <>
            <Script
              id="whatsapp-meta-sdk"
              src="https://connect.facebook.net/en_US/sdk.js"
              strategy="afterInteractive"
              onReady={() => {
                const fb = sdk();
                if (!fb) {
                  setError(
                    "Meta could not load. Check your browser's privacy settings and refresh.",
                  );
                  return;
                }
                fb.init({
                  appId: settings.appId,
                  version: settings.apiVersion,
                  xfbml: false,
                  cookie: false,
                  autoLogAppEvents: false,
                });
                setSdkReady(true);
              }}
              onError={() =>
                setError(
                  "Meta could not load. Check your connection or browser privacy settings, then refresh.",
                )
              }
            />
            <div className="max-w-sm space-y-2">
              <Label htmlFor="whatsapp-security-pin">
                Six-digit WhatsApp security PIN
              </Label>
              <Input
                id="whatsapp-security-pin"
                type="password"
                inputMode="numeric"
                autoComplete="off"
                maxLength={6}
                value={pin}
                onChange={(event) => setPin(event.target.value)}
                disabled={busy || step === "ready"}
                aria-describedby="whatsapp-pin-help"
              />
              <p
                id="whatsapp-pin-help"
                className="text-sm text-muted-foreground"
              >
                For a new number, choose a PIN and keep it safe. For an existing
                API number, use its current PIN. This is separate from Meta's
                verification code.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {step === "ready" ? (
                <Button
                  type="button"
                  onClick={launch}
                  disabled={!sdkReady || busy}
                >
                  <ExternalLink />
                  Continue with Meta
                </Button>
              ) : (
                <Button
                  type="button"
                  onClick={prepare}
                  disabled={!sdkReady || busy}
                >
                  {busy ? (
                    <Loader2 className="animate-spin" />
                  ) : (
                    <MessageCircle />
                  )}
                  {step === "saving"
                    ? "Checking and connecting…"
                    : step === "meta"
                      ? "Complete the steps in Meta…"
                      : isConnected
                        ? "Reconnect WhatsApp"
                        : "Connect WhatsApp"}
                </Button>
              )}
              {(step === "ready" || step === "meta") && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    reset(
                      "Setup stopped. Close the Meta window before starting again.",
                    )
                  }
                >
                  Cancel setup
                </Button>
              )}
            </div>
          </>
        )}
        {isConnected && (
          <Button
            type="button"
            variant="outline"
            onClick={checkConnection}
            disabled={busy}
          >
            <CheckCircle2 />
            Check connection
          </Button>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        {message && (
          <output className="block text-sm text-green-700">{message}</output>
        )}
      </CardContent>
    </Card>
  );
}
