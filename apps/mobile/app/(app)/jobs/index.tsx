import { useCallback, useEffect, useMemo, useReducer } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useFocusEffect, useRouter, type Href } from "expo-router";
import type { JobListBucket } from "@job-to-invoice/domain";
import {
  Body,
  ErrorBanner,
  Field,
  PrimaryButton,
  Screen,
  Secondary,
  Title,
} from "../../../src/components/ui";
import {
  emptyJobsCopy,
  presentJobCard,
  showJobsEmptyState,
  showJobsInitialLoading,
  showJobsNewJobInEmptyState,
  type JobsListSnapshot,
} from "../../../src/features/jobs/jobsList";
import {
  jobsListHasBootstrapped,
  markJobsListBootstrapped,
  nextJobsListFocusAction,
  obtainJobsListController,
  syncJobsListUiFromSnapshot,
} from "../../../src/features/jobs/jobsListSession";
import {
  CREATE_JOB_HREF,
  JOBS_LIST_KEYBOARD_SHOULD_PERSIST_TAPS,
  pushCreateJob,
} from "../../../src/features/jobs/jobRoutes";
import { useAuth } from "../../../src/providers/AuthProvider";
import { colors, layout, typography } from "../../../src/theme/tokens";

const FILTERS: { label: string; value: JobListBucket }[] = [
  { label: "Active", value: "active" },
  { label: "Finished", value: "finished" },
  { label: "Archived", value: "archived" },
];

export default function JobsListScreen() {
  const auth = useAuth();
  const router = useRouter();
  const controller = useMemo(() => obtainJobsListController(), []);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const snapshot = controller.getSnapshot();

  useEffect(() => {
    return controller.subscribe(() => {
      syncJobsListUiFromSnapshot(controller.getSnapshot());
      rerender();
    });
  }, [controller]);

  useEffect(() => {
    return () => {
      syncJobsListUiFromSnapshot(controller.getSnapshot());
    };
  }, [controller]);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const action = nextJobsListFocusAction(jobsListHasBootstrapped());
        const result =
          action === "refresh"
            ? await controller.refreshPreservingFilters(auth.accessToken)
            : await controller.bootstrap(auth.accessToken);
        markJobsListBootstrapped();
        syncJobsListUiFromSnapshot(controller.getSnapshot());
        if (result === "unauthenticated") {
          await auth.signOut({ source: "401", reason: "jobs_list_unauthenticated" });
        }
      })();
    }, [auth.accessToken, auth.signOut, controller]),
  );

  async function onFilter(value: JobListBucket) {
    const result = await controller.setBucket(auth.accessToken, value);
    if (result === "unauthenticated") {
      await auth.signOut({ source: "401", reason: "jobs_list_unauthenticated" });
    }
  }

  async function onRetry() {
    const result = await controller.retry(auth.accessToken);
    if (result === "unauthenticated") {
      await auth.signOut({ source: "401", reason: "jobs_list_unauthenticated" });
    }
  }

  async function onLoadMore() {
    const result = await controller.loadMore(auth.accessToken);
    if (result === "unauthenticated") {
      await auth.signOut({ source: "401", reason: "jobs_list_unauthenticated" });
    }
  }

  function onNewJob() {
    pushCreateJob((href) => {
      router.push(href as Href);
    });
  }

  return (
    <Screen testID="jobs-list-screen">
      <Stack.Screen options={{ title: "Jobs", headerBackTitle: "Back" }} />
      <Title>Jobs</Title>
      <PrimaryButton label="New job" onPress={onNewJob} />
      <Field
        label="Search jobs"
        value={snapshot.searchInput}
        onChangeText={(value) => controller.setSearchInput(auth.accessToken, value)}
        placeholder="Search by title or customer"
        autoCapitalize="none"
      />
      <View style={styles.filterRow} accessibilityRole="tablist">
        {FILTERS.map((filter) => {
          const selected = snapshot.bucket === filter.value;
          return (
            <Pressable
              key={filter.value}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={filter.label}
              onPress={() => void onFilter(filter.value)}
              style={[styles.filterChip, selected ? styles.filterChipSelected : null]}
            >
              <Text style={[styles.filterLabel, selected ? styles.filterLabelSelected : null]}>
                {filter.label}
              </Text>
            </Pressable>
          );
        })}
        {snapshot.phase === "loading" && snapshot.items.length > 0 ? (
          <ActivityIndicator
            color={colors.primary}
            accessibilityLabel="Refreshing jobs"
            style={styles.filterSpinner}
          />
        ) : null}
      </View>

      <ErrorBanner
        message={snapshot.errorMessage}
        onRetry={snapshot.errorRetryable ? () => void onRetry() : undefined}
      />

      <JobsListBody snapshot={snapshot} onNewJob={onNewJob} onLoadMore={() => void onLoadMore()} />
    </Screen>
  );
}

