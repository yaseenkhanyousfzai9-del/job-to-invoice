import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Stack, useFocusEffect, useLocalSearchParams, useRouter, type Href } from "expo-router";
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
  emptyCustomersCopy,
  presentCustomerRow,
  showCustomersEmptyState,
  showCustomersInitialLoading,
  type CustomersListSnapshot,
} from "../../../src/features/customers/customersList";
import {
  customersListHasBootstrapped,
  markCustomersListBootstrapped,
  nextCustomersListFocusAction,
  obtainCustomersListController,
  syncCustomersListUiFromSnapshot,
} from "../../../src/features/customers/customersListSession";
import {
  CUSTOMERS_LIST_KEYBOARD_SHOULD_PERSIST_TAPS,
  CUSTOMERS_NEW_HREF,
  pushCustomerDetail,
} from "../../../src/features/customers/customerRoutes";
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
  const controller = useMemo(() => obtainCustomersListController(), []);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const snapshot = controller.getSnapshot();
  const handledCreateParam = useRef<string | null>(null);

  useEffect(() => {
    return controller.subscribe(() => {
      syncCustomersListUiFromSnapshot(controller.getSnapshot());
      rerender();
    });
  }, [controller]);

  useEffect(() => {
    return () => {
      // Keep shared controller + UI session across Detail/New; only sync latest fields.
      syncCustomersListUiFromSnapshot(controller.getSnapshot());
    };
  }, [controller]);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const action = nextCustomersListFocusAction(customersListHasBootstrapped());
        const result =
          action === "refresh"
            ? await controller.refreshPreservingFilters(auth.accessToken)
            : await controller.bootstrap(auth.accessToken);
        markCustomersListBootstrapped();
        syncCustomersListUiFromSnapshot(controller.getSnapshot());
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

  function onOpenCustomer(customerId: string) {
    pushCustomerDetail((href) => {
      router.push(href as Href);
    }, customerId);
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
        onOpenCustomer={onOpenCustomer}
      />
    </Screen>
  );
}

export function CustomersListBody(props: {
  snapshot: CustomersListSnapshot;
  onAddCustomer: () => void;
  onLoadMore: () => void;
  onOpenCustomer: (customerId: string) => void;
}) {
  const { snapshot } = props;
  const rowsEnabled = snapshot.phase !== "loading" || snapshot.items.length > 0;

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
      keyboardShouldPersistTaps={CUSTOMERS_LIST_KEYBOARD_SHOULD_PERSIST_TAPS}
      keyboardDismissMode="on-drag"
      renderItem={({ item }) => {
        const row = presentCustomerRow(item);
        return (
          <CustomerRow
            name={row.name}
            email={row.email}
            phone={row.phone}
            archivedLabel={row.archivedLabel}
            accessibilityLabel={row.accessibilityLabel}
            disabled={!rowsEnabled}
            onPress={() => props.onOpenCustomer(row.id)}
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

/** Extracted for press-target tests; keeps the whole row tappable. */
export function CustomerRow(props: {
  name: string;
  email: string | null;
  phone: string | null;
  archivedLabel: string | null;
  accessibilityLabel: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      testID="customer-row"
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel}
      accessibilityState={{ disabled: Boolean(props.disabled) }}
      disabled={props.disabled}
      onPress={props.onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
    >
      <View style={styles.rowText} pointerEvents="none">
        <Text style={styles.rowName}>{props.name}</Text>
        {props.email ? <Text style={styles.rowMeta}>{props.email}</Text> : null}
        {props.phone ? <Text style={styles.rowMeta}>{props.phone}</Text> : null}
        {props.archivedLabel ? (
          <Text style={styles.archived}>{props.archivedLabel}</Text>
        ) : null}
      </View>
      <Text style={styles.chevron} accessibilityElementsHidden importantForAccessibility="no">
        ›
      </Text>
    </Pressable>
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
    gap: 8,
    backgroundColor: "#ffffff",
    minHeight: layout.minTouchTarget,
    flexDirection: "row",
    alignItems: "center",
  },
  rowPressed: {
    opacity: 0.85,
  },
  rowText: {
    flex: 1,
    gap: 4,
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
  chevron: {
    fontSize: 22,
    color: colors.secondary,
    paddingLeft: 8,
  },
  archived: {
    fontSize: typography.secondary.fontSize,
    color: colors.text,
    fontWeight: "600",
    marginTop: 2,
  },
});
