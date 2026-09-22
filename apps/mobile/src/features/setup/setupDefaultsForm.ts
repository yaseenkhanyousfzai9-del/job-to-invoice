import {
  validateSetupStep3,
  workspaceCreateBodyFromDraft,
  type WorkspaceSetupDraft,
} from "@job-to-invoice/domain";

export type SetupStep3ContinueResult = {
  canSubmit: boolean;
  errors: Record<string, string>;
  timezonePresent: boolean;
  timezoneConfirmed: boolean;
  createEnabled: boolean;
  body: Record<string, unknown> | null;
};

/** Create is enabled only after the user confirms timezone (validation still runs on submit). */
export function isSetupStep3CreateEnabled(draft: WorkspaceSetupDraft): boolean {
  return draft.timezone_confirmed;
}

export function runSetupStep3Create(draft: WorkspaceSetupDraft): SetupStep3ContinueResult {
  const errors = validateSetupStep3(draft);
  const canSubmit = Object.keys(errors).length === 0;
  return {
    canSubmit,
    errors,
    timezonePresent: draft.timezone.trim().length > 0,
    timezoneConfirmed: draft.timezone_confirmed,
    createEnabled: isSetupStep3CreateEnabled(draft),
    body: canSubmit ? workspaceCreateBodyFromDraft(draft) : null,
  };
}

export function firstSetupStep3Error(errors: Record<string, string>): string | null {
  return Object.values(errors)[0] ?? null;
}
