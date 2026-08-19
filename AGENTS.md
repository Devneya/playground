# AGENTS.md

## Playground scope

This repository is the clean-cutover Devneya Playground. It is a documentation-light React application, not a place for backend or provider-specific product logic.

## Required boundaries

- Keep the graph model pure and testable under `src/domain/`.
- Keep HTTP and credential handling under `src/api/`; never mix GoTrue JWTs with Bifrost virtual keys.
- Use Supabase only through `src/auth/` for GoTrue authentication.
- Keep workspace persistence in IndexedDB under the `devneya-playground` database and `workspaces` object store.
- Do not add hardcoded model catalogs or provider logos; models come from `/llm/v1/models`.
- Do not add secrets to source, `.env` files, tests, or Git history.

## Verification

Before a handoff, run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run test:coverage`. Run `npm run test:e2e` when Chromium is available.

## Deployment
