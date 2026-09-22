import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import {
  emptyWorkspaceSetupDraft,
  type WorkspaceSetupDraft,
} from "@job-to-invoice/domain";

type SetupContextValue = {
  draft: WorkspaceSetupDraft;
  update: (patch: Partial<WorkspaceSetupDraft>) => void;
  reset: (timezone: string) => void;
};

const SetupContext = createContext<SetupContextValue | undefined>(undefined);

function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
}

export function SetupDraftProvider(props: { children: ReactNode }) {
  const [draft, setDraft] = useState<WorkspaceSetupDraft>(() =>
    emptyWorkspaceSetupDraft(deviceTimeZone()),
  );
  const value = useMemo(
    () => ({
      draft,
      update: (patch: Partial<WorkspaceSetupDraft>) => {
        setDraft((current) => ({ ...current, ...patch }));
      },
      reset: (timezone: string) => setDraft(emptyWorkspaceSetupDraft(timezone)),
    }),
    [draft],
  );
  return <SetupContext.Provider value={value}>{props.children}</SetupContext.Provider>;
}

export function useSetupDraft(): SetupContextValue {
  const value = useContext(SetupContext);
  if (!value) {
    throw new Error("useSetupDraft must be used within SetupDraftProvider");
  }
  return value;
}
