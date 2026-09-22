import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { Body, PrimaryButton, Screen, Secondary, Title } from "../../src/components/ui";
import {
  CUSTOMERS_LIST_HREF,
  CUSTOMERS_NEW_HREF,
} from "../../src/features/customers/customerRoutes";
import { CREATE_JOB_HREF, JOBS_LIST_HREF } from "../../src/features/jobs/jobRoutes";
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
        Open Jobs to search Active, Finished, and Archived work. Create a job to bind an active
        customer, or open Customers to manage contacts.
      </Secondary>
      {created ? <Body>Customer created.</Body> : null}
      <PrimaryButton label="Jobs" onPress={() => router.push(JOBS_LIST_HREF as Href)} />
      <PrimaryButton label="Create job" onPress={() => router.push(CREATE_JOB_HREF)} />
      <PrimaryButton label="Customers" onPress={() => router.push(CUSTOMERS_LIST_HREF)} />
      <PrimaryButton label="Add customer" onPress={() => router.push(CUSTOMERS_NEW_HREF)} />
      <PrimaryButton label="Sign out" onPress={() => void auth.signOut()} />
    </Screen>
  );
}
