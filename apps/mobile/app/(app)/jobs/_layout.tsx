import { Stack } from "expo-router";
import { colors } from "../../../src/theme/tokens";

/**
 * Nested stack so list → New Job push correctly under /(app)/jobs.
 * S08 Job Detail ([id]) is intentionally absent.
 */
export default function JobsLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.primary,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Jobs", headerBackTitle: "Back" }} />
      <Stack.Screen name="new" options={{ title: "Create Job", headerBackTitle: "Back" }} />
    </Stack>
  );
}
