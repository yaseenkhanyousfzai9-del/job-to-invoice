import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import type { CustomerListState } from "@job-to-invoice/domain";
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
  createCustomersListController,
  emptyCustomersCopy,
  presentCustomerRow,
  showCustomersEmptyState,
  showCustomersInitialLoading,
  type CustomersListSnapshot,
} from "../../../src/features/customers/customersList";
import { CUSTOMERS_NEW_HREF } from "../../../src/features/customers/customerRoutes";
import { useAuth } from "../../../src/providers/AuthProvider";
import { colors, layout, typography } from "../../../src/theme/tokens";

const FILTERS: { label: string; value: CustomerListState }[] = [
  { label: "Active", value: "active" },
  { label: "Archived", value: "archived" },
  { label: "All", value: "all" },
];

export default function CustomersListScreen() {
  const auth = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ customerCreated?: string }>();
  const controller = useMemo(() => createCustomersListController(), []);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const snapshot = controller.getSnapshot();
  const bootstrapped = useRef(false);
  const handledCreateParam = useRef<string | null>(null);

  useEffect(() => {
    return controller.subscribe(() => rerender());
  }, [controller]);

  useEffect(() => {
    return () => controller.dispose();
  }, [controller]);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const result = bootstrapped.current
          ? await controller.refreshPreservingFilters(auth.accessToken)
          : await controller.bootstrap(auth.accessToken);
        bootstrapped.current = true;
        if (result === "unauthenticated") {
          await auth.signOut({ source: "401", reason: "customers_list_unauthenticated" });
        }
      })();
      // Depend on accessToken only — whole `auth` object identity must not re-fetch on each render.
    }, [auth.accessToken, auth.signOut, controller]),
  );

  useEffect(() => {
    if (params.customerCreated !== "1") return;
    if (handledCreateParam.current === "1") return;
    handledCreateParam.current = "1";
    void (async () => {
      const result = await controller.refreshPreservingFilters(auth.accessToken);
      if (result === "unauthenticated") {
        await auth.signOut({ source: "401", reason: "customers_list_unauthenticated" });
      }
      router.setParams({ customerCreated: undefined });
    })();
  }, [auth, controller, params.customerCreated, router]);

  async function onFilter(value: CustomerListState) {
    const result = await controller.setStateFilter(auth.accessToken, value);
    if (result === "unauthenticated") {
      await auth.signOut({ source: "401", reason: "customers_list_unauthenticated" });
    }
  }

  async function onRetry() {
    const result = await controller.retry(auth.accessToken);
    if (result === "unauthenticated") {
      await auth.signOut({ source: "401", reason: "customers_list_unauthenticated" });
    }
  }

  async function onLoadMore() {
    const result = await controller.loadMore(auth.accessToken);
    if (result === "unauthenticated") {
      await auth.signOut({ source: "401", reason: "customers_list_unauthenticated" });
    }
  }

  return (
    <Screen testID="customers-list-screen">
      <Stack.Screen options={{ title: "Customers", headerBackTitle: "Back" }} />
      <Title>Customers</Title>
      <PrimaryButton
        label="Add customer"
        onPress={() => router.push(CUSTOMERS_NEW_HREF)}
      />
      <Field
        label="Search customers"
        value={snapshot.searchInput}
        onChangeText={(value) => controller.setSearchInput(auth.accessToken, value)}
        placeholder="Search by name or email"
        autoCapitalize="none"
      />
      <View style={styles.filterRow} accessibilityRole="tablist">
        {FILTERS.map((filter) => {
          const selected = snapshot.stateFilter === filter.value;
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
            accessibilityLabel="Refreshing customers"
            style={styles.filterSpinner}
          />
        ) : null}
      </View>

      <ErrorBanner
        message={snapshot.errorMessage}
        onRetry={snapshot.errorRetryable ? () => void onRetry() : undefined}
      />

      <CustomersListBody
        snapshot={snapshot}
        onAddCustomer={() => router.push(CUSTOMERS_NEW_HREF)}
        onLoadMore={() => void onLoadMore()}
      />
    </Screen>
  );
}

function CustomersListBody(props: {
  snapshot: CustomersListSnapshot;
  onAddCustomer: () => void;
  onLoadMore: () => void;
}) {
  const { snapshot } = props;

  if (showCustomersInitialLoading(snapshot)) {
    return (
      <View style={styles.centered} accessibilityLabel="Loading customers">
        <ActivityIndicator color={colors.primary} />
        <Secondary>Loading customers…</Secondary>
      </View>
    );
  }

  if (showCustomersEmptyState(snapshot)) {
    return (
      <View style={styles.centered} accessibilityLiveRegion="polite">
        <Body>
          {emptyCustomersCopy({
            stateFilter: snapshot.stateFilter,
            appliedSearch: snapshot.appliedSearch,
          })}
        </Body>
        {snapshot.appliedSearch === null && snapshot.stateFilter !== "archived" ? (
          <PrimaryButton label="Add customer" onPress={props.onAddCustomer} />
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
      keyboardShouldPersistTaps="handled"
      renderItem={({ item }) => {
        const row = presentCustomerRow(item);
        return (
          <View
            accessible
            accessibilityLabel={row.accessibilityLabel}
            style={styles.row}
          >
            <Text style={styles.rowName}>{row.name}</Text>
            {row.email ? <Text style={styles.rowMeta}>{row.email}</Text> : null}
            {row.phone ? <Text style={styles.rowMeta}>{row.phone}</Text> : null}
            {row.archivedLabel ? (
              <Text style={styles.archived}>{row.archivedLabel}</Text>
            ) : null}
          </View>
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

const styles = StyleSheet.create({
  filterRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
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
  row: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: layout.cornerRadius,
    padding: 12,
    gap: 4,
    backgroundColor: "#ffffff",
    minHeight: layout.minTouchTarget,
  },
  rowName: {
    fontSize: typography.body.fontSize,
    fontWeight: "600",
    color: colors.text,
  },
  rowMeta: {
    fontSize: typography.secondary.fontSize,
    color: colors.secondary,
  },
  archived: {
    fontSize: typography.secondary.fontSize,
    color: colors.text,
    fontWeight: "600",
    marginTop: 2,
  },
});
