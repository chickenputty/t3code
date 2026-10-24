import { assert, describe, it } from "@effect/vitest";
import {
  LedgerId,
  LedgerItemId,
  MessageId,
  NodeId,
  ProviderInstanceId,
  RunId,
  RuntimeRequestId,
  ThreadId,
  type Ledger,
  type LedgerItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { deriveTaskTiming, summarizeTaskTiming, type TaskTimingInput } from "./TaskTiming.ts";

const T0 = Date.UTC(2026, 9, 1);
const at = (seconds: number) => DateTime.makeUnsafe(T0 + seconds * 1000);
const iso = (seconds: number) => DateTime.formatIso(at(seconds));
const seconds = (count: number) => count * 1000;

const threadId = ThreadId.make("thread:timing");
const claude = ProviderInstanceId.make("claudeAgent");
const codex = ProviderInstanceId.make("codex");
const ledgerId = LedgerId.make("ledger:timing");

const run = (
  ordinal: number,
  times: { requested: number; started: number | null; completed: number | null },
  status: TaskTimingInput["runs"][number]["status"],
) => ({
  id: RunId.make(`run:${ordinal}`),
  ordinal,
  status,
  providerInstanceId: claude,
  modelSelection: { instanceId: claude, model: "opus" },
  userMessageId: MessageId.make(`message:${ordinal}`),
  requestedAt: at(times.requested),
  startedAt: times.started === null ? null : at(times.started),
  completedAt: times.completed === null ? null : at(times.completed),
});

const task = (
  id: string,
  options: {
    role?: string;
    instanceId?: ProviderInstanceId;
    model: string;
    status: TaskTimingInput["delegated"][number]["task"]["status"];
    created: number;
    completed: number | null;
    childStarted: number | null;
  },
) => ({
  task: {
    id: NodeId.make(id),
    childThreadId: ThreadId.make(`child:${id}`),
    ...(options.role === undefined ? {} : { role: options.role }),
    providerInstanceId: options.instanceId ?? claude,
    model: options.model,
    status: options.status,
    startedAt: at(options.created),
    completedAt: options.completed === null ? null : at(options.completed),
  },
  childRun: options.childStarted === null ? undefined : { startedAt: at(options.childStarted) },
});

const item = (
  id: string,
  patch: Partial<LedgerItem> & Pick<LedgerItem, "status">,
  updatedAt: number,
): LedgerItem => ({
  id: LedgerItemId.make(id),
  title: `Item ${id}`,
  acceptance: "",
  evidence: null,
  dropReason: null,
  verdict: null,
  createdAt: at(20),
  updatedAt: at(updatedAt),
  closedAt: null,
  ...patch,
});

const verdict = (outcome: "pass" | "fail", whenSeconds: number) => ({
  outcome,
  judge: { instanceId: codex, model: "gpt-5" },
  notes: "",
  at: at(whenSeconds),
});

const update = (whenSeconds: number, next: LedgerItem) => ({
  at: at(whenSeconds),
  ledgerId,
  item: next,
});

const finalItems: ReadonlyArray<LedgerItem> = [
  item(
    "L1",
    {
      status: "closed",
      evidence: "e2",
      verdict: verdict("pass", 330),
      judgements: 2,
      closedAt: at(340),
    },
    340,
  ),
  item("L2", { status: "open" }, 20),
  item("L3", { status: "dropped", dropReason: "not needed" }, 250),
  // Picked up between runs 2 and 3 and still in progress, so runs 3 and 4 had work to move.
  item("L4", { status: "in_progress" }, 450),
];

const ledger: Ledger = {
  id: ledgerId,
  threadId,
  title: "Timing",
  startState: "",
  checkpoints: [],
  winConditions: [],
  items: finalItems,
  createdAt: at(20),
  updatedAt: at(340),
  closedAt: null,
};

const itemUpdates: TaskTimingInput["itemUpdates"] = [
  update(40, item("L1", { status: "in_progress" }, 40)),
  update(50, item("L3", { status: "in_progress" }, 50)),
  update(450, item("L4", { status: "in_progress" }, 450)),
  update(60, item("L3", { status: "open" }, 60)),
  update(100, item("L1", { status: "in_progress", evidence: "e1" }, 100)),
  update(
    110,
    item(
      "L1",
      { status: "in_progress", evidence: "e1", verdict: verdict("fail", 110), judgements: 1 },
      110,
    ),
  ),
  update(200, item("L3", { status: "in_progress" }, 200)),
  update(250, item("L3", { status: "dropped", dropReason: "not needed" }, 250)),
  update(310, item("L1", { status: "in_progress", evidence: "e2", judgements: 1 }, 310)),
  update(
    330,
    item(
      "L1",
      { status: "in_progress", evidence: "e2", verdict: verdict("pass", 330), judgements: 2 },
      330,
    ),
  ),
  update(
    340,
    item(
      "L1",
      {
        status: "closed",
        evidence: "e2",
        verdict: verdict("pass", 330),
        judgements: 2,
        closedAt: at(340),
      },
      340,
    ),
  ),
];

// Four runs, three delegated tasks, three requests and a ledger, observed at second 700.
const fixture: TaskTimingInput = {
  threadId,
  now: at(700),
  runs: [
    run(1, { requested: 0, started: 5, completed: 125 }, "completed"),
    run(2, { requested: 305, started: 305, completed: 365 }, "completed"),
    run(3, { requested: 500, started: 500, completed: 560 }, "completed"),
    run(4, { requested: 600, started: 600, completed: null }, "running"),
  ],
  userMessages: [
    { id: MessageId.make("message:1"), creationSource: "web" },
    { id: MessageId.make("message:2"), creationSource: "web" },
    { id: MessageId.make("message:3"), creationSource: "server" },
    { id: MessageId.make("message:4"), creationSource: "web" },
  ],
  delegated: [
    task("task:worker", {
      role: "worker",
      model: "sonnet",
      status: "completed",
      created: 10,
      childStarted: 20,
      completed: 80,
    }),
    task("task:judge", {
      role: "judge",
      instanceId: codex,
      model: "gpt-5",
      status: "completed",
      created: 90,
      childStarted: 90,
      completed: 110,
    }),
    task("task:plain", {
      model: "sonnet",
      status: "running",
      created: 610,
      childStarted: 615,
      completed: null,
    }),
  ],
  runtimeRequests: [
    {
      id: RuntimeRequestId.make("request:approval"),
      kind: "command",
      status: "resolved",
      createdAt: at(30),
      resolvedAt: at(120),
    },
    {
      id: RuntimeRequestId.make("request:quick"),
      kind: "user_input",
      status: "resolved",
      createdAt: at(520),
      resolvedAt: at(530),
    },
    {
      id: RuntimeRequestId.make("request:open"),
      kind: "permission",
      status: "pending",
      createdAt: at(640),
      resolvedAt: null,
    },
  ],
  ledger,
  itemUpdates,
};

describe("deriveTaskTiming", () => {
  it("times each run with its queue wait, model and who started it", () => {
    const timing = deriveTaskTiming(fixture);
    assert.deepEqual(
      timing.runs.map((entry) => [
        entry.ordinal,
        entry.startedAt,
        entry.endedAt,
        entry.durationMs,
        entry.queueWaitMs,
        entry.serverInitiated,
        entry.model,
      ]),
      [
        [1, iso(5), iso(125), seconds(120), seconds(5), false, "opus"],
        [2, iso(305), iso(365), seconds(60), 0, false, "opus"],
        [3, iso(500), iso(560), seconds(60), 0, true, "opus"],
        [4, iso(600), null, seconds(100), 0, false, "opus"],
      ],
    );
  });

  it("times delegated tasks by role, model and wait, counting an unfinished task up to now", () => {
    const timing = deriveTaskTiming(fixture);
    assert.deepEqual(
      timing.delegated.map((entry) => [
        entry.role,
        entry.instanceId,
        entry.model,
        entry.status,
        entry.durationMs,
        entry.waitMs,
        entry.endedAt,
      ]),
      [
        ["worker", claude, "sonnet", "completed", seconds(60), seconds(10), iso(80)],
        ["judge", codex, "gpt-5", "completed", seconds(20), 0, iso(110)],
        [null, claude, "sonnet", "running", seconds(85), seconds(5), null],
      ],
    );
    assert.deepEqual(
      timing.delegatedBy.map((entry) => [entry.role, entry.model, entry.tasks, entry.totalMs]),
      [
        ["general", "sonnet", 1, seconds(85)],
        ["worker", "sonnet", 1, seconds(60)],
        ["judge", "gpt-5", 1, seconds(20)],
      ],
    );
  });

  it("times ledger items from open to in progress to closed, with judge verdicts", () => {
    const [done, untouched, dropped] = deriveTaskTiming(fixture).ledgerItems;
    assert.deepEqual(done, {
      itemId: LedgerItemId.make("L1"),
      title: "Item L1",
      status: "closed",
      openedAt: iso(20),
      startedAt: iso(40),
      closedAt: iso(340),
      waitToStartMs: seconds(20),
      inProgressMs: seconds(300),
      openToCloseMs: seconds(320),
      judgeAttempts: 2,
      verdicts: [
        { outcome: "fail", at: iso(110), afterMs: seconds(10) },
        { outcome: "pass", at: iso(330), afterMs: seconds(20) },
      ],
    });
    assert.deepEqual(
      [untouched?.status, untouched?.startedAt, untouched?.inProgressMs, untouched?.openToCloseMs],
      ["open", null, 0, null],
    );
    // In progress for 50 to 60 and 200 to 250, with the stretch between spent back at open.
    assert.deepEqual(
      [dropped?.status, dropped?.inProgressMs, dropped?.closedAt, dropped?.openToCloseMs],
      ["dropped", seconds(60), iso(250), seconds(230)],
    );
  });

  it("finds stalls: pending requests, waiting on the user, idle gaps and runs without progress", () => {
    const timing = deriveTaskTiming(fixture);
    assert.deepEqual(
      timing.stalls.map((stall) => [
        stall.kind,
        stall.startedAt,
        stall.endedAt,
        stall.durationMs,
        stall.runId,
        stall.detail,
      ]),
      [
        ["pending_request", iso(30), iso(120), seconds(90), undefined, "command"],
        ["waiting_on_user", iso(125), iso(305), seconds(180), "run:2", undefined],
        ["idle_between_runs", iso(365), iso(500), seconds(135), "run:3", undefined],
        // Runs 1 and 2 moved items; run 3 ran a minute with none changing, and run 4 is still at it.
        ["no_ledger_progress", iso(500), iso(560), seconds(60), "run:3", undefined],
        ["no_ledger_progress", iso(600), null, seconds(100), "run:4", undefined],
        // Still pending at now, so it has no end and counts up to it.
        ["pending_request", iso(640), null, seconds(60), undefined, "permission"],
      ],
    );
  });

  it("keeps short gaps and quick requests out of the stalls", () => {
    const timing = deriveTaskTiming({ ...fixture, stallThresholdMs: seconds(200) });
    assert.deepEqual(
      timing.stalls.map((stall) => stall.kind),
      [],
    );
  });

  it("totals wall, agent, queue, delegated and stalled time", () => {
    const { totals } = deriveTaskTiming(fixture);
    assert.deepEqual(totals, {
      wallMs: seconds(700),
      agentMs: seconds(340),
      queueMs: seconds(5),
      delegatedMs: seconds(165),
      // The run without ledger progress overlaps run time, so it is not stalled time of its own.
      // The 180 s wait on the user is reported apart so a long absence does not swamp this.
      stalledMs: seconds(285),
      waitingOnUserMs: seconds(180),
    });
  });

  it("counts time that two stalls share once", () => {
    const { totals } = deriveTaskTiming({
      ...fixture,
      runtimeRequests: [
        ...fixture.runtimeRequests,
        // Inside the 365 to 500 idle gap, which it extends past by 20 s.
        {
          id: RuntimeRequestId.make("request:overlap"),
          kind: "command",
          status: "resolved",
          createdAt: at(400),
          resolvedAt: at(520),
        },
      ],
    });
    // 90 + (365..520 = 155) + 60 for the open permission request.
    assert.equal(totals.stalledMs, seconds(305));
  });

  it("calls a gap waiting on a delegate when a task ran through it and a wake ended it", () => {
    const running = task("task:long", {
      role: "worker",
      model: "sonnet",
      status: "completed",
      created: 380,
      childStarted: 385,
      completed: 495,
    });
    const timing = deriveTaskTiming({ ...fixture, delegated: [...fixture.delegated, running] });
    const gaps = timing.stalls.filter((stall) => stall.runId === RunId.make("run:3"));
    assert.deepEqual(
      gaps.map((stall) => stall.kind),
      ["waiting_on_delegate", "no_ledger_progress"],
    );
    // Delegated waits count as stalled time, not as time spent waiting on the user.
    assert.equal(timing.totals.stalledMs, seconds(285));
    assert.equal(timing.totals.waitingOnUserMs, seconds(180));
  });

  it("keeps a gap idle when a delegated task only grazes it", () => {
    // Ends 5 s into the 365 to 500 gap, far short of half of it.
    const grazing = task("task:graze", {
      role: "worker",
      model: "sonnet",
      status: "completed",
      created: 300,
      childStarted: 305,
      completed: 370,
    });
    const timing = deriveTaskTiming({ ...fixture, delegated: [...fixture.delegated, grazing] });
    const gaps = timing.stalls.filter((stall) => stall.runId === RunId.make("run:3"));
    assert.deepEqual(
      gaps.map((stall) => stall.kind),
      ["idle_between_runs", "no_ledger_progress"],
    );
  });

  it("keeps a gap that a person ended as waiting on the user even with a task running", () => {
    const covering = task("task:cover", {
      model: "sonnet",
      status: "running",
      created: 130,
      childStarted: 135,
      completed: null,
    });
    const timing = deriveTaskTiming({ ...fixture, delegated: [...fixture.delegated, covering] });
    assert.equal(
      timing.stalls.find((stall) => stall.runId === RunId.make("run:2"))?.kind,
      "waiting_on_user",
    );
  });

  it("flags a run with no ledger progress only when some item was in progress during it", () => {
    const withoutOpenWork = deriveTaskTiming({
      ...fixture,
      ledger: { ...ledger, items: finalItems.filter((entry) => entry.id !== "L4") },
      itemUpdates: itemUpdates.filter((entry) => entry.item.id !== "L4"),
    });
    // Run 3 and run 4 run after L1 closed and L3 was dropped, with nothing in progress.
    assert.deepEqual(
      withoutOpenWork.stalls.filter((stall) => stall.kind === "no_ledger_progress"),
      [],
    );
    const withOpenWork = deriveTaskTiming(fixture);
    assert.deepEqual(
      withOpenWork.stalls
        .filter((stall) => stall.kind === "no_ledger_progress")
        .map((s) => s.runId),
      [RunId.make("run:3"), RunId.make("run:4")],
    );
  });

  it("stops the wall at the last run's end once nothing is running", () => {
    const settled = deriveTaskTiming({
      ...fixture,
      runs: fixture.runs.slice(0, 3),
      delegated: [],
      runtimeRequests: [],
    });
    assert.equal(settled.totals.wallMs, seconds(560));
  });

  it("returns an empty record for a thread that never ran", () => {
    const timing = deriveTaskTiming({
      threadId,
      now: at(10),
      runs: [],
      userMessages: [],
      delegated: [],
      runtimeRequests: [],
      ledger: undefined,
      itemUpdates: [],
    });
    assert.deepEqual(timing.totals, {
      wallMs: 0,
      agentMs: 0,
      queueMs: 0,
      delegatedMs: 0,
      stalledMs: 0,
      waitingOnUserMs: 0,
    });
    assert.deepEqual(
      [timing.runs, timing.delegated, timing.ledgerItems, timing.stalls],
      [[], [], [], []],
    );
  });

  it("does not read another ledger's item updates onto a reused item id", () => {
    const timing = deriveTaskTiming({
      ...fixture,
      itemUpdates: [
        {
          at: at(40),
          ledgerId: LedgerId.make("ledger:earlier"),
          item: item("L2", { status: "closed", closedAt: at(40) }, 40),
        },
      ],
    });
    assert.equal(timing.ledgerItems[1]?.status, "open");
    assert.equal(timing.ledgerItems[1]?.closedAt, null);
  });
});

describe("summarizeTaskTiming", () => {
  it("keeps counts and totals and trims the lists to the slowest few", () => {
    const summary = summarizeTaskTiming(deriveTaskTiming(fixture), 1);
    assert.deepEqual([summary.runCount, summary.delegatedCount, summary.stallCount], [4, 3, 6]);
    assert.deepEqual(
      summary.slowestRuns.map((entry) => entry.ordinal),
      [1],
    );
    assert.deepEqual(
      summary.slowestDelegated.map((entry) => entry.durationMs),
      [seconds(85)],
    );
    assert.deepEqual(
      summary.longestStalls.map((stall) => stall.durationMs),
      [seconds(180)],
    );
    assert.equal(summary.ledgerItems.length, 4);
    assert.equal(summary.totals.wallMs, seconds(700));
  });

  it("keeps only the last five verdicts of an item", () => {
    const attempts = Array.from({ length: 8 }, (_, index) => 100 + index * 10);
    const judged = deriveTaskTiming({
      ...fixture,
      itemUpdates: attempts.map((when) =>
        update(
          when,
          item(
            "L2",
            { status: "in_progress", evidence: `e${when}`, verdict: verdict("fail", when) },
            when,
          ),
        ),
      ),
    });
    assert.equal(judged.ledgerItems[1]?.verdicts.length, 8);
    const kept = summarizeTaskTiming(judged, 5).ledgerItems.find((entry) => entry.itemId === "L2");
    assert.deepEqual(
      kept?.verdicts.map((entry) => entry.at),
      attempts.slice(-5).map(iso),
    );
    assert.equal(kept?.judgeAttempts, 8);
  });
});
