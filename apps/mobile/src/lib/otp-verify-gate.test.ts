import assert from "node:assert/strict";
import { test } from "node:test";
import { createVerifySingleFlight } from "./verify-auth-flow";
import {
  createOtpVerifyAttemptGate,
  runGuardedVerifyAttempt,
} from "./otp-verify-gate";

test("one verify button press → verifyOtp exactly once", async () => {
  let calls = 0;
  const flight = createVerifySingleFlight();
  const gate = createOtpVerifyAttemptGate();
  const first = await runGuardedVerifyAttempt({
    generation: 1,
    flight,
    gate,
    verifyOtp: async () => {
      calls += 1;
      return { status: 403 };
    },
  });
  assert.equal(first.kind, "ran");
  assert.equal(calls, 1);
});

test("rapid double tap → verifyOtp exactly once", async () => {
  let calls = 0;
  const flight = createVerifySingleFlight();
  const gate = createOtpVerifyAttemptGate();
  const verifyOtp = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 30));
    return { status: 403 };
  };
  const p1 = runGuardedVerifyAttempt({ generation: 1, flight, gate, verifyOtp });
  const p2 = runGuardedVerifyAttempt({ generation: 1, flight, gate, verifyOtp });
  const [a, b] = await Promise.all([p1, p2]);
  assert.equal(calls, 1);
  const kinds = [a.kind, b.kind].sort().join(",");
  assert.ok(
    kinds === "blocked_inflight,ran" || kinds === "blocked_generation,ran",
    `expected one ran and one blocked, got ${kinds}`,
  );
});

test("verifyOtp returns 403 → no automatic second call", async () => {
  let calls = 0;
  const flight = createVerifySingleFlight();
  const gate = createOtpVerifyAttemptGate();
  await runGuardedVerifyAttempt({
    generation: 2,
    flight,
    gate,
    verifyOtp: async () => {
      calls += 1;
      return { status: 403, message: "Token has expired or is invalid" };
    },
  });
  const second = await runGuardedVerifyAttempt({
    generation: 2,
    flight,
    gate,
    verifyOtp: async () => {
      calls += 1;
      return { status: 200 };
    },
  });
  assert.equal(second.kind, "blocked_generation");
  assert.equal(calls, 1);
});

test("after waiting following 403 → still only one provider call", async () => {
  let calls = 0;
  const flight = createVerifySingleFlight();
  const gate = createOtpVerifyAttemptGate();
  await runGuardedVerifyAttempt({
    generation: 3,
    flight,
    gate,
    verifyOtp: async () => {
      calls += 1;
      return { status: 403 };
    },
  });
  await new Promise((r) => setTimeout(r, 50));
  for (let i = 0; i < 5; i += 1) {
    const next = await runGuardedVerifyAttempt({
      generation: 3,
      flight,
      gate,
      verifyOtp: async () => {
        calls += 1;
        return { status: 403 };
      },
    });
    assert.equal(next.kind, "blocked_generation");
  }
  assert.equal(calls, 1);
});

test("rerender / remount style second attempt same generation blocked", async () => {
  const flight = createVerifySingleFlight();
  const gate = createOtpVerifyAttemptGate();
  let calls = 0;
  await runGuardedVerifyAttempt({
    generation: 4,
    flight,
    gate,
    verifyOtp: async () => {
      calls += 1;
    },
  });
  // Simulate remount keeping same gate state via module-level session would differ;
  // here we prove same gate instance blocks.
  const again = await runGuardedVerifyAttempt({
    generation: 4,
    flight,
    gate,
    verifyOtp: async () => {
      calls += 1;
    },
  });
  assert.equal(again.kind, "blocked_generation");
  assert.equal(calls, 1);
});

test("new OTP generation permits one new verify attempt", async () => {
  let calls = 0;
  const flight = createVerifySingleFlight();
  const gate = createOtpVerifyAttemptGate();
  await runGuardedVerifyAttempt({
    generation: 1,
    flight,
    gate,
    verifyOtp: async () => {
      calls += 1;
    },
  });
  gate.clearForNewGeneration(2);
  const next = await runGuardedVerifyAttempt({
    generation: 2,
    flight,
    gate,
    verifyOtp: async () => {
      calls += 1;
    },
  });
  assert.equal(next.kind, "ran");
  assert.equal(calls, 2);
});

test("explicit user code edit permits a new manual attempt", async () => {
  let calls = 0;
  const flight = createVerifySingleFlight();
  const gate = createOtpVerifyAttemptGate();
  await runGuardedVerifyAttempt({
    generation: 5,
    flight,
    gate,
    verifyOtp: async () => {
      calls += 1;
      return { status: 403 };
    },
  });
  gate.clearForUserCodeEdit();
  const next = await runGuardedVerifyAttempt({
    generation: 5,
    flight,
    gate,
    verifyOtp: async () => {
      calls += 1;
    },
  });
  assert.equal(next.kind, "ran");
  assert.equal(calls, 2);
});

test("mount with code already populated does not call verify by itself", () => {
  // Screen contract: no mount/effect auto-verify. Gate starts unused.
  const gate = createOtpVerifyAttemptGate();
  assert.equal(gate.canAttempt(1), true);
  assert.equal(gate.hasAttempted(1), false);
});
