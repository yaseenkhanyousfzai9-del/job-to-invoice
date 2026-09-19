import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { maskEmail } from "@job-to-invoice/domain";
import {
  Body,
  ErrorBanner,
  Field,
  PrimaryButton,
  Screen,
  Secondary,
  TextLink,
  Title,
} from "../src/components/ui";
import { resolveCanonicalVerifyEmail } from "../src/lib/otp-request-state";
import { useAuth } from "../src/providers/AuthProvider";

export default function VerifyScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const auth = useAuth();
  const resolved = resolveCanonicalVerifyEmail({
    pendingEmail: auth.pendingEmail,
    routeEmail: params.email,
  });
  const email = resolved.email;
  const [code, setCode] = useState("");
  const [now, setNow] = useState(Date.now());
  const submitGuard = useRef(false);
  const resendGuard = useRef(false);
  const lastClearedGeneration = useRef(0);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (auth.otpGeneration > 0 && auth.otpGeneration !== lastClearedGeneration.current) {
      lastClearedGeneration.current = auth.otpGeneration;
      setCode("");
    }
  }, [auth.otpGeneration]);

  if (auth.navigation === "setup") {
    return <Redirect href="/setup" />;
  }
  if (auth.navigation === "app") {
    return <Redirect href="/(app)" />;
  }
  if (!email) {
    return <Redirect href="/sign-in" />;
  }

  const remaining = auth.cooldownUntil ? Math.max(0, Math.ceil((auth.cooldownUntil - now) / 1000)) : 0;
  const verifyBusy = auth.verifying || submitGuard.current;
  const sendBusy = auth.sending || resendGuard.current;

  async function onSubmit() {
    if (submitGuard.current || auth.verifying || auth.sending) {
      return;
    }
    submitGuard.current = true;
    try {
      // AuthProvider resolves pendingEmail over route; pass route only as hint.
      const routeHint =
        typeof params.email === "string"
          ? params.email
          : Array.isArray(params.email)
            ? params.email[0]
            : undefined;
      await auth.verifyCode(routeHint, code);
    } finally {
      submitGuard.current = false;
    }
  }

  async function onResend() {
    if (remaining > 0 || auth.verifying || auth.sending || resendGuard.current) {
      return;
    }
    resendGuard.current = true;
    try {
      // Resend to the canonical latest-send email, not a stale route param.
      await auth.sendCode(email);
    } finally {
      resendGuard.current = false;
    }
  }

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, gap: 12 }}>
        <Title>Enter code</Title>
        <Body>{`We sent a 6-digit code to ${maskEmail(email)}.`}</Body>
        <Secondary>{auth.codeSentMessage ?? "The message is the same whether or not an account already exists."}</Secondary>
        <ErrorBanner
          message={auth.error}
          onRetry={
            auth.bootstrapRetryable
              ? () => {
                  void auth.retryBootstrap();
                }
              : undefined
          }
        />
        <Field
          label="6-digit code"
          value={code}
          onChangeText={(value) => {
            setCode(value.replace(/\D/g, "").slice(0, 6));
            auth.clearError();
          }}
          keyboardType="number-pad"
          autoComplete="one-time-code"
          textContentType="oneTimeCode"
          maxLength={6}
          editable={!auth.verifying && !auth.sending}
        />
        <PrimaryButton
          label={auth.verifying ? "Verifying…" : "Verify code"}
          onPress={() => void onSubmit()}
          loading={auth.verifying}
          disabled={code.length !== 6 || auth.verifying || verifyBusy || auth.sending}
        />
        <PrimaryButton
          label={
            auth.sending
              ? "Sending…"
              : remaining > 0
                ? `Resend in ${remaining}s`
                : "Resend code"
          }
          onPress={() => void onResend()}
          loading={auth.sending}
          disabled={remaining > 0 || auth.verifying || sendBusy || auth.sending}
        />
        <TextLink label="Change email" onPress={() => router.replace("/sign-in")} />
      </KeyboardAvoidingView>
    </Screen>
  );
}
