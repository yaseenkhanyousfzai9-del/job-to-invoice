import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider } from "../src/providers/AuthProvider";
import { SetupDraftProvider } from "../src/providers/SetupDraftProvider";
import { colors } from "../src/theme/tokens";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <SetupDraftProvider>
          <StatusBar style="dark" />
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.background },
              headerTintColor: colors.primary,
              headerTitleStyle: { fontWeight: "700" },
              contentStyle: { backgroundColor: colors.background },
            }}
          />
        </SetupDraftProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
