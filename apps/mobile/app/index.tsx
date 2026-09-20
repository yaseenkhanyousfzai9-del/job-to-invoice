import { Redirect, useRouter } from "expo-router";
import { ActivityIndicator, View } from "react-native";
import {
  Body,
  ErrorBanner,
  PrimaryButton,
  Screen,
  Secondary,
  TextLink,
  Title,
} from "../src/components/ui";
import { useAuth } from "../src/providers/AuthProvider";
import { colors } from "../src/theme/tokens";

export default function WelcomeScreen() {
  const router = useRouter();
  const auth = useAuth();

  if (auth.loading) {
    return (
      <Screen>
        <View style={{ flex: 1, justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} accessibilityLabel="Restoring session" />
        </View>
      </Screen>
    );
  }

  if (auth.navigation === "setup") {
    return <Redirect href="/setup" />;
  }
  if (auth.navigation === "app") {
    return <Redirect href="/(app)" />;
  }
  if (auth.navigation === "suspended") {
    return <Redirect href="/suspended" />;
  }

  // Persisted session present but /v1/me failed — keep session; offer Retry (no OTP).
  if (auth.navigation === "sign_in" && auth.accessToken) {
    return (
      <Screen>
        <Title>Job to Invoice</Title>
        <Body>We’re restoring your account.</Body>
        <ErrorBanner
          message={auth.error}
          onRetry={
            auth.bootstrapRetryable
              ? () => {
                  void auth.retryBootstrap();
                }
              : undefined
          }
        />
        <Secondary>Your sign-in is saved. Check your connection, then retry.</Secondary>
      </Screen>
    );
  }

  return (
    <Screen>
      <Title>Job to Invoice</Title>
      <Body>
        Create professional quotes, get customer approval, and turn accepted work into invoices.
      </Body>
      <Secondary>
        No purchase is required to start. Quotes are not created until after you sign in and set up
        your business.
      </Secondary>
      {auth.error ? <ErrorBanner message={auth.error} /> : null}
      <PrimaryButton
        label="Create my first quote"
        onPress={() => router.push("/sign-in")}
      />
      <PrimaryButton label="Sign in" onPress={() => router.push("/sign-in")} />
      <TextLink label="Terms" onPress={() => router.push("/legal/terms")} />
      <TextLink label="Privacy" onPress={() => router.push("/legal/privacy")} />
    </Screen>
  );
}
