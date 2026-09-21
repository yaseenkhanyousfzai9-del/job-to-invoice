import { useEffect, useMemo, useReducer } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  Body,
  ErrorBanner,
  PrimaryButton,
  Screen,
  Secondary,
  Title,
} from "../../../src/components/ui";
import {
  createCustomerDetailController,
  emptyJobsCopy,
  presentCustomerDetail,
  presentJobRow,
  showCustomerDetailLoading,
  customerNotFoundCopy,
  type CustomerDetailSnapshot,
} from "../../../src/features/customers/customerDetail";
import { CUSTOMERS_LIST_HREF } from "../../../src/features/customers/customerRoutes";
import { useAuth } from "../../../src/providers/AuthProvider";
import { colors, layout, typography } from "../../../src/theme/tokens";

export default function CustomerDetailScreen() {
  const auth = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const customerId =
    typeof params.id === "string" ? params.id : Array.isArray(params.id) ? params.id[0] : "";

  const controller = useMemo(
    () => createCustomerDetailController(customerId || "missing"),
    [customerId],
  );
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const snapshot = controller.getSnapshot();

  useEffect(() => {
    return controller.subscribe(() => rerender());
  }, [controller]);

  useEffect(() => {
    return () => controller.dispose();
  }, [controller]);

  useEffect(() => {
    if (!customerId) return;
    void (async () => {
      const result = await controller.bootstrap(auth.accessToken);
      if (result === "unauthenticated") {
        await auth.signOut({ source: "401", reason: "customer_detail_unauthenticated" });
      }
    })();
  }, [auth.accessToken, auth.signOut, controller, customerId]);

  async function onRetry() {
    const result = await controller.retry(auth.accessToken);
    if (result === "unauthenticated") {
      await auth.signOut({ source: "401", reason: "customer_detail_unauthenticated" });
    }
  }

  async function onRetryJobs() {
    const result = await controller.retryJobs(auth.accessToken);
    if (result === "unauthenticated") {
      await auth.signOut({ source: "401", reason: "customer_detail_unauthenticated" });
    }
  }

  async function onLoadMore() {
    const result = await controller.loadMoreJobs(auth.accessToken);
    if (result === "unauthenticated") {
      await auth.signOut({ source: "401", reason: "customer_detail_unauthenticated" });
    }
  }

  return (
    <Screen testID="customer-detail-screen">
      <Stack.Screen options={{ title: "Customer", headerBackTitle: "Customers" }} />

      {!customerId ? (
        <View style={styles.centered}>
          <Body>{customerNotFoundCopy()}</Body>
          <PrimaryButton
            label="Back to Customers"
            onPress={() => router.replace(CUSTOMERS_LIST_HREF)}
          />
        </View>
      ) : showCustomerDetailLoading(snapshot) ? (
        <View style={styles.centered} accessibilityLabel="Loading customer">
          <ActivityIndicator color={colors.primary} />
          <Secondary>Loading customer…</Secondary>
        </View>
      ) : snapshot.phase === "not_found" ? (
        <View style={styles.centered} accessibilityLiveRegion="polite">
          <Body>{customerNotFoundCopy()}</Body>
          <PrimaryButton
            label="Back to Customers"
            onPress={() => router.replace(CUSTOMERS_LIST_HREF)}
          />
        </View>
      ) : snapshot.phase === "error" && !snapshot.customer ? (
        <View style={styles.centered}>
          <ErrorBanner
            message={snapshot.errorMessage}
            onRetry={snapshot.errorRetryable ? () => void onRetry() : undefined}
          />
        </View>
      ) : snapshot.customer ? (
        <CustomerDetailBody
          snapshot={snapshot}
          onRetryJobs={() => void onRetryJobs()}
          onLoadMore={() => void onLoadMore()}
        />
      ) : null}
    </Screen>
  );
}

function CustomerDetailBody(props: {
  snapshot: CustomerDetailSnapshot;
  onRetryJobs: () => void;
  onLoadMore: () => void;
}) {
  const { snapshot } = props;
  const customer = snapshot.customer!;
  const presented = presentCustomerDetail(customer);

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.headerBlock}>
        <Title>{presented.name}</Title>
        {presented.archivedLabel ? (
          <Text
            accessibilityRole="text"
            accessibilityLabel="Archived"
            style={styles.archivedBadge}
          >
            {presented.archivedLabel}
          </Text>
        ) : null}
      </View>

      {presented.email ? (
        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLabel}>Email</Text>
          <Text style={styles.fieldValue}>{presented.email}</Text>
        </View>
      ) : null}

      {presented.phone ? (
        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLabel}>Phone</Text>
          <Text style={styles.fieldValue}>{presented.phone}</Text>
        </View>
      ) : null}

      {presented.billingLines ? (
        <View style={styles.fieldBlock}>
          <Text style={styles.fieldLabel}>Billing address</Text>
          {presented.billingLines.map((line) => (
            <Text key={line} style={styles.fieldValue}>
              {line}
            </Text>
          ))}
        </View>
      ) : null}

      <Text accessibilityRole="header" style={styles.sectionTitle}>
        Jobs
      </Text>

      <ErrorBanner
        message={snapshot.jobsErrorMessage}
        onRetry={snapshot.jobsErrorRetryable ? props.onRetryJobs : undefined}
      />

      {!snapshot.jobsErrorMessage && snapshot.jobs.length === 0 ? (
        <Body>{emptyJobsCopy()}</Body>
      ) : null}

      {snapshot.jobs.map((job) => {
        const row = presentJobRow(job);
        return (
          <View
            key={row.id}
            accessible
            accessibilityLabel={row.accessibilityLabel}
            accessibilityRole="text"
            style={styles.jobRow}
          >
            <Text style={styles.jobTitle}>{row.title}</Text>
            <Text style={styles.jobMeta}>{row.lifecycle}</Text>
          </View>
        );
      })}

      {snapshot.jobsNextCursor ? (
        <PrimaryButton
          label={snapshot.phase === "loading_more_jobs" ? "Loading…" : "Load more"}
          onPress={props.onLoadMore}
          loading={snapshot.phase === "loading_more_jobs"}
          disabled={snapshot.loadMoreBlocked || snapshot.phase === "loading_more_jobs"}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: {
    gap: 12,
    paddingBottom: 32,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 24,
  },
  headerBlock: {
    gap: 8,
  },
  archivedBadge: {
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
  },
  fieldBlock: {
    gap: 4,
  },
  fieldLabel: {
    fontSize: typography.secondary.fontSize,
    color: colors.secondary,
    fontWeight: "600",
  },
  fieldValue: {
    fontSize: typography.body.fontSize,
    color: colors.text,
  },
  sectionTitle: {
    marginTop: 8,
    fontSize: typography.sectionTitle.fontSize,
    fontWeight: "600",
    color: colors.text,
  },
  jobRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: layout.cornerRadius,
    padding: 12,
    gap: 4,
    backgroundColor: "#ffffff",
    minHeight: layout.minTouchTarget,
  },
  jobTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: colors.text,
  },
  jobMeta: {
    fontSize: typography.secondary.fontSize,
    color: colors.secondary,
    textTransform: "capitalize",
  },
});
