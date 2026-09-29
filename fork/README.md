# chickenputty/t3code fork

This fork is upstream [pingdotgg/t3code](https://github.com/pingdotgg/t3code) `main` plus Adam's
patches. A daily task on Adam's PC merges upstream into the fork, builds the Windows app and
publishes it as a release here. The installed app updates itself from those releases, so upstream
changes and the patches arrive together.

## Branches

| Ref                    | What it is                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `upstream/main`        | pingdotgg/t3code, untouched.                                                                                      |
| `main`                 | The fork: upstream plus the patches. Commit patches here. The sync only ever fast-forwards it.                    |
| `archive/2026-03-fork` | The March 2026 fork (Claude and Gemini adapters, PWA, thread tools) on the old bun toolchain, kept for reference. |

Upstream arrives by merge, never rebase, so `main` is never rewritten and nothing is force-pushed.
A conflict is resolved once and stays resolved.

## Make a patch

1. Edit in `C:\Users\Adam\Workspaces\Misc\t3code` (or a worktree branched from `main`).
2. Commit to `main` and push. Keep each patch a focused commit with a clear subject; the release
   notes list them.
3. Run `pwsh fork/fork.ps1 sync` to build and publish now, or leave it for the daily run.
4. T3 Code shows the update on its next check. Restart it to apply.

Try a change without publishing: `vp run dev:desktop` runs the app from source against
`~/.t3/dev`, never the live `~/.t3/userdata`. `pwsh fork/fork.ps1 sync -NoPublish` builds the
installer only.

Put fork-only files under `fork/`. Upstream never touches that folder, so it never conflicts.

## What the sync does

`pwsh fork/fork.ps1 sync` (the task "T3 Code fork sync", daily 05:17, catches up after a missed run):

1. Fetches `upstream/main` and `origin`.
2. Stops if nothing changed since the last published build.
3. In its own worktree (`%LOCALAPPDATA%\t3code-fork\build`), merges upstream into `main`.
   On a conflict it stops, leaves `main` alone and shows a Windows notification.
4. Installs dependencies, typechecks when a patch touches app code, builds the resource
   monitor with its own Rust (`%LOCALAPPDATA%\t3code-fork\rustup`, latest stable, apart from the
   system Rust) and builds the NSIS installer.
5. Pushes the result to `origin/main`, publishes release `v<version>` here (draft first, public
   once every file is up) and fast-forwards `main` in the checkout. If the checkout has local
   edits that the update would overwrite, git refuses and the status says so.
6. Keeps the last 5 releases and the last 3 local builds.

Versions look like `0.0.43-fork.20260929.1`: the next patch after upstream's package version, the
date and a counter, the same shape as upstream nightlies. The app compares versions, so each build
reads as newer. Only `-nightly` and `-preview` versions change the app's name and icon, so the fork
keeps "T3 Code (Alpha)" and its data folders.

The build bakes in the same public T3 Connect settings as official builds (Clerk key, JWT
template, CLI OAuth client, relay URL) so sign-in, the relay and mobile pairing keep working. It
leaves out T3's own tracing token and the WSL runtime (projects inside WSL are not supported by
fork builds).

## Commands

```powershell
pwsh fork/fork.ps1 status          # checkout, patches, last build, installed app, task
pwsh fork/fork.ps1 patches         # the fork patches on top of upstream, with a diffstat
pwsh fork/fork.ps1 sync            # merge upstream, build, publish (what the task runs)
pwsh fork/fork.ps1 sync -NoPublish # build the installer only
pwsh fork/fork.ps1 sync -Force     # rebuild and republish even if nothing changed
pwsh fork/fork.ps1 merge           # merge upstream into main in the checkout, to resolve by hand
pwsh fork/fork.ps1 install         # install the newest fork build when T3 Code quits
pwsh fork/fork.ps1 install -Version 0.0.43-fork.20260929.1   # roll back to an older build
pwsh fork/fork.ps1 task install    # (re)register the daily task; task run starts it now
```

Logs, state and builds live in `%LOCALAPPDATA%\t3code-fork` (`logs\`, `state.json`, `release\`).

## When the sync reports a conflict

Upstream changed code that a patch also changes. In the checkout, on a clean `main`:

```powershell
pwsh fork/fork.ps1 merge   # merges upstream/main and lists the conflicts
# resolve, keeping what the patch is for on top of the new upstream code
git add <files>; git commit --no-edit
vp i; vp run --filter <package> typecheck
pwsh fork/fork.ps1 sync
```

If upstream now does what a patch did, drop the patch side in the resolution.

## Switching the installed app to the fork, and back

The official app updates from pingdotgg. `pwsh fork/fork.ps1 install` switches it once:

1. Snapshots the live T3 database (`~/.t3/userdata/state.sqlite`, read-only `VACUUM INTO`) to
   `%LOCALAPPDATA%\t3code-fork\backups` (only the newest snapshot is kept).
2. Waits for T3 Code to quit (a one-shot task, so it survives T3 closing), installs silently and
   reopens T3 Code. Every running agent session ends when T3 Code quits.

After that the app updates from this fork's releases like any other update.

Fork builds track upstream `main`, which is ahead of the latest stable release, so the app
migrates the database forward the way a nightly does. To go back to the official app, install the
latest official release from pingdotgg/t3code; if it cannot read the newer database, restore the
snapshot from `backups` while T3 Code is closed.

## Setup on a new machine

1. `irm https://vite.plus/ps1 | iex`, then move its two `vite-plus` PATH entries to the end of the
   user PATH (its shims would otherwise shadow the system `bun`, `pnpm` and `yarn`). Inside this
   repo `vp` runs Node 24 from `engines.node`.
2. Rust via rustup (the sync installs its own stable into its state folder), Python 3, Visual
   Studio 2022 with C++ build tools. The Spectre libraries upstream lists are not needed: the sync
   builds the resource monitor itself and passes `T3CODE_DESKTOP_REUSE_RESOURCE_MONITOR=1`.
3. `git remote add upstream git@github.com:pingdotgg/t3code.git`, `vp i`, then
   `pwsh fork/fork.ps1 task install`.

GitHub Actions are disabled on this fork: upstream's workflows need their Blacksmith runners, and
the build runs on Adam's PC instead.
