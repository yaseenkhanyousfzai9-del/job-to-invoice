import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { Redirect, useRouter } from "expo-router";
import {
  validateSetupStep3,
  workspaceCreateBodyFromDraft,
} from "@job-to-invoice/domain";
import {
  Body,
  ErrorBanner,
  Field,
  PrimaryButton,
  Screen,
  Secondary,
  Title,
} from "../../src/components/ui";
import { DomainApiError, createWorkspace } from "../../src/lib/api";
import { useAuth } from "../../src/providers/AuthProvider";
import { useSetupDraft } from "../../src/providers/SetupDraftProvider";

export default function SetupDefaultsScreen() {
  const router = useRouter();
  const auth = useAuth();
  const { draft, update } = useSetupDraft();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  if (auth.navigation === "app") {
    return <Redirect href="/(app)" />;
  }

  async function onSubmit() {
    const nextErrors = validateSetupStep3(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    if (!auth.accessToken) {
      setFormError("Sign in to continue.");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      await createWorkspace(
        auth.accessToken,
        workspaceCreateBodyFromDraft(draft),
        crypto.randomUUID(),
      );
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
          <Body>Step 3 of 3. Confirm timezone and document defaults. Currency is USD and cannot be changed.</Body>
          <Secondary>Optional logo upload is skipped in this slice.</Secondary>
          <ErrorBanner message={formError} />
          <Field
            label="Business timezone"
            value={draft.timezone}
            onChangeText={(value) => update({ timezone: value, timezone_confirmed: false })}
            error={errors["timezone"]}
          />
          <PrimaryButton
            label={draft.timezone_confirmed ? "Timezone confirmed" : "Confirm this timezone"}
            onPress={() => update({ timezone_confirmed: true })}
          />
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
          <PrimaryButton
            label="Create workspace"
            onPress={() => void onSubmit()}
            loading={submitting}
          />
        </KeyboardAvoidingView>
      </ScrollView>
    </Screen>
  );
}
