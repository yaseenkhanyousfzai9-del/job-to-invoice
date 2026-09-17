import { Redirect } from "expo-router";
import { Body, PrimaryButton, Screen, Title } from "../src/components/ui";
import { useAuth } from "../src/providers/AuthProvider";

export default function SuspendedScreen() {
  const auth = useAuth();
  if (auth.navigation !== "suspended" && auth.navigation !== "deleting") {
    return <Redirect href="/" />;
  }
  return (
    <Screen>
      <Title>Account unavailable</Title>
      <Body>
        {auth.navigation === "deleting"
          ? "This account is locked for deletion."
          : "This account is suspended and cannot make changes."}
      </Body>
      <PrimaryButton label="Sign out" onPress={() => void auth.signOut()} />
    </Screen>
  );
}
