# AGENTS.md

## Cost-aware agent delegation

- Delegate suitable independent work to `gpt-6-luna` with `xhigh` reasoning when it is expected to save time and total tokens after setup, coordination, and handoff costs.
- Apply this rule to ongoing work as well as new tasks. Keep immediate blockers, security-critical judgment, difficult integration, ambiguous architecture, and final synthesis with the main agent.
- Do not delegate when the overhead erases the benefit. If the cheaper agent is unavailable, blocked, or unreliable, complete the work with the main agent or use a stronger model when necessary for correctness.

## Playground scope

This repository is the clean-cutover Devneya Playground. It is a documentation-light React application, not a place for backend or provider-specific product logic.

## Resuming work

Read `HANDOFF.md` for the saved implementation state, local launch and validation commands. `PRODUCT_NOTES.md` records the accepted interface; retained experiments are not the default product.

## Required boundaries

- Keep the graph model pure and testable under `src/domain/`.
- Keep HTTP and credential handling under `src/api/`; never mix GoTrue JWTs with Bifrost virtual keys.
- Use Supabase only through `src/auth/` for GoTrue authentication.
- Keep workspace persistence in IndexedDB under the `devneya-playground` database and `workspaces` object store.
- Do not add hardcoded model catalogs or provider logos; models come from `/llm/v1/models`.
- Do not add secrets to source, `.env` files, tests, or Git history.

## Verification

Before a handoff, run `npm run typecheck`, `npm run lint`, `npm test`, and `npm run test:coverage`. Run `npm run test:e2e` when Chromium is available.

## Git

Do not leave `Co-authored-by: Cursor` on commit messages. Hooks may re-inject it; amend with `git -c core.hooksPath=/dev/null commit --amend` before push.

## Deployment
