import { useState } from "react";
import { Redirect, useRouter } from "expo-router";
import { validateSetupStep1 } from "@job-to-invoice/domain";
import {
  Body,
  Field,
  PrimaryButton,
  Screen,
  Secondary,
  Title,
} from "../../src/components/ui";
import { useAuth } from "../../src/providers/AuthProvider";
import { useSetupDraft } from "../../src/providers/SetupDraftProvider";

export default function SetupNameScreen() {
  const router = useRouter();
  const auth = useAuth();
  const { draft, update } = useSetupDraft();
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (auth.loading) {
    return null;
  }
  if (auth.navigation === "welcome" || auth.navigation === "sign_in") {
    return <Redirect href="/sign-in" />;
  }
  if (auth.navigation === "app") {
    return <Redirect href="/(app)" />;
  }

  function onNext() {
    const nextErrors = validateSetupStep1(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length === 0) {
      router.push("/setup/contact");
    }
  }

  return (
    <Screen>
      <Title>Business name</Title>
      <Body>Step 1 of 3. This appears on future quotes and invoices.</Body>
      <Field
        label="Business display name"
        value={draft.business_name}
        onChangeText={(value) => update({ business_name: value })}
        error={errors["business_name"]}
        autoCapitalize="words"
      />
      <Field
        label="Legal name"
        value={draft.legal_name}
        onChangeText={(value) => update({ legal_name: value })}
        error={errors["legal_name"]}
        autoCapitalize="words"
      />
      <Secondary>Trade</Secondary>
      <PrimaryButton
        label={draft.trade === "handyman" ? "Handyman (selected)" : "Handyman"}
        onPress={() => update({ trade: "handyman" })}
      />
      <PrimaryButton
        label={draft.trade === "other" ? "Other (selected)" : "Other"}
        onPress={() => update({ trade: "other" })}
      />
      {errors["trade"] ? <Body>{errors["trade"]}</Body> : null}
      <PrimaryButton label="Continue" onPress={onNext} />
    </Screen>
  );
}
