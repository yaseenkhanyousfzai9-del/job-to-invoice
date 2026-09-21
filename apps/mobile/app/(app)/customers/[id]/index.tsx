import { useCallback, useEffect, useMemo, useReducer } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import {
  Body,
  ErrorBanner,
  PrimaryButton,
  Screen,
  Secondary,
  TextLink,
  Title,
} from "../../../../src/components/ui";
import {
  ARCHIVE_CANCEL_ACTION,
  ARCHIVE_CONFIRM_ACTION,
  ARCHIVE_CONFIRM_BODY,
  ARCHIVE_CONFIRM_TITLE,
  archiveActionForCustomer,
  archiveActionLabel,
  archivePendingLabel,
} from "../../../../src/features/customers/customerArchive";
import {
  DELETE_ACTION_LABEL,
  DELETE_CANCEL_ACTION,
  DELETE_CONFIRM_ACTION,
  DELETE_CONFIRM_BODY,
  DELETE_CONFIRM_TITLE,
  DELETE_REFERENCED_ARCHIVE_ACTION,
  DELETING_LABEL,
} from "../../../../src/features/customers/customerDelete";
import {
  createCustomerDetailController,
  emptyJobsCopy,
  presentCustomerDetail,
  presentJobRow,
  showCustomerDetailLoading,
  customerNotFoundCopy,
  customerNoLongerExistsCopy,
  type CustomerDetailSnapshot,
} from "../../../../src/features/customers/customerDetail";
import {
  CUSTOMERS_LIST_HREF,
  pushCustomerEdit,
} from "../../../../src/features/customers/customerRoutes";
import { obtainCustomersListController } from "../../../../src/features/customers/customersListSession";
import { useAuth } from "../../../../src/providers/AuthProvider";
import { colors, layout, typography } from "../../../../src/theme/tokens";

export default function CustomerDetailScreen() {
  const auth = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const customerId =
    typeof params.id === "string" ? params.id : Array.isArray(params.id) ? params.id[0] : "";

  const controller = useMemo(
    () =>
      createCustomerDetailController(customerId || "missing", {
        async onArchiveSuccess(_customer, accessToken) {
          await obtainCustomersListController().refreshAfterMutation(accessToken);
        },
        async onDeleteSuccess(accessToken) {
          await obtainCustomersListController().refreshAfterMutation(accessToken);
        },
      }),
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

  useFocusEffect(
    useCallback(() => {
      if (!customerId) return;
      void (async () => {
        const result = await controller.bootstrap(auth.accessToken);
        if (result === "unauthenticated") {
          await auth.signOut({ source: "401", reason: "customer_detail_unauthenticated" });
        }
      })();
    }, [auth.accessToken, auth.signOut, controller, customerId]),
  );

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

  async function onConfirmArchive() {
    const result = await controller.confirmArchive(auth.accessToken);
    if (result === "unauthenticated") {
      await auth.signOut({ source: "401", reason: "customer_archive_unauthenticated" });
    }
  }

  async function onRestore() {
    const result = await controller.restoreCustomer(auth.accessToken);
    if (result === "unauthenticated") {
      await auth.signOut({ source: "401", reason: "customer_restore_unauthenticated" });
    }
  }

  async function onRetryArchiveAction() {
    const result = await controller.retryArchiveAction(auth.accessToken);
    if (result === "unauthenticated") {
      await auth.signOut({ source: "401", reason: "customer_archive_retry_unauthenticated" });
    }
  }

  async function onConfirmDelete() {
    const result = await controller.confirmDelete(auth.accessToken);
    if (result === "unauthenticated") {
      await auth.signOut({ source: "401", reason: "customer_delete_unauthenticated" });
      return;
    }
    if (result === "deleted") {
      router.replace(CUSTOMERS_LIST_HREF);
    }
  }

  async function onRetryDelete() {
    const result = await controller.retryDelete(auth.accessToken);
    if (result === "unauthenticated") {
      await auth.signOut({ source: "401", reason: "customer_delete_retry_unauthenticated" });
      return;
    }
    if (result === "deleted") {
      router.replace(CUSTOMERS_LIST_HREF);
    }
  }

  const notFoundCopy = snapshot.deleteNotFound
    ? customerNoLongerExistsCopy()
    : customerNotFoundCopy();

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
          <Body>{notFoundCopy}</Body>
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
          customerId={customerId}
          onEdit={() =>
            pushCustomerEdit((href) => router.push(href), customerId)
          }
          onRetryJobs={() => void onRetryJobs()}
          onLoadMore={() => void onLoadMore()}
          onOpenArchiveConfirm={() => controller.openArchiveConfirm()}
          onCancelArchiveConfirm={() => controller.cancelArchiveConfirm()}
          onConfirmArchive={() => void onConfirmArchive()}
          onRestore={() => void onRestore()}
          onRetryArchiveAction={() => void onRetryArchiveAction()}
          onOpenDeleteConfirm={() => controller.openDeleteConfirm()}
          onCancelDeleteConfirm={() => controller.cancelDeleteConfirm()}
          onConfirmDelete={() => void onConfirmDelete()}
          onRetryDelete={() => void onRetryDelete()}
        />
      ) : null}
    </Screen>
  );
}

