import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
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
} from "../../../src/components/ui";
import {
  createJobIdempotencySession,
  createJobSuccessDetailParams,
  emptyCreateJobFormDraft,
  modeLabel,
  submitCreateJob,
  type CreateJobFormDraft,
} from "../../../src/features/jobs/createJobForm";
import {
  CREATE_JOB_KEYBOARD_SHOULD_PERSIST_TAPS,
  customersNewHrefForCreateJob,
} from "../../../src/features/jobs/jobRoutes";
import { createCustomerPickerController } from "../../../src/features/jobs/customerPicker";
import { createClientUuid } from "../../../src/lib/clientUuid";
import { useAuth } from "../../../src/providers/AuthProvider";
import { colors, layout, spacing, typography } from "../../../src/theme/tokens";

export default function CreateJobScreen() {
  const router = useRouter();
  const auth = useAuth();
  const params = useLocalSearchParams<{
    selectedCustomerId?: string;
    selectedCustomerName?: string;
  }>();

  const idempotency = useMemo(() => createJobIdempotencySession(), []);
  const jobIdRef = useRef(createClientUuid());
  const submittingRef = useRef(false);
  const picker = useMemo(() => createCustomerPickerController(), []);
  const pickerSnap = useSyncExternalStore(picker.subscribe, picker.getSnapshot, picker.getSnapshot);

  const [draft, setDraft] = useState<CreateJobFormDraft>(emptyCreateJobFormDraft);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [formErrorRetryable, setFormErrorRetryable] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    void picker.bootstrap(auth.accessToken);
    return () => picker.dispose();
  }, [picker, auth.accessToken]);

  useEffect(() => {
    const id = typeof params.selectedCustomerId === "string" ? params.selectedCustomerId : null;
    const name =
      typeof params.selectedCustomerName === "string" ? params.selectedCustomerName : null;
    if (id) {
      setDraft((current) => ({
        ...current,
        customerId: id,
        customerName: name ?? current.customerName,
      }));
      void picker.refresh(auth.accessToken);
    }
  }, [params.selectedCustomerId, params.selectedCustomerName, picker, auth.accessToken]);

  function updateDraft(patch: Partial<CreateJobFormDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setErrors({});
    setFormError(null);
    setFormErrorRetryable(false);
    setSuccessMessage(null);
  }

  function selectCustomer(customer: Customer) {
    Keyboard.dismiss();
    updateDraft({
      customerId: customer.id,
      customerName: customer.name,
    });
  }

  function clearCustomerSelection() {
    updateDraft({ customerId: null, customerName: null });
  }

  async function runSubmit() {
    if (submittingRef.current) {
      return;
    }
    Keyboard.dismiss();
    submittingRef.current = true;
    setSubmitting(true);
    setFormError(null);
    setFormErrorRetryable(false);
    setErrors({});
    setSuccessMessage(null);

    const idempotencyKey = idempotency.keyForMaterialDraft(draft);

    try {
      const result = await submitCreateJob({
        accessToken: auth.accessToken,
        draft,
        jobId: jobIdRef.current,
        idempotencyKey,
      });

      if (result.kind === "client_validation") {
        setErrors(result.fieldErrors);
        setFormError(result.message);
        return;
      }
      if (result.kind === "server_validation") {
        setErrors(result.fieldErrors);
        setFormError(result.message);
        return;
      }
      if (result.kind === "customer_archived") {
        setFormError(result.message);
        clearCustomerSelection();
        void picker.refresh(auth.accessToken);
        return;
      }
      if (result.kind === "not_found") {
        setFormError(result.message);
        clearCustomerSelection();
        return;
      }
      if (result.kind === "idempotency_mismatch") {
        setFormError(result.message);
        idempotency.reset();
        jobIdRef.current = createClientUuid();
        return;
      }
      if (result.kind === "unauthenticated") {
        setFormError(result.message);
        await auth.signOut({ source: "401", reason: "create_job_unauthenticated" });
        return;
      }
      if (result.kind === "network" || result.kind === "error") {
        setFormError(result.message);
        setFormErrorRetryable(result.retryable);
        return;
      }

      setSuccessMessage("Job created.");
      router.replace(createJobSuccessDetailParams(result.job.customer_id));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: "Create job", headerBackTitle: "Back" }} />
      <Screen testID="create-job-screen">
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            keyboardShouldPersistTaps={CREATE_JOB_KEYBOARD_SHOULD_PERSIST_TAPS}
            contentContainerStyle={styles.scrollContent}
          >
            <Title>Create job</Title>
            <Secondary>
              Choose an active customer, title, site, and Quote or Direct invoice.
            </Secondary>

            <Text style={styles.section}>Customer</Text>
            {draft.customerId ? (
              <View style={styles.selectedBox}>
                <Body>{draft.customerName ?? "Selected customer"}</Body>
                <TextLink label="Change customer" onPress={clearCustomerSelection} />
              </View>
            ) : (
              <>
                <Field
                  label="Search customers"
                  value={pickerSnap.searchInput}
                  onChangeText={(value) => picker.setSearchInput(auth.accessToken, value)}
                  placeholder="Search active customers"
                  autoCapitalize="none"
                />
                {pickerSnap.status === "loading" && pickerSnap.items.length === 0 ? (
                  <Secondary>Loading customers…</Secondary>
                ) : null}
                <ErrorBanner
                  message={pickerSnap.errorMessage}
                  onRetry={
                    pickerSnap.errorRetryable
                      ? () => void picker.retry(auth.accessToken)
                      : undefined
                  }
                />
                {pickerSnap.status === "ready" && pickerSnap.items.length === 0 ? (
                  <View style={styles.emptyBlock}>
                    <Secondary>
                      {pickerSnap.appliedSearch
                        ? "No active customers match that search."
                        : "No active customers yet. Add a customer to continue."}
                    </Secondary>
                    <PrimaryButton
                      label="Add customer"
                      onPress={() => router.push(customersNewHrefForCreateJob())}
                    />
                  </View>
                ) : null}
                <FlatList
                  data={pickerSnap.items}
                  keyExtractor={(item) => item.id}
                  scrollEnabled={false}
                  keyboardShouldPersistTaps={CREATE_JOB_KEYBOARD_SHOULD_PERSIST_TAPS}
                  ListFooterComponent={
                    pickerSnap.nextCursor ? (
                      <PrimaryButton
                        label={pickerSnap.loadingMore ? "Loading…" : "Load more"}
                        onPress={() => void picker.loadMore(auth.accessToken)}
                      />
                    ) : null
                  }
                  renderItem={({ item }) => (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Select ${item.name}`}
                      onPress={() => selectCustomer(item)}
                      style={styles.customerRow}
                    >
                      <Text style={styles.customerName}>{item.name}</Text>
                      {item.email ? <Text style={styles.customerMeta}>{item.email}</Text> : null}
                    </Pressable>
                  )}
                />
                {pickerSnap.items.length > 0 ? (
                  <TextLink
                    label="Add customer"
                    onPress={() => router.push(customersNewHrefForCreateJob())}
                  />
                ) : null}
              </>
            )}

            <Field
              label="Job title"
              value={draft.title}
              onChangeText={(value) => updateDraft({ title: value })}
              error={errors.title}
              placeholder="e.g. Fence repair"
              maxLength={120}
            />

            <Text style={styles.section}>Document mode</Text>
            <View style={styles.modeRow}>
              {(["quote", "direct_invoice"] as const).map((mode) => {
                const selected = draft.mode === mode;
                return (
                  <Pressable
                    key={mode}
                    accessibilityRole="button"
                    accessibilityState={{ selected }}
                    accessibilityLabel={modeLabel(mode)}
                    onPress={() => updateDraft({ mode })}
                    style={[styles.modeChip, selected ? styles.modeChipSelected : null]}
                  >
                    <Text style={[styles.modeChipText, selected ? styles.modeChipTextSelected : null]}>
                      {modeLabel(mode)}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <Text style={styles.section}>Site</Text>
            <Pressable
              accessibilityRole="checkbox"
              accessibilityState={{ checked: draft.noSite }}
              accessibilityLabel="No site address"
              onPress={() =>
                updateDraft({
                  noSite: !draft.noSite,
                  ...(draft.noSite
                    ? {}
                    : {
                        address_line1: "",
                        address_line2: "",
                        city: "",
                        state: "",
                        zip: "",
                      }),
                })
              }
              style={styles.checkRow}
            >
              <Text style={styles.checkMark}>{draft.noSite ? "[x]" : "[ ]"}</Text>
              <Text style={styles.checkLabel}>No site address</Text>
            </Pressable>

            {!draft.noSite ? (
              <>
                <Field
                  label="Address line 1"
                  value={draft.address_line1}
                  onChangeText={(value) => updateDraft({ address_line1: value })}
                  error={errors["site_address.line1"] ?? errors.site_address}
                />
                <Field
                  label="Address line 2"
                  value={draft.address_line2}
                  onChangeText={(value) => updateDraft({ address_line2: value })}
                  error={errors["site_address.line2"]}
                />
                <Field
                  label="City"
                  value={draft.city}
                  onChangeText={(value) => updateDraft({ city: value })}
                  error={errors["site_address.city"]}
                />
                <Field
                  label="State"
                  value={draft.state}
                  onChangeText={(value) => updateDraft({ state: value.toUpperCase() })}
                  error={errors["site_address.state"]}
                  autoCapitalize="characters"
                  maxLength={2}
                  placeholder="TX"
                />
                <Secondary>{`Example states: ${US_STATES.slice(0, 8).join(", ")}`}</Secondary>
                <Field
                  label="ZIP"
                  value={draft.zip}
                  onChangeText={(value) => updateDraft({ zip: value })}
                  error={errors["site_address.zip"]}
                  keyboardType="number-pad"
                  placeholder="78701"
                />
              </>
            ) : (
              <Secondary>Remote or service work — no site address will be saved.</Secondary>
            )}

            <ErrorBanner
              message={formError}
              onRetry={formErrorRetryable ? () => void runSubmit() : undefined}
            />
            {successMessage ? <Body>{successMessage}</Body> : null}

            <PrimaryButton
              label={submitting ? "Creating…" : "Create job"}
              onPress={() => void runSubmit()}
              loading={submitting}
              disabled={submitting}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      </Screen>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scrollContent: {
    paddingBottom: spacing.x6,
    gap: spacing.x2,
  },
  section: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: colors.text,
    marginTop: spacing.x1,
  },
  selectedBox: {
    gap: spacing.x1,
    padding: spacing.x2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: layout.cornerRadius,
    backgroundColor: colors.background,
  },
  emptyBlock: { gap: spacing.x2 },
  customerRow: {
    paddingVertical: spacing.x2,
    paddingHorizontal: spacing.x1,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    minHeight: layout.minTouchTarget,
  },
  customerName: {
    fontSize: typography.body.fontSize,
    color: colors.text,
  },
  customerMeta: {
    fontSize: typography.secondary.fontSize,
    color: colors.secondary,
  },
  modeRow: {
    flexDirection: "row",
    gap: spacing.x1,
  },
  modeChip: {
    flex: 1,
    minHeight: layout.minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: layout.cornerRadius,
    paddingHorizontal: spacing.x1,
  },
  modeChipSelected: {
    borderColor: colors.primary,
  },
  modeChipText: {
    fontSize: typography.body.fontSize,
    color: colors.text,
  },
  modeChipTextSelected: {
    color: colors.primary,
    fontWeight: "600",
  },
  checkRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.x1,
    minHeight: layout.minTouchTarget,
  },
  checkMark: {
    fontSize: 17,
    color: colors.text,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  checkLabel: {
    fontSize: typography.body.fontSize,
    color: colors.text,
  },
});
