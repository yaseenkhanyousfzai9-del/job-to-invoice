import { Stack } from "expo-router";
import { colors } from "../../src/theme/tokens";

export default function SetupLayout() {
  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerTintColor: colors.primary,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
