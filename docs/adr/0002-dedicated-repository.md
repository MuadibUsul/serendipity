# ADR-0002: A dedicated repository

- **Status:** accepted
- **Date:** 2026-11-05
- **Supersedes:** decisions 1 (location) and 2 (one CI) of
  [ADR-0001](0001-monorepo-location-and-toolchain.md)

## Context

ADR-0001 placed the code in `serendipity/` inside `MuadibUsul/veynod`, because that was the only
repository the project's agents could reach, and listed "a dedicated repository" as an open owner
decision. The owner then created `MuadibUsul/serendipity`.

## Decision

1. The code lives at the root of `MuadibUsul/serendipity`. The history of `serendipity/` was moved
   with `git subtree split --prefix=serendipity`, so the first commit is the `ser-p01-01` skeleton.
2. This repository has its own CI, `.github/workflows/ci.yml`: one job, `check`, that runs `npm ci`
   and `npm run check` on every pull request and on `main`.
3. The Veynod copy (`serendipity/` and its CI wiring on Veynod branch
   `claude/optimistic-newton-e3qeyn`) is not merged into Veynod; nothing of Serendipity remains in
   the Veynod repository.
4. The Veynod workspace stays the home of the product documents and the task board (namespace
   `serendipity`); only the code moved.

## Consequences

- A Serendipity pull request runs only Serendipity's checks: about a minute, and no coupling to
  Veynod's suites or release workflow.
- Branch protection for `main` now concerns this repository: require the `check` job and, once the
  owner names them, code-owner review for the paths in `CONTRIBUTING.md`.
- The license is still the owner's decision (ADR-0001, open decisions); the repository declares
  none until then.
