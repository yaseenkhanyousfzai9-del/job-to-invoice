import { useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { validateEmail } from "@job-to-invoice/domain";
import {
  Body,
  ErrorBanner,
  Field,
  PrimaryButton,
  Screen,
  Secondary,
  Title,
} from "../src/components/ui";
import { useAuth } from "../src/providers/AuthProvider";
import { colors } from "../src/theme/tokens";

export default function SignInScreen() {
  const router = useRouter();
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const submitGuard = useRef(false);

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
  if (auth.navigation === "suspended") {
    return <Redirect href="/suspended" />;
  }

  async function onSubmit() {
    if (submitGuard.current || auth.sending) {
      return;
    }
    const parsed = validateEmail(email);
    if (parsed.error) {
      setFieldError(parsed.error);
      return;
    }
    setFieldError(undefined);
    submitGuard.current = true;
    try {
      const ok = await auth.sendCode(parsed.display);
      if (ok) {
        // Params are a fallback only; AuthProvider.pendingEmail is authoritative for verify.
        router.replace({ pathname: "/verify", params: { email: parsed.display } });
      }
    } finally {
      submitGuard.current = false;
    }
  }

  const coolingDown = auth.cooldownUntil !== null && Date.now() < auth.cooldownUntil;
  const busy = auth.sending || submitGuard.current;

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, gap: 12 }}>
        <Title>Sign in</Title>
        <Body>We’ll email a one-time code. There is no password.</Body>
        <Secondary>
          The same flow creates an account or signs you in. We will not tell you whether the email
          already exists.
        </Secondary>
        <ErrorBanner message={auth.error} />
        <Field
          label="Email"
          value={email}
          onChangeText={(value) => {
            setEmail(value);
            setFieldError(undefined);
            auth.clearError();
          }}
          error={fieldError}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          placeholder="you@business.com"
          editable={!auth.sending}
        />
        <PrimaryButton
          label={auth.sending ? "Sending…" : coolingDown ? "Wait to resend" : "Send code"}
          onPress={() => void onSubmit()}
          loading={auth.sending}
          disabled={coolingDown || busy || auth.sending}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}
