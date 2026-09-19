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
import { useAuth } from "../src/providers/AuthProvider";

export default function VerifyScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ email?: string }>();
  const auth = useAuth();
  const email = params.email ?? auth.pendingEmail ?? "";
  const [code, setCode] = useState("");
  const [now, setNow] = useState(Date.now());
  const submitGuard = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);

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
  const busy = auth.verifying || submitGuard.current;

  async function onSubmit() {
    if (submitGuard.current || auth.verifying) {
      return;
    }
    submitGuard.current = true;
    try {
      await auth.verifyCode(email, code.trim());
    } finally {
      submitGuard.current = false;
    }
  }

  async function onResend() {
    if (remaining > 0 || auth.verifying) {
      return;
    }
    await auth.sendCode(email);
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
          editable={!auth.verifying}
        />
        <PrimaryButton
          label={auth.verifying ? "Verifying…" : "Verify code"}
          onPress={() => void onSubmit()}
          loading={auth.verifying}
          disabled={code.length !== 6 || auth.verifying || busy}
        />
        <PrimaryButton
          label={remaining > 0 ? `Resend in ${remaining}s` : "Resend code"}
          onPress={() => void onResend()}
          disabled={remaining > 0 || auth.verifying}
        />
        <TextLink label="Change email" onPress={() => router.replace("/sign-in")} />
      </KeyboardAvoidingView>
    </Screen>
  );
}
