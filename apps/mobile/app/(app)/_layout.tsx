import { Redirect, Stack } from "expo-router";
import { useAuth } from "../../src/providers/AuthProvider";
import { colors } from "../../src/theme/tokens";

export default function AppGroupLayout() {
  const auth = useAuth();
  if (!auth.loading && auth.navigation !== "app") {
    return <Redirect href="/" />;
  }
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
