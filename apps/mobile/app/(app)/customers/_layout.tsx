import { Stack } from "expo-router";
import { colors } from "../../../src/theme/tokens";

/**
 * Nested stack so list → detail / new push correctly under /(app)/customers.
 * Without this layout, dynamic [id] pushes can fail to leave the list screen.
 */
export default function CustomersLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.primary,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Customers", headerBackTitle: "Back" }} />
      <Stack.Screen name="new" options={{ title: "New Customer", headerBackTitle: "Back" }} />
      <Stack.Screen name="[id]" options={{ headerShown: false }} />
    </Stack>
  );
}
