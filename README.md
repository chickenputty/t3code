# t3code

This repository is a fork of [pingdotgg/t3code](https://github.com/pingdotgg/t3code).

The original project is a minimal GUI for coding agents. This fork keeps that core idea, but pushes it toward a more capable and more reliable multi-provider workbench with better thread/session UX.

This fork exists because I use this kind of tool heavily across multiple projects, often working through dozens of threads in an hour. The goal is extreme usability and functionality under real daily use, not just a clean demo of the backend.

I also use it across my network from a Windows desktop, a Mac laptop, and my phone. A big part of the fork is making the web client hold up better in that environment, especially on mobile and other remote browser sessions. The original T3 Code backend is strong, but the frontend still needed work for high-volume use and cross-device access.

Today, the fork is centered on:

- Codex support through the existing app-server integration
- Claude Code support through a new provider adapter
- Better thread awareness for long-running, paused, resumed, and high-volume work
- Project-wide thread auto-rename for cleaning up low-signal thread titles
- Better sidebar management, search, and draft thread handling across many active threads
- Reliability-first behavior around persistence, orchestration, and recovery
- Better usability across desktop, laptop, and phone browsers on the same network

## Fork Difference

1. Multi-provider support
   - Added a Claude Code provider adapter on the server
   - Added provider-aware model contracts and Claude model support in the web app
   - Kept the orchestration pipeline provider-agnostic instead of adding one-off provider paths
2. Thread and chat UX
   - Added paused thread visibility in the sidebar
   - Added thread context jump support so important context is easy to revisit
   - Added project-wide thread auto-rename to clean up titles from real message context
   - Improved sidebar sorting, search, and status visibility for faster thread triage
   - Added better local draft thread handling so in-progress work shows up with useful titles
   - Added thread UX refinements around active plan display, mobile behavior, and higher-volume thread management
3. Reliability fixes
   - Fixed write-only SQLite statement handling in the server persistence layer
4. Developer ergonomics
   - Improved the dev runner for remote-host and multi-instance development setups
   - Better supports using the app from any browser on your network, which makes remote agentic coding practical

## Why This Fork

The original T3 Code has a strong backend and orchestration foundation. This fork is focused on pushing the frontend and overall product usability further.

The practical goal is simple:

- make it easier to manage many threads quickly
- make thread organization and naming hold up when moving fast across multiple projects
- make remote browser access a first-class workflow, not a side effect
- make phone usage actually useful
- make the app feel good enough to use as an everyday agent workspace across multiple machines

## Running This Fork

Prerequisites:

- [Bun](https://bun.sh/)
- Codex CLI installed and authenticated
- Claude Code installed if you want to use the Claude provider path

Install dependencies:

```bash
bun install
```

Run the full development stack:

```bash
bun dev
```

Useful variants:

```bash
bun dev:server
bun dev:web
bun dev:desktop
```

## Quality Gates

Before treating work as complete in this repo, both of these should pass:

```bash
bun lint
bun typecheck
```

For tests, use:

```bash
bun run test
```

Do not use `bun test` in this repository.

## Repository Shape

- `apps/server`: WebSocket server and provider/session orchestration
- `apps/web`: React UI for threads, events, approvals, and session state
- `apps/desktop`: Desktop shell
- `packages/contracts`: shared schemas and TypeScript contracts
- `packages/shared`: shared runtime utilities

## Status

This fork is intentionally willing to make larger architectural changes when they improve correctness, recoverability, and long-term maintainability.

## Contributing

Read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening an issue or PR.

Need support? Join the [Discord](https://discord.gg/jn4EGJjrvv).
