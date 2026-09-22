import { Stack } from "expo-router";
import { colors } from "../../../../src/theme/tokens";

/** Nested stack: Customer Detail ↔ Edit under /(app)/customers/[id]. */
export default function CustomerIdLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.primary,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Customer", headerBackTitle: "Customers" }} />
      <Stack.Screen name="edit" options={{ title: "Edit Customer", headerBackTitle: "Back" }} />
    </Stack>
  );
}
