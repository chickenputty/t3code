import { assert, it } from "@effect/vitest";
import {
  EventId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProjectStore from "./ProjectStore.ts";
import * as ThreadPreviews from "./ThreadPreviews.ts";

const layerTest = Layer.mergeAll(
  ThreadPreviews.layer,
  ProjectionStore.layer,
  ProjectStore.layer,
).pipe(Layer.provideMerge(SqlitePersistence.layerMemory));

const providerInstanceId = ProviderInstanceId.make("codex");
const at = (minute: number) => DateTime.makeUnsafe(Date.UTC(2026, 8, 27, 0, minute));

const createProject = (projectId: ProjectId) =>
  Effect.flatMap(ProjectStore.ProjectStoreV2, (projects) =>
    projects.apply({
      sequence: 0,
      eventId: EventId.make(`created:${projectId}`),
      aggregateKind: "project",
      aggregateId: projectId,
      occurredAt: DateTime.formatIso(at(0)),
      commandId: null,
      causationEventId: null,
      correlationId: null,
      metadata: {},
      type: "project.created",
      payload: {
        projectId,
        title: projectId,
        workspaceRoot: `/work/${projectId}`,
        defaultModelSelection: null,
        scripts: [],
        createdAt: DateTime.formatIso(at(0)),
        updatedAt: DateTime.formatIso(at(0)),
      },
    }),
  );

const thread = (
  threadId: ThreadId,
  projectId: ProjectId,
  overrides: { readonly archivedAt?: DateTime.Utc; readonly deletedAt?: DateTime.Utc } = {},
): OrchestrationV2DomainEvent => ({
  id: EventId.make(`created:${threadId}`),
  type: "thread.created",
  threadId,
  providerInstanceId,
  occurredAt: at(0),
  payload: {
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId,
    title: threadId,
    providerInstanceId,
    modelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdAt: at(0),
    updatedAt: at(0),
    archivedAt: overrides.archivedAt ?? null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: overrides.deletedAt ?? null,
  },
});

const message = (
  threadId: ThreadId,
  id: string,
  role: "user" | "assistant" | "system",
  text: string,
  options: { readonly minute?: number; readonly streaming?: boolean } = {},
): OrchestrationV2DomainEvent => ({
  id: EventId.make(`message:${id}`),
  type: "message.updated",
  threadId,
  providerInstanceId,
  occurredAt: at(options.minute ?? 1),
  payload: {
    createdBy: role === "user" ? "user" : "agent",
    creationSource: role === "user" ? "web" : "provider",
    id: MessageId.make(id),
    threadId,
    runId: null,
    nodeId: null,
    role,
    text,
    attachments: [],
    streaming: options.streaming ?? false,
    createdAt: at(options.minute ?? 1),
    updatedAt: at(options.minute ?? 1),
  },
});

it.layer(layerTest)("ThreadPreviews", (it) => {
  it.effect("returns the first user and last finished message per live thread", () =>
    Effect.gen(function* () {
      const projections = yield* ProjectionStore.ProjectionStoreV2;
      const previews = yield* ThreadPreviews.ThreadPreviews;
      const project = ProjectId.make("project:previews");
      yield* createProject(project);

      const both = ThreadId.make("thread:both");
      const assistantOnly = ThreadId.make("thread:assistant-only");
      const archived = ThreadId.make("thread:archived");
      const deleted = ThreadId.make("thread:deleted");
      const empty = ThreadId.make("thread:empty");
      const long = ThreadId.make("thread:long");
      const longText = `${"word ".repeat(100)}end`;
      const events: ReadonlyArray<OrchestrationV2DomainEvent> = [
        thread(both, project),
        message(both, "both-system", "system", "system prompt", { minute: 0 }),
        message(both, "both-assistant-early", "assistant", "assistant before user", { minute: 1 }),
        message(both, "both-user-old", "user", "  first\n\n  question  ", { minute: 2 }),
        message(both, "both-blank", "user", " \n\t ", { minute: 8 }),
        message(both, "both-user-new", "user", "second question", { minute: 4 }),
        message(both, "both-assistant", "assistant", "final answer", { minute: 5 }),
        message(both, "both-streaming", "assistant", "still typing", {
          minute: 6,
          streaming: true,
        }),
        message(both, "both-system-late", "system", "late system note", { minute: 7 }),
        thread(assistantOnly, project),
        message(assistantOnly, "assistant-only", "assistant", "only an answer"),
        thread(archived, project, { archivedAt: at(1) }),
        message(archived, "archived", "user", "archived question"),
        thread(deleted, project, { deletedAt: at(1) }),
        message(deleted, "deleted", "user", "deleted question"),
        thread(empty, project),
        message(empty, "empty-streaming", "user", "draft", { streaming: true }),
        thread(long, project),
        message(long, "long", "user", longText),
      ];
      yield* Effect.forEach(events, projections.apply, { discard: true });

      const result = yield* previews.getPreviews({
        threadIds: [both, assistantOnly, archived, deleted, empty, long, ThreadId.make("nope")],
      });
      const byId = new Map(result.previews.map((preview) => [preview.threadId, preview]));
      assert.deepEqual(
        [...byId.keys()].toSorted(),
        [archived, assistantOnly, both, long].toSorted(),
      );
      assert.deepEqual(byId.get(both), {
        threadId: both,
        first: "first question",
        last: "final answer",
      });
      assert.deepEqual(byId.get(assistantOnly), {
        threadId: assistantOnly,
        first: null,
        last: "only an answer",
      });
      assert.deepEqual(byId.get(archived), {
        threadId: archived,
        first: "archived question",
        last: "archived question",
      });
      const longPreview = byId.get(long)!;
      assert.isAtMost(longPreview.first!.length, 240);
      assert.isTrue(longPreview.first!.endsWith("…"));
      assert.isTrue(longText.startsWith(longPreview.first!.slice(0, -1)));
      assert.equal(longPreview.last, longPreview.first);

      // Only the requested threads are read.
      const single = yield* previews.getPreviews({ threadIds: [archived, archived] });
      assert.deepEqual(
        single.previews.map((preview) => preview.threadId),
        [archived],
      );
    }),
  );
});