export function JobsListBody(props: {
  snapshot: JobsListSnapshot;
  onNewJob: () => void;
  onLoadMore: () => void;
}) {
  const { snapshot } = props;

  if (showJobsInitialLoading(snapshot)) {
    return (
      <View style={styles.centered} accessibilityLabel="Loading jobs">
        <ActivityIndicator color={colors.primary} />
        <Secondary>Loading jobs…</Secondary>
      </View>
    );
  }

  if (showJobsEmptyState(snapshot)) {
    return (
      <View style={styles.centered} accessibilityLiveRegion="polite">
        <Body>
          {emptyJobsCopy({
            bucket: snapshot.bucket,
            appliedSearch: snapshot.appliedSearch,
          })}
        </Body>
        {showJobsNewJobInEmptyState(snapshot) ? (
          <PrimaryButton label="New job" onPress={props.onNewJob} />
        ) : null}
      </View>
    );
  }

  return (
    <FlatList
      style={{ flex: 1 }}
      data={snapshot.items}
      keyExtractor={(item) => item.id}
      contentContainerStyle={{ gap: 8, paddingBottom: 24 }}
      keyboardShouldPersistTaps={JOBS_LIST_KEYBOARD_SHOULD_PERSIST_TAPS}
      keyboardDismissMode="on-drag"
      renderItem={({ item }) => {
        const row = presentJobCard(item);
        return (
          <JobCard
            title={row.title}
            customerName={row.customerName}
            lifecycleLabel={row.lifecycleLabel}
            accessibilityLabel={row.accessibilityLabel}
          />
        );
      }}
      ListFooterComponent={
        snapshot.nextCursor ? (
          <PrimaryButton
            label={snapshot.phase === "loading_more" ? "Loading…" : "Load more"}
            onPress={props.onLoadMore}
            loading={snapshot.phase === "loading_more"}
            disabled={snapshot.loadMoreBlocked || snapshot.phase === "loading_more"}
          />
        ) : null
      }
    />
  );
}

/** Read-only S05 summary card — no navigation until S08 Job Detail exists. */
export function JobCard(props: {
  title: string;
  customerName: string;
  lifecycleLabel: string;
  accessibilityLabel: string;
}) {
  return (
    <View
      testID="job-card"
      accessibilityRole="summary"
      accessibilityLabel={props.accessibilityLabel}
      style={styles.card}
    >
      <Text style={styles.cardTitle}>{props.title}</Text>
      <Text style={styles.cardMeta}>{props.customerName}</Text>
      <Text style={styles.cardStatus}>{props.lifecycleLabel}</Text>
    </View>
  );
}

// Re-export for tests that need the create-job path constant from the screen module tree.
export { CREATE_JOB_HREF };

const styles = StyleSheet.create({
  filterRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
  },
  filterSpinner: {
    marginLeft: 4,
  },
  filterChip: {
    minHeight: layout.minTouchTarget,
    paddingHorizontal: 14,
    borderRadius: layout.cornerRadius,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#ffffff",
  },
  filterChipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.primary,
  },
  filterLabel: {
    fontSize: typography.secondary.fontSize,
    color: colors.text,
    fontWeight: "600",
  },
  filterLabelSelected: {
    color: "#ffffff",
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    paddingVertical: 24,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: layout.cornerRadius,
    padding: 12,
    gap: 4,
    backgroundColor: "#ffffff",
    minHeight: layout.minTouchTarget,
  },
  cardTitle: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: colors.text,
  },
  cardMeta: {
    fontSize: typography.secondary.fontSize,
    color: colors.secondary,
  },
  cardStatus: {
    fontSize: typography.secondary.fontSize,
    color: colors.text,
    fontWeight: "600",
    marginTop: 2,
  },
});
