import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, View } from "react-native";
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
import { createVerifyScreenSubmitPolicy } from "../src/lib/verify-screen-submit";
import { useAuth } from "../src/providers/AuthProvider";
import { colors } from "../src/theme/tokens";

export default function VerifyScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const auth = useAuth();
  const [code, setCode] = useState("");
  const [now, setNow] = useState(Date.now());
  const submitPolicy = useRef(createVerifyScreenSubmitPolicy()).current;
  const resendGuard = useRef(false);
  const lastClearedEpoch = useRef(auth.otpInputEpoch);

  useEffect(() => {
    // Countdown UI only — must never call verifyCode / verifyOtp.
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // Any successful OTP send (or remount epoch bump) clears stale digits + verify errors.
    if (auth.otpInputEpoch !== lastClearedEpoch.current) {
      lastClearedEpoch.current = auth.otpInputEpoch;
      setCode("");
      submitPolicy.clearForNewGeneration(auth.otpGeneration);
    }
  }, [auth.otpInputEpoch, auth.otpGeneration, submitPolicy]);

  if (auth.loading) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} accessibilityLabel="Restoring session" />
        </View>
      </Screen>
    );
  }

  if (auth.navigation === "setup") {
    return <Redirect href="/setup" />;
  }
  if (auth.navigation === "app") {
    return <Redirect href="/(app)" />;
  }

  // Cold start must not revive an obsolete /verify route from Expo Router state.
  if (!auth.hasActiveOtpTransaction) {
    return <Redirect href="/sign-in" />;
  }

  const resolved = resolveCanonicalVerifyEmail({
    pendingEmail: auth.pendingEmail,
    routeEmail: params.email,
  });
  const email = resolved.email;
  if (!email) {
    return <Redirect href="/sign-in" />;
  }

  const remaining = auth.cooldownUntil ? Math.max(0, Math.ceil((auth.cooldownUntil - now) / 1000)) : 0;
  const verifyBusy = auth.verifying || submitPolicy.locked;
  const sendBusy = auth.sending || resendGuard.current;

  async function onSubmit() {
    const generation = auth.otpGeneration;
    if (!submitPolicy.canSubmit(generation, auth.verifying, auth.sending)) {
      return;
    }

    // Lock immediately before any async work — one attempt per generation until code edit.
    submitPolicy.beginAttempt(generation, "button");

    try {
      const routeHint =
        typeof params.email === "string"
          ? params.email
          : Array.isArray(params.email)
            ? params.email[0]
            : undefined;
      await auth.verifyCode(routeHint, code);
    } finally {
      submitPolicy.releaseInFlightOnly();
    }
  }

  async function onResend() {
    if (remaining > 0 || auth.verifying || auth.sending || resendGuard.current) {
      return;
    }
    resendGuard.current = true;
    try {
      const ok = await auth.sendCode(email);
      if (ok) {
        setCode("");
      }
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
                  // Bootstrap retry only — must never call verifyCode.
                  void auth.retryBootstrap();
                }
              : undefined
          }
        />
        <Field
          label="6-digit code"
          value={code}
          onChangeText={(value) => {
            const next = value.replace(/\D/g, "").slice(0, 6);
            if (next !== code) {
              submitPolicy.clearForUserCodeEdit();
              auth.clearVerifyAttemptForCodeEdit();
            }
            setCode(next);
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
