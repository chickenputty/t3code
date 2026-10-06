import { ThreadDetailsControl } from "./ThreadDetailsControl";
import type { EnvironmentId, ScopedThreadRef, ThreadPullRequestLink } from "@t3tools/contracts";
import {
  resolveThreadPullRequestChains,
  threadPullRequestKeyOf,
  visibleThreadPullRequests,
} from "@t3tools/shared/threadPullRequests";
import { Minus, Plus } from "lucide";
import { useState, type ComponentProps, type MouseEvent as ReactMouseEvent } from "react";

import { findProjectOnChangeRequestHost, parseChangeRequestUrl } from "~/lib/openPullRequestLink";

import { useProjects } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";

import { pullRequestListLines } from "../pullRequest/pullRequestListLines";
import { MorphIcon } from "~/components/MorphIcon";
import { linkedPullRequestSnapshotStatus, prStatusIndicator } from "../ThreadStatusIndicators";

import { ThreadDetailsPrRow } from "./ThreadDetailsPrRow";

// Fork: each row reads its PR's detail and checks from GitHub, so mount at most this many more
// rows per "Show more".
const PR_ROWS_PAGE = 10;

function ThreadDetailsPrLinkRow({
  environmentId,
  link,
  onOpen,
  onActed,
  onStopWatching,
}: {
  environmentId: EnvironmentId;
  link: ThreadPullRequestLink;
  onOpen: (event: ReactMouseEvent<HTMLElement>) => void;
  onActed?: (() => void) | undefined;
  onStopWatching?: (() => void) | undefined;
}) {
  const projects = useProjects();
  const parsed = parseChangeRequestUrl(link.url);
  const project =
    parsed === null
      ? null
      : (findProjectOnChangeRequestHost(
          projects.filter((candidate) => candidate.environmentId === environmentId),
          parsed,
        ) ?? null);
  const linked = linkedPullRequestSnapshotStatus(link);
  const pr = linked?.pr ?? null;
  return (
    <ThreadDetailsPrRow
      environmentId={environmentId}
      pr={pr}
      number={link.number}
      reference={link}
      status={prStatusIndicator(pr, linked?.sourceControlProvider)}
      project={project}
      label={`#${link.number}${link.snapshot === null ? "" : `: ${link.snapshot.title}`}`}
      openAriaLabel={link.url}
      onOpen={onOpen}
      onStopWatching={onStopWatching}
      {...(onActed ? { onActed } : {})}
    />
  );
}

export function ThreadDetailsPrRows({
  threadRef,
  links,
  currentLink,
  onOpenLink,
  ...row
}: ComponentProps<typeof ThreadDetailsPrRow> & {
  threadRef: ScopedThreadRef;
  links: ReadonlyArray<ThreadPullRequestLink>;
  currentLink: ThreadPullRequestLink | null;
  onOpenLink: (event: ReactMouseEvent<HTMLElement>, url: string) => void;
}) {
  const [shown, setShown] = useState(0);
  const watch = useAtomCommand(threadEnvironment.watchPullRequest, { reportFailure: true });
  // Only watched links get the eye; the row hides it once the server records the stop.
  const stopWatching = (link: ThreadPullRequestLink | null) =>
    link?.watch === undefined
      ? undefined
      : () =>
          void watch({
            environmentId: threadRef.environmentId,
            input: {
              threadId: threadRef.threadId,
              host: link.host,
              repository: link.repository,
              number: link.number,
              watching: false,
            },
          });
  const currentRow = <ThreadDetailsPrRow {...row} onStopWatching={stopWatching(currentLink)} />;
  const rest =
    currentLink === null
      ? []
      : pullRequestListLines(resolveThreadPullRequestChains(visibleThreadPullRequests(links)))
          .map((line) => line.link)
          .filter((link) => threadPullRequestKeyOf(link) !== threadPullRequestKeyOf(currentLink));
  if (rest.length === 0) return currentRow;

  return (
    <>
      {currentRow}
      {shown > 0
        ? rest
            .slice(0, shown)
            .map((link) => (
              <ThreadDetailsPrLinkRow
                key={threadPullRequestKeyOf(link)}
                environmentId={row.environmentId}
                link={link}
                onOpen={(event) => onOpenLink(event, link.url)}
                onActed={row.onActed}
                onStopWatching={stopWatching(link)}
              />
            ))
        : null}
      <ThreadDetailsControl
        variant="ghost"
        size="sm"
        onClick={() =>
          setShown(shown >= rest.length ? 0 : Math.min(rest.length, shown + PR_ROWS_PAGE))
        }
        part="row"
        tone="muted"
        className="w-full active:scale-100"
      >
        <MorphIcon
          aria-hidden
          className="size-4 shrink-0"
          icon={shown >= rest.length ? Minus : Plus}
        />
        {shown >= rest.length
          ? "Show less"
          : `Show ${Math.min(PR_ROWS_PAGE, rest.length - shown)} more${
              rest.length - shown > PR_ROWS_PAGE ? ` of ${rest.length - shown}` : ""
            }`}
      </ThreadDetailsControl>
    </>
  );
}
