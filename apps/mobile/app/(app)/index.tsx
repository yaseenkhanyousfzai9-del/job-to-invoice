import { Body, PrimaryButton, Screen, Secondary, Title } from "../../src/components/ui";
import { useAuth } from "../../src/providers/AuthProvider";

export default function OwnerShellScreen() {
  const auth = useAuth();
  return (
    <Screen>
      <Title>Job to Invoice</Title>
      <Body>{`Signed in as ${auth.me?.user.display_email ?? "owner"}.`}</Body>
      <Secondary>
        Jobs, customers, quotes, and invoices are not implemented yet. This is the authenticated
        owner shell.
      </Secondary>
      <PrimaryButton label="Sign out" onPress={() => void auth.signOut()} />
    </Screen>
  );
}
