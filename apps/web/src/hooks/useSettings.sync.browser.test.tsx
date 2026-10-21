import { RegistryContext } from "@effect/atom-react";
import {
  AuthSettingsWriteScope,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentId,
  type AuthEnvironmentScope,
  type AuthSessionState,
  type ServerSettingsPatch,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult, Atom } from "effect/reactivity";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

type SessionResult = AsyncResult.AsyncResult<AuthSessionState, Error>;
const state = vi.hoisted(() => ({
  sessions: new Map<EnvironmentId, Atom.Writable<SessionResult>>(),
  environments: [] as Array<{
    environmentId: EnvironmentId;
    label: string;
    connection: { phase: "connected" | "disconnected" };
    serverConfig: {
      environment: { capabilities: { threadAutoSettlement: boolean } };
      settings: typeof DEFAULT_SERVER_SETTINGS;
    };
  }>,
  persist: vi.fn(),
  toast: vi.fn(),
}));

vi.mock(import("@t3tools/client-runtime/state/session"), async (original) => ({
  ...(await original()),
  createEnvironmentSessionAtoms: (() => ({
    sessionStateAtom: (id: EnvironmentId) => state.sessions.get(id)!,
  })) as never,
}));
vi.mock(import("~/state/environments"), async (original) => ({
  ...(await original()),
  useEnvironments: (() => ({ environments: state.environments })) as never,
  usePrimaryEnvironment: (() =>
    state.environments.find((environment) => environment.environmentId === primaryId) ??
    null) as never,
}));
vi.mock(import("~/state/use-atom-command"), async (original) => ({
  ...(await original()),
  useAtomCommand: (() => state.persist) as never,
}));
vi.mock(import("~/components/ui/toast"), async (original) => {
  const actual = await original();
  return { ...actual, toastManager: { ...actual.toastManager, add: state.toast } };
});

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useUpdatePrimarySettings } from "./useSettings";

const primaryId = EnvironmentId.make("primary");
const remoteId = EnvironmentId.make("remote");
const patch = { sidebarAutoSettleOnMerge: false } satisfies ServerSettingsPatch;
const session = (scopes: ReadonlyArray<AuthEnvironmentScope>): AuthSessionState => ({
  authenticated: true,
  scopes,
  auth: {
    policy: "remote-reachable",
    bootstrapMethods: ["one-time-token"],
    sessionMethods: ["bearer-access-token"],
    sessionCookieName: "t3_session",
  },
});
let root: Root;
let container: HTMLDivElement;

// Fork: the last save's outcome, for the saved-or-not tests below.
let lastSave: Promise<boolean> | undefined;

function SettingsEditor() {
  const updateSettings = useUpdatePrimarySettings();
  const save = () => {
    lastSave = updateSettings(patch);
  };
  return <button onClick={save}>Save shared setting</button>;
}

function saveSharedSettings() {
  container.querySelector("button")!.click();
}

async function mountEditor() {
  await act(() =>
    root.render(
      <RegistryContext.Provider value={appAtomRegistry}>
        <SettingsEditor />
      </RegistryContext.Provider>,
    ),
  );
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.sessions.clear();
  state.sessions.set(
    primaryId,
    Atom.make<SessionResult>(AsyncResult.success(session([AuthSettingsWriteScope]))),
  );
  state.sessions.set(remoteId, Atom.make<SessionResult>(AsyncResult.initial()));
  state.environments = [primaryId, remoteId].map((environmentId) => ({
    environmentId,
    label: environmentId,
    connection: { phase: "connected" },
    serverConfig: {
      environment: { capabilities: { threadAutoSettlement: true } },
      settings: DEFAULT_SERVER_SETTINGS,
    },
  }));
  state.persist.mockReset();
  state.persist.mockResolvedValue(AsyncResult.success(DEFAULT_SERVER_SETTINGS));
  state.toast.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

// Fork: callers holding an optimistic copy (saved views) learn whether the write landed.
describe("shared settings save outcome", () => {
  it("resolves false when the primary rejects the save", async () => {
    state.persist.mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new Error("Permission denied"))),
    );
    await mountEditor();
    await act(async () => saveSharedSettings());
    await expect(lastSave).resolves.toBe(false);
  });

  it("resolves true when the primary saves, even if a remote fails", async () => {
    state.persist.mockResolvedValueOnce(AsyncResult.success(DEFAULT_SERVER_SETTINGS));
    state.persist.mockResolvedValueOnce(
      AsyncResult.failure(Cause.fail(new Error("Permission denied"))),
    );
    await mountEditor();
    await act(async () => saveSharedSettings());
    await expect(lastSave).resolves.toBe(true);
  });

  it("resolves false when this connection lacks the grant", async () => {
    appAtomRegistry.set(state.sessions.get(primaryId)!, AsyncResult.success(session([])));
    await mountEditor();
    await act(async () => saveSharedSettings());
    await expect(lastSave).resolves.toBe(false);
  });
});
