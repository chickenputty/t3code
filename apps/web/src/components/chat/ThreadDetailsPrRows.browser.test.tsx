import { EnvironmentId, ThreadId, type ThreadPullRequestLink } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";

import { act, render, type Screen } from "../../../test/render";

const watchCommand = vi.hoisted(() => vi.fn());

// The row queries its own pull request; this test covers only which rows the list shows.
vi.mock(import("./ThreadDetailsPrRow"), async (importOriginal) => ({
  ...(await importOriginal()),
  ThreadDetailsPrRow: ({
    number,
    onStopWatching,
  }: {
    number: number;
    onStopWatching?: (() => void) | undefined;
  }) => (
    <div data-row={String(number)}>
      {onStopWatching ? <button onClick={onStopWatching}>Stop watching #{number}</button> : null}
    </div>
  ),
}));
vi.mock(import("~/state/entities"), async (importOriginal) => ({
  ...(await importOriginal()),
  useProjects: () => [],
}));
vi.mock(import("~/state/use-atom-command"), async (importOriginal) => ({
  ...(await importOriginal()),
  useAtomCommand: (() => watchCommand) as never,
}));

import { ThreadDetailsPrRows } from "./ThreadDetailsPrRows";

function link(
  number: number,
  headBranch: string,
  baseBranch: string,
  updatedAt: string,
): ThreadPullRequestLink {
  return {
    host: "github.com",
    repository: "pingdotgg/t3code",
    number,
    url: `https://github.com/pingdotgg/t3code/pull/${number}`,
    source: "manual",
    linkedAt: updatedAt,
    snapshot: {
      state: "open",
      title: `Change ${number}`,
      headBranch,
      baseBranch,
      isDraft: false,
      updatedAt,
      syncedAt: updatedAt,
    },
    stack: null,
  };
}

const bottom = link(1, "layer-one", "main", "2026-01-01T00:00:10.000Z");
const top = link(2, "layer-two", "layer-one", "2026-01-01T00:00:20.000Z");
const other = link(3, "unrelated", "main", "2026-01-01T00:00:05.000Z");

function renderRows(links: ReadonlyArray<ThreadPullRequestLink>, current: ThreadPullRequestLink) {
  return render(
    <ThreadDetailsPrRows
      threadRef={{
        environmentId: EnvironmentId.make("environment"),
        threadId: ThreadId.make("thread"),
      }}
      links={links}
      currentLink={current}
      onOpenLink={vi.fn()}
      environmentId={EnvironmentId.make("environment")}
      pr={null}
      number={current.number}
      reference={current}
      status={null}
      project={null}
      label={`#${current.number}`}
      openAriaLabel="Open pull request"
      onOpen={vi.fn()}
    />,
  );
}

const rows = (screen: Screen) =>
  [...screen.container.querySelectorAll("[data-row]")].map((node) => node.getAttribute("data-row"));
const toggleButton = (screen: Screen) =>
  [...screen.container.querySelectorAll("button")].find((button) =>
    /^(Show \d+ more( of \d+)?|Show less)$/.test(button.textContent?.trim() ?? ""),
  );
const toggleLabel = (screen: Screen) => toggleButton(screen)?.textContent?.trim();

function toggle(screen: Screen) {
  return act(() => toggleButton(screen)!.click());
}

it("shows only the current pull request until the rest are asked for", async () => {
  await using screen = await renderRows([other, bottom, top], top);
  expect(rows(screen)).toEqual(["2"]);
  expect(toggleLabel(screen)).toBe("Show 2 more");

  await toggle(screen);
  expect(rows(screen)).toEqual(["2", "1", "3"]);
  expect(toggleLabel(screen)).toBe("Show less");

  await toggle(screen);
  expect(rows(screen)).toEqual(["2"]);
  expect(toggleLabel(screen)).toBe("Show 2 more");
});

it("keeps the single row untouched when the thread links one pull request", async () => {
  await using screen = await renderRows([bottom], bottom);
  expect(rows(screen)).toEqual(["1"]);
  expect(toggleLabel(screen)).toBeUndefined();
});

it("lets only watched pull requests stop their watch", async () => {
  const watched: ThreadPullRequestLink = {
    ...bottom,
    watch: {
      startedAt: "2026-01-01T00:00:30.000Z",
      headSha: null,
      failedChecks: [],
      passed: false,
      passedChecks: [],
      remarksThrough: "2026-01-01T00:00:30.000Z",
      remarkIds: [],
      conflicting: false,
      wakes: 0,
    },
  };
  await using screen = await renderRows([other, watched, top], top);
  await toggle(screen);
  const stopButtons = [...screen.container.querySelectorAll("button")].filter((button) =>
    button.textContent?.startsWith("Stop watching"),
  );
  expect(stopButtons.map((button) => button.textContent)).toEqual(["Stop watching #1"]);

  await act(() => stopButtons[0]!.click());
  expect(watchCommand).toHaveBeenCalledWith({
    environmentId: EnvironmentId.make("environment"),
    input: {
      threadId: ThreadId.make("thread"),
      host: "github.com",
      repository: "pingdotgg/t3code",
      number: 1,
      watching: false,
    },
  });
});

it("mounts the other pull requests ten at a time", async () => {
  const many = Array.from({ length: 25 }, (_, index) =>
    link(
      100 + index,
      `branch-${index}`,
      "main",
      `2026-01-01T00:${String(index).padStart(2, "0")}:00.000Z`,
    ),
  );
  await using screen = await renderRows(many, many[0]!);
  expect(rows(screen)).toHaveLength(1);
  expect(toggleLabel(screen)).toBe("Show 10 more of 24");

  await toggle(screen);
  expect(rows(screen)).toHaveLength(11);
  expect(toggleLabel(screen)).toBe("Show 10 more of 14");

  await toggle(screen);
  expect(rows(screen)).toHaveLength(21);
  expect(toggleLabel(screen)).toBe("Show 4 more");

  await toggle(screen);
  expect(rows(screen)).toHaveLength(25);
  expect(toggleLabel(screen)).toBe("Show less");

  await toggle(screen);
  expect(rows(screen)).toHaveLength(1);
});
