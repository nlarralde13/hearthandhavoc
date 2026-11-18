# Hearth & Havoc development instructions

## Scope

This repository contains the Hearth & Havoc game. It is not an infrastructure
administration repository. Daedalus may work on code, tests, content, and
approved development deployment artifacts here; Proxmox, production, network,
credential, and destructive operations remain Cogsworth-controlled actions.

## Required workflow

1. Read the relevant design and architecture documents and inspect the actual
   repository state before changing files.
2. During the current development phase, direct commits to `main` are allowed
   after validation. Feature branches remain useful for risky or parallel work,
   but ordinary dev changes do not require a pull request.
3. Pull requests become required for production promotion, production/shared
   infrastructure changes, and any future release branch.
4. Keep commits focused and do not force-push, reset, or overwrite unrelated
   work.
5. Add deterministic tests for every domain rule and edge case.
6. Run focused tests, lint/type checks, and a build before reporting completion.
7. Report changed paths, commit, validation, risks, and remaining questions.

## Game rules

- The server is authoritative for state, rolls, rewards, timestamps, and
  inventory.
- Commands require a stable idempotency key and expected state version.
- Replayed commands return their stored receipt and do not execute twice.
- Canonical game definitions live in versioned `game_data/` files.
- Each save has a private server-generated deterministic seed; never expose the
  root seed to the browser.
- Qwen output is untrusted and may only propose allowlisted, validated intents.
- Essential gameplay must work with Qwen unavailable.

## Security and data

- Never commit secrets, tokens, private keys, `.env` files, credentials, or
  private player data.
- Validate all client input and keep public APIs separate from private save
  state.
- Do not copy production player data into development.
- Treat migrations and content-version changes as compatibility work.

## Deployment boundary

VM108 is the approved development target. VM111 is reserved for separately
approved release deployment. Do not restart shared services, alter VM/network
configuration, or deploy to production from this repository without explicit
owner approval.
