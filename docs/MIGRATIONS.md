# Database migrations

Alembic is the authoritative schema change mechanism. Run it from the
repository root before starting a shared or production API:

```bash
.venv/bin/alembic upgrade head
```

The first migration is `0001_initial`, creating saves and action receipts.
Application startup does not create or alter tables automatically.

For a brand-new local database, the command above is sufficient. If a local
database was created by an earlier development build using `create_all`, stop
the application and inspect it before choosing a recovery path. Only use
`alembic stamp head` after verifying that its schema exactly matches the
migration; otherwise export any needed test data and create a fresh local
database. Never stamp or drop a shared/production database as a shortcut.

Every future migration must include a compatibility note for existing saves,
an upgrade test, and a rollback or forward-only rationale.
