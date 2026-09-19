import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { Redirect, useRouter } from "expo-router";
import {
  Body,
  ErrorBanner,
  Field,
  PrimaryButton,
  Screen,
  Secondary,
  Title,
} from "../../src/components/ui";
import {
  firstSetupStep3Error,
  isSetupStep3CreateEnabled,
  runSetupStep3Create,
} from "../../src/features/setup/setupDefaultsForm";
import { DomainApiError, createWorkspace } from "../../src/lib/api";
import { createClientUuid } from "../../src/lib/clientUuid";
import { useAuth } from "../../src/providers/AuthProvider";
import { useSetupDraft } from "../../src/providers/SetupDraftProvider";

export default function SetupDefaultsScreen() {
  const router = useRouter();
  const auth = useAuth();
  const { draft, update } = useSetupDraft();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const createEnabled = isSetupStep3CreateEnabled(draft);

  if (auth.navigation === "app") {
    return <Redirect href="/(app)" />;
  }

  async function onSubmit() {
    const result = runSetupStep3Create(draft);
    setErrors(result.errors);
    if (!result.canSubmit || !result.body) {
      setFormError(firstSetupStep3Error(result.errors) ?? "Fix the highlighted fields to continue.");
      return;
    }
    if (!auth.accessToken) {
      setFormError("Sign in to continue.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await createWorkspace(auth.accessToken, result.body, createClientUuid());
      await auth.refreshMe();
      router.replace("/(app)");
    } catch (cause) {
      if (cause instanceof DomainApiError) {
        if (cause.api.code === "WORKSPACE_EXISTS") {
          await auth.refreshMe();
          router.replace("/(app)");
          return;
        }
        const firstField = Object.values(cause.api.field_errors)[0]?.[0];
        setFormError(firstField ?? cause.api.message);
      } else {
        setFormError("Could not save your business setup.");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ gap: 12 }}>
          <Title>Defaults</Title>
          <Body>
            Step 3 of 3. Confirm timezone and document defaults. Currency is USD and cannot be changed.
          </Body>
          <Secondary>Optional logo upload is skipped in this slice.</Secondary>
          <Field
            label="Business timezone"
            value={draft.timezone}
            onChangeText={(value) => update({ timezone: value, timezone_confirmed: false })}
            error={errors["timezone"]}
          />
          <PrimaryButton
            label={draft.timezone_confirmed ? "Timezone confirmed" : "Confirm this timezone"}
            onPress={() => {
              update({ timezone_confirmed: true });
              setErrors((current) => {
                const next = { ...current };
                delete next["timezone"];
                return next;
              });
              setFormError(null);
            }}
          />
          {!createEnabled ? (
            <Secondary>Tap “Confirm this timezone” before Create workspace.</Secondary>
          ) : null}
          <Field
            label="Default tax (basis points)"
            value={draft.default_tax_bp}
            onChangeText={(value) => update({ default_tax_bp: value })}
            error={errors["default_tax_bp"]}
            keyboardType="number-pad"
          />
          <Secondary>0 means no default tax. This is not tax advice.</Secondary>
          <Field
            label="Default due days"
            value={draft.default_due_days}
            onChangeText={(value) => update({ default_due_days: value })}
            error={errors["default_due_days"]}
            keyboardType="number-pad"
          />
          <Field
            label="Default terms (optional)"
            value={draft.default_terms}
            onChangeText={(value) => update({ default_terms: value })}
            error={errors["default_terms"]}
          />
          <ErrorBanner message={formError} />
          <PrimaryButton
            label="Create workspace"
            onPress={() => void onSubmit()}
            loading={submitting}
            disabled={!createEnabled}
          />
        </KeyboardAvoidingView>
      </ScrollView>
    </Screen>
  );
}
