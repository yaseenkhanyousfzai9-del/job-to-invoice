import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { US_STATES, type Customer } from "@job-to-invoice/domain";
import {
  Body,
  ErrorBanner,
  Field,
  PrimaryButton,
  Screen,
  Secondary,
  TextLink,
  Title,
} from "../../../../src/components/ui";
import {
  createCustomerIdempotencySession,
  type CustomerFormDraft,
} from "../../../../src/features/customers/createCustomerForm";
import {
  draftFromCustomer,
  EDIT_FUTURE_DOCS_COPY,
  loadCustomerForEdit,
  submitEditCustomer,
} from "../../../../src/features/customers/editCustomerForm";
import { CUSTOMERS_LIST_HREF } from "../../../../src/features/customers/customerRoutes";
import { obtainCustomersListController } from "../../../../src/features/customers/customersListSession";
import { useAuth } from "../../../../src/providers/AuthProvider";
import { colors, layout, typography } from "../../../../src/theme/tokens";

export default function EditCustomerScreen() {
  const router = useRouter();
  const auth = useAuth();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const customerId =
    typeof params.id === "string" ? params.id : Array.isArray(params.id) ? params.id[0] : "";

  const idempotency = useMemo(() => createCustomerIdempotencySession(), []);
  const submittingRef = useRef(false);

  const [loadPhase, setLoadPhase] = useState<"loading" | "ready" | "not_found" | "error">(
    "loading",
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadRetryable, setLoadRetryable] = useState(false);
  const [baseline, setBaseline] = useState<CustomerFormDraft | null>(null);
  const [draft, setDraft] = useState<CustomerFormDraft | null>(null);
  const [version, setVersion] = useState(1);
  const [archivedAt, setArchivedAt] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [formErrorRetryable, setFormErrorRetryable] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [duplicateOpen, setDuplicateOpen] = useState(false);
  const [duplicateMessage, setDuplicateMessage] = useState<string | null>(null);
  const [duplicateNames, setDuplicateNames] = useState<string[]>([]);
  const [conflictOpen, setConflictOpen] = useState(false);
  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [conflictServer, setConflictServer] = useState<Customer | null>(null);

  async function loadCustomer() {
    setLoadPhase("loading");
    setLoadError(null);
    setLoadRetryable(false);
    const result = await loadCustomerForEdit(auth.accessToken, customerId);
    if (result.kind === "success") {
      applyCustomer(result.customer);
      setLoadPhase("ready");
      return;
    }
    if (result.kind === "unauthenticated") {
      setLoadPhase("error");
      setLoadError(result.message);
      await auth.signOut({ source: "401", reason: "edit_customer_unauthenticated" });
      return;
    }
    if (result.kind === "not_found") {
      setLoadPhase("not_found");
      setLoadError(result.message);
      return;
    }
    setLoadPhase("error");
    setLoadError(result.message);
    setLoadRetryable(result.retryable);
  }

  function applyCustomer(customer: Customer) {
    const nextDraft = draftFromCustomer(customer);
    setBaseline(nextDraft);
    setDraft(nextDraft);
    setVersion(customer.version);
    setArchivedAt(customer.archived_at);
    setErrors({});
    setFormError(null);
    setFormErrorRetryable(false);
    setDuplicateOpen(false);
    setConflictOpen(false);
    setConflictServer(null);
  }

  useEffect(() => {
    if (!customerId) {
      setLoadPhase("not_found");
      return;
    }
    void loadCustomer();
  }, [customerId, auth.accessToken]);

  function updateDraft(patch: Partial<CustomerFormDraft>) {
    setDraft((current) => (current ? { ...current, ...patch } : current));
    setErrors({});
    setFormError(null);
    setFormErrorRetryable(false);
  }

  async function runSubmit(confirmDuplicateEmail: boolean) {
    if (submittingRef.current || !draft || !baseline) {
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
      const result = await submitEditCustomer({
        accessToken: auth.accessToken,
        customerId,
        baseline,
        draft,
        version,
        confirmDuplicateEmail,
        idempotencyKey,
      });

      if (result.kind === "client_validation") {
        setErrors(result.fieldErrors);
        return;
      }
      if (result.kind === "no_changes") {
        setFormError(result.message);
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
      if (result.kind === "version_conflict") {
        setConflictOpen(true);
        setConflictMessage(result.message);
        setConflictServer(result.server);
        return;
      }
      if (result.kind === "not_found") {
        setFormError(result.message);
        return;
      }
      if (result.kind === "unauthenticated") {
        setFormError(result.message);
        await auth.signOut({ source: "401", reason: "edit_customer_unauthenticated" });
        return;
      }
      if (result.kind === "network" || result.kind === "error") {
        setFormError(result.message);
        setFormErrorRetryable(result.retryable);
        return;
      }

      setVersion(result.customer.version);
      setBaseline(draftFromCustomer(result.customer));
      setDuplicateOpen(false);
      setConflictOpen(false);

      try {
        await obtainCustomersListController().refreshPreservingFilters(auth.accessToken);
      } catch {
        // List refresh is best-effort; detail reload on focus still updates.
      }

      router.back();
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  function reloadLatestFromConflict() {
    if (!conflictServer) return;
    applyCustomer(conflictServer);
    setConflictOpen(false);
    setConflictMessage(null);
    setConflictServer(null);
  }

  return (
    <Screen testID="edit-customer-screen">
      <Stack.Screen options={{ title: "Edit Customer", headerBackTitle: "Back" }} />

      {!customerId || loadPhase === "not_found" ? (
        <View style={{ flex: 1, justifyContent: "center", gap: 12, paddingVertical: 24 }}>
          <Body>Customer not found.</Body>
          <PrimaryButton label="Back to Customers" onPress={() => router.replace(CUSTOMERS_LIST_HREF)} />
        </View>
      ) : loadPhase === "loading" || !draft || !baseline ? (
        <View
          style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}
          accessibilityLabel="Loading customer"
        >
          <ActivityIndicator color={colors.primary} />
          <Secondary>Loading customer…</Secondary>
        </View>
      ) : loadPhase === "error" ? (
        <View style={{ flex: 1, justifyContent: "center", gap: 12, paddingVertical: 24 }}>
          <ErrorBanner
            message={loadError}
            onRetry={loadRetryable ? () => void loadCustomer() : undefined}
          />
        </View>
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{ gap: 12, paddingBottom: 24 }}
        >
          <KeyboardAvoidingView
            behavior={Platform.OS === "ios" ? "padding" : undefined}
            style={{ gap: 12 }}
          >
            <Title>Edit Customer</Title>
            {archivedAt ? (
              <Text
                accessibilityRole="text"
                accessibilityLabel="Archived"
                style={{
                  alignSelf: "flex-start",
                  fontSize: typography.secondary.fontSize,
                  fontWeight: "700",
                  color: colors.text,
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: layout.cornerRadius,
                  paddingHorizontal: 10,
                  paddingVertical: 4,
                  overflow: "hidden",
                }}
              >
                Archived
              </Text>
            ) : null}
            <Body>{EDIT_FUTURE_DOCS_COPY}</Body>
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
            />
            <Field
              label="Email (optional)"
              value={draft.email}
              onChangeText={(value) => updateDraft({ email: value })}
              error={errors["email"]}
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
            />
            <Field
              label="Phone (optional, E.164)"
              value={draft.phone}
              onChangeText={(value) => updateDraft({ phone: value })}
              error={errors["phone"]}
              keyboardType="phone-pad"
              placeholder="+14155552671"
            />
            <Secondary>
              Include country code. Example: +14155552671. Do not enter a local number without +.
            </Secondary>

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

            {conflictOpen ? (
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
                  Customer changed elsewhere
                </Text>
                <Text style={{ fontSize: typography.secondary.fontSize, color: colors.text }}>
                  {conflictMessage ?? "This customer was updated elsewhere."}
                </Text>
                <PrimaryButton label="Reload latest" onPress={reloadLatestFromConflict} />
                <TextLink
                  label="Cancel"
                  onPress={() => {
                    setConflictOpen(false);
                    setConflictMessage(null);
                    setConflictServer(null);
                  }}
                />
              </View>
            ) : duplicateOpen ? (
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
                <PrimaryButton
                  label={submitting ? "Saving…" : "Save anyway"}
                  onPress={() => void runSubmit(true)}
                  loading={submitting}
                  disabled={submitting}
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
                  label={submitting ? "Saving…" : "Save"}
                  onPress={() => void runSubmit(false)}
                  loading={submitting}
                  disabled={submitting}
                />
                <TextLink label="Cancel" onPress={() => router.back()} />
              </>
            )}
          </KeyboardAvoidingView>
        </ScrollView>
      )}
    </Screen>
  );
}
