import { useMemo, useRef, useState } from "react";
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { US_STATES } from "@job-to-invoice/domain";
import {
  Body,
  ErrorBanner,
  Field,
  PrimaryButton,
  Screen,
  Secondary,
  TextLink,
  Title,
} from "../../../src/components/ui";
import {
  createCustomerIdempotencySession,
  emptyCustomerFormDraft,
  submitCreateCustomer,
  type CustomerFormDraft,
} from "../../../src/features/customers/createCustomerForm";
import { useAuth } from "../../../src/providers/AuthProvider";
import { colors, layout, typography } from "../../../src/theme/tokens";

export default function NewCustomerScreen() {
  const router = useRouter();
  const auth = useAuth();
  const idempotency = useMemo(() => createCustomerIdempotencySession(), []);
  const submittingRef = useRef(false);

  const [draft, setDraft] = useState<CustomerFormDraft>(emptyCustomerFormDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [formErrorRetryable, setFormErrorRetryable] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicateMessage, setDuplicateMessage] = useState<string | null>(null);
  const [duplicateNames, setDuplicateNames] = useState<string[]>([]);

  function updateDraft(patch: Partial<CustomerFormDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setErrors({});
    setFormError(null);
    setFormErrorRetryable(false);
  }

  async function runSubmit(confirmDuplicateEmail: boolean) {
    if (submittingRef.current) {
      return;
    }
    Keyboard.dismiss();
    submittingRef.current = true;
    setSubmitting(true);
    setFormError(null);
    setFormErrorRetryable(false);
    setErrors({});

    const idempotencyKey = confirmDuplicateEmail
      ? idempotency.newKeyForConfirmation()
      : idempotency.keyForMaterialDraft(draft);

    try {
      const result = await submitCreateCustomer({
        accessToken: auth.accessToken,
        draft,
        confirmDuplicateEmail,
        idempotencyKey,
      });

      if (result.kind === "client_validation") {
        setErrors(result.fieldErrors);
        return;
      }
      if (result.kind === "server_validation") {
        setErrors(result.fieldErrors);
        setFormError(result.message);
        return;
      }
      if (result.kind === "duplicate") {
        setDuplicateOpen(true);
        setDuplicateMessage(result.message);
        setDuplicateNames(result.duplicates.map((item) => item.name));
        return;
      }
      if (result.kind === "unauthenticated") {
        setFormError(result.message);
        await auth.signOut({ source: "401", reason: "create_customer_unauthenticated" });
        return;
      }
      if (result.kind === "network" || result.kind === "error") {
        setFormError(result.message);
        setFormErrorRetryable(result.retryable);
        return;
      }

      setDuplicateOpen(false);
      setDuplicateMessage(null);
      setDuplicateNames([]);
      setDraft(emptyCustomerFormDraft());
      router.replace({
        pathname: "/(app)/customers/index",
        params: { customerCreated: "1" },
      });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <Screen testID="new-customer-screen">
      <Stack.Screen options={{ title: "New Customer", headerBackTitle: "Back" }} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 24 }}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ gap: 12 }}>
          <Title>New Customer</Title>
          <Body>Add a contact for jobs and documents. Names may match an existing customer.</Body>
          <ErrorBanner
            message={formError}
            onRetry={formErrorRetryable ? () => void runSubmit(false) : undefined}
          />

          <Field
            label="Name"
            value={draft.name}
            onChangeText={(value) => updateDraft({ name: value })}
            error={errors["name"]}
            autoCapitalize="words"
            maxLength={120}
            placeholder="Jordan Lee"
          />
          <Field
            label="Email (optional)"
            value={draft.email}
            onChangeText={(value) => updateDraft({ email: value })}
            error={errors["email"]}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            placeholder="jordan@example.com"
          />
          <Field
            label="Phone (optional, E.164)"
            value={draft.phone}
            onChangeText={(value) => updateDraft({ phone: value })}
            error={errors["phone"]}
            keyboardType="phone-pad"
            placeholder="+14155552671"
          />
          <Secondary>Include country code. Example: +14155552671. Do not enter a local number without +.</Secondary>

          <Secondary>Billing address (optional)</Secondary>
          <Field
            label="Address line 1"
            value={draft.address_line1}
            onChangeText={(value) => updateDraft({ address_line1: value })}
            error={errors["address_line1"] ?? errors["billing_address.line1"]}
            textContentType="streetAddressLine1"
            autoCapitalize="words"
            maxLength={150}
          />
          <Field
            label="Address line 2 (optional)"
            value={draft.address_line2}
            onChangeText={(value) => updateDraft({ address_line2: value })}
            error={errors["address_line2"] ?? errors["billing_address.line2"]}
            textContentType="streetAddressLine2"
            autoCapitalize="words"
            maxLength={150}
          />
          <Field
            label="City"
            value={draft.city}
            onChangeText={(value) => updateDraft({ city: value })}
            error={errors["city"] ?? errors["billing_address.city"]}
            textContentType="addressCity"
            autoCapitalize="words"
            maxLength={80}
          />
          <Field
            label="State"
            value={draft.state}
            onChangeText={(value) => updateDraft({ state: value.toUpperCase().slice(0, 2) })}
            error={errors["state"] ?? errors["billing_address.state"]}
            autoCapitalize="characters"
            maxLength={2}
            placeholder="TX"
          />
          <Secondary>{`Two-letter US state or DC. Examples: ${US_STATES.slice(0, 5).join(", ")}.`}</Secondary>
          <Field
            label="ZIP"
            value={draft.zip}
            onChangeText={(value) => updateDraft({ zip: value })}
            error={errors["zip"] ?? errors["billing_address.zip"]}
            keyboardType="number-pad"
            textContentType="postalCode"
            placeholder="78701"
            maxLength={10}
          />

          {duplicateOpen ? (
            <View
              accessibilityLiveRegion="polite"
              style={{
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: layout.cornerRadius,
                padding: 12,
                gap: 8,
              }}
            >
              <Text
                accessibilityRole="header"
                style={{
                  fontSize: typography.body.fontSize,
                  color: colors.text,
                  fontWeight: "600",
                }}
              >
                Email already used
              </Text>
              <Text style={{ fontSize: typography.secondary.fontSize, color: colors.text }}>
                {duplicateMessage ??
                  "A customer with this email already exists in your workspace."}
              </Text>
              {duplicateNames.length > 0 ? (
                <Text style={{ fontSize: typography.secondary.fontSize, color: colors.secondary }}>
                  {`Existing contact${duplicateNames.length > 1 ? "s" : ""}: ${duplicateNames.join(", ")}.`}
                </Text>
              ) : null}
              <Text style={{ fontSize: typography.secondary.fontSize, color: colors.secondary }}>
                Creating another customer will not overwrite the existing one.
              </Text>
              <PrimaryButton
                label={submitting ? "Saving…" : "Create separate customer anyway"}
                onPress={() => void runSubmit(true)}
                loading={submitting}
              />
              <TextLink
                label="Cancel"
                onPress={() => {
                  if (submitting) return;
                  setDuplicateOpen(false);
                  setDuplicateMessage(null);
                  setDuplicateNames([]);
                }}
              />
            </View>
          ) : (
            <>
              <PrimaryButton
                label={submitting ? "Saving…" : "Save Customer"}
                onPress={() => void runSubmit(false)}
                loading={submitting}
              />
              <TextLink label="Cancel" onPress={() => router.back()} />
            </>
          )}
        </KeyboardAvoidingView>
      </ScrollView>
    </Screen>
  );
}
