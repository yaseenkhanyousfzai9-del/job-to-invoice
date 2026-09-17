import { useState } from "react";
import { KeyboardAvoidingView, Platform } from "react-native";
import { useRouter } from "expo-router";
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

export default function SignInScreen() {
  const router = useRouter();
  const auth = useAuth();
  const [email, setEmail] = useState(auth.pendingEmail ?? "");
  const [fieldError, setFieldError] = useState<string | undefined>(undefined);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit() {
    const parsed = validateEmail(email);
    if (parsed.error) {
      setFieldError(parsed.error);
      return;
    }
    setFieldError(undefined);
    setSubmitting(true);
    const ok = await auth.sendCode(parsed.display);
    setSubmitting(false);
    if (ok) {
      router.push({ pathname: "/verify", params: { email: parsed.display } });
    }
  }

  const coolingDown = auth.cooldownUntil !== null && Date.now() < auth.cooldownUntil;

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
        />
        <PrimaryButton
          label={coolingDown ? "Wait to resend" : "Send code"}
          onPress={() => void onSubmit()}
          loading={submitting}
          disabled={coolingDown}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
}
