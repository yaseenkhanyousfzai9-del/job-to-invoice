import { useLocalSearchParams, useRouter } from "expo-router";
import { Body, PrimaryButton, Screen, Secondary, Title } from "../../src/components/ui";
import { useAuth } from "../../src/providers/AuthProvider";

export default function OwnerShellScreen() {
  const auth = useAuth();
  const router = useRouter();
  const params = useLocalSearchParams<{ customerCreated?: string }>();
  const created = params.customerCreated === "1";

  return (
    <Screen>
      <Title>Job to Invoice</Title>
      <Body>{`Signed in as ${auth.me?.user.display_email ?? "owner"}.`}</Body>
      <Secondary>
        Jobs, quotes, and invoices are not implemented yet. You can add a customer from this shell.
      </Secondary>
      {created ? (
        <Body>Customer created.</Body>
      ) : null}
      <PrimaryButton label="Add customer" onPress={() => router.push("/(app)/customers/new")} />
      <PrimaryButton label="Sign out" onPress={() => void auth.signOut()} />
    </Screen>
  );
}