function CustomerDetailBody(props: {
  snapshot: CustomerDetailSnapshot;
  customerId: string;
  onEdit: () => void;
  onRetryJobs: () => void;
  onLoadMore: () => void;
  onOpenArchiveConfirm: () => void;
  onCancelArchiveConfirm: () => void;
  onConfirmArchive: () => void;
  onRestore: () => void;
  onRetryArchiveAction: () => void;
  onOpenDeleteConfirm: () => void;
  onCancelDeleteConfirm: () => void;
  onConfirmDelete: () => void;
  onRetryDelete: () => void;
}) {
  const { snapshot } = props;
  const customer = snapshot.customer!;
  const presented = presentCustomerDetail(customer);
  const actionKind = archiveActionForCustomer(customer);
  const archivePending = snapshot.archivePending;
  const deletePending = snapshot.deletePending;
  const pending = archivePending || deletePending;
  const archivePendingLabelText =
    snapshot.archivePendingKind !== null
      ? archivePendingLabel(snapshot.archivePendingKind)
      : null;
  const showArchiveFromConflict =
    snapshot.deleteReferencedConflict && actionKind === "archive" && !snapshot.archiveConfirmOpen;

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

      <PrimaryButton
        label="Edit customer"
        onPress={props.onEdit}
        disabled={pending}
      />

      {actionKind === "archive" && !snapshot.archiveConfirmOpen ? (
        <PrimaryButton
          label={
            archivePending && snapshot.archivePendingKind === "archive"
              ? archivePendingLabelText!
              : archiveActionLabel("archive")
          }
          onPress={props.onOpenArchiveConfirm}
          loading={archivePending && snapshot.archivePendingKind === "archive"}
          disabled={pending}
        />
      ) : null}

      {actionKind === "restore" && !snapshot.archiveConfirmOpen ? (
        <PrimaryButton
          label={
            archivePending && snapshot.archivePendingKind === "restore"
              ? archivePendingLabelText!
              : archiveActionLabel("restore")
          }
          onPress={props.onRestore}
          loading={archivePending && snapshot.archivePendingKind === "restore"}
          disabled={pending}
        />
      ) : null}

      {snapshot.archiveConfirmOpen ? (
        <View accessibilityLiveRegion="polite" style={styles.confirmCard}>
          <Text accessibilityRole="header" style={styles.confirmTitle}>
            {ARCHIVE_CONFIRM_TITLE}
          </Text>
          <Text style={styles.confirmBody}>{ARCHIVE_CONFIRM_BODY}</Text>
          <PrimaryButton
            label={
              archivePending && snapshot.archivePendingKind === "archive"
                ? archivePendingLabelText!
                : ARCHIVE_CONFIRM_ACTION
            }
            onPress={props.onConfirmArchive}
            loading={archivePending && snapshot.archivePendingKind === "archive"}
            disabled={pending}
          />
          <TextLink
            label={ARCHIVE_CANCEL_ACTION}
            onPress={props.onCancelArchiveConfirm}
          />
        </View>
      ) : null}

      <ErrorBanner
        message={snapshot.archiveErrorMessage}
        onRetry={
          snapshot.archiveErrorRetryable ? props.onRetryArchiveAction : undefined
        }
      />

      {!snapshot.deleteConfirmOpen ? (
        <PrimaryButton
          label={deletePending ? DELETING_LABEL : DELETE_ACTION_LABEL}
          onPress={props.onOpenDeleteConfirm}
          loading={deletePending}
          disabled={pending}
        />
      ) : null}

      {snapshot.deleteConfirmOpen ? (
        <View accessibilityLiveRegion="polite" style={styles.deleteConfirmCard}>
          <Text accessibilityRole="header" style={styles.confirmTitle}>
            {DELETE_CONFIRM_TITLE}
          </Text>
          <Text style={styles.confirmBody}>{DELETE_CONFIRM_BODY}</Text>
          <PrimaryButton
            label={deletePending ? DELETING_LABEL : DELETE_CONFIRM_ACTION}
            onPress={props.onConfirmDelete}
            loading={deletePending}
            disabled={pending}
          />
          <TextLink
            label={DELETE_CANCEL_ACTION}
            onPress={props.onCancelDeleteConfirm}
          />
        </View>
      ) : null}

      {snapshot.deleteReferencedConflict ? (
        <View accessibilityLiveRegion="polite" style={styles.conflictCard}>
          <Text style={styles.confirmBody}>{snapshot.deleteErrorMessage}</Text>
          {snapshot.deleteReferencedGuidance ? (
            <Text style={styles.confirmBody}>{snapshot.deleteReferencedGuidance}</Text>
          ) : null}
          {showArchiveFromConflict ? (
            <PrimaryButton
              label={DELETE_REFERENCED_ARCHIVE_ACTION}
              onPress={props.onOpenArchiveConfirm}
              disabled={pending}
            />
          ) : null}
        </View>
      ) : (
        <ErrorBanner
          message={snapshot.deleteErrorMessage}
          onRetry={snapshot.deleteErrorRetryable ? props.onRetryDelete : undefined}
        />
      )}

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
          disabled={snapshot.loadMoreBlocked || snapshot.phase === "loading_more_jobs" || pending}
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
  confirmCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: layout.cornerRadius,
    padding: 12,
    gap: 8,
    backgroundColor: "#ffffff",
  },
  deleteConfirmCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: layout.cornerRadius,
    padding: 12,
    gap: 8,
    backgroundColor: "#fff8f7",
  },
  conflictCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: layout.cornerRadius,
    padding: 12,
    gap: 8,
    backgroundColor: "#ffffff",
  },
  confirmTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: colors.text,
  },
  confirmBody: {
    fontSize: typography.secondary.fontSize,
    color: colors.text,
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
