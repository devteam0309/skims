# SKIMS — project rules

Sangguniang Kabataan Integrated Program and Fund Management System, for SK officials in Marinduque.

## Scope: four municipalities, and only four

SKIMS covers **Boac, Gasan, Mogpog, and Santa Cruz**. That is the whole scope.

**Torrijos and Buenavista are out of scope. Never add them.** They were introduced unintentionally,
removed on 2026-07-25, and must not come back — not in seeders, constants, enums, fixtures, tests,
sample data, documentation, or as an "for completeness" addition when listing the municipalities of
Marinduque. The province has six; this system serves four. If a task seems to call for them, that is
a misunderstanding of scope, not a gap to fill — ask before adding.

Use the exact name **`Santa Cruz`**, not `Sta. Cruz`. That is what the database stores and what the
API returns, so any list compared against it by name silently drops the municipality otherwise.

## Municipality isolation is the core security property

Every module scopes to the signed-in user's municipality. Only `super_admin` and `provincial_admin`
span municipalities — `municipal_admin` is scoped, despite the name. Two defects have already come
from treating it as province-wide.

- Derive the municipality from `req.user`, never from the request body. On create, force it:
  the body value is ignored for scoped roles.
- Fail **closed**: when a user has no municipality, the filter must be `{ $in: [] }`, not omitted.
  An undefined value is dropped from the query by Mongoose, turning a missing field into a full read.
- Frontend hiding is not enforcement. Every restriction needs a backend guard, and the guard is
  what a change is judged on.

## Classification fields are free text

Program category, youth gender, educational attainment, document category, announcement type and
liquidation attachment types accept a typed value. Users must never be forced to pick "Other" when
the real value is known.

- Normalise on write with `normalizeLabel` from `backend/src/utils/labels.js`, so typed values group
  with existing ones instead of fragmenting the filters.
- **Gender is the exception**: stored exactly as typed, matched case-insensitively. Normalising
  "LGBTQIA+" would repeat the problem the change was made to fix.
- A field that accepts a custom value must also be **filterable** by one. Opening a form without
  opening its filter makes the custom entry write-only.

## Conventions

Peso amounts via `formatCurrency()` / `formatPHP()` with an explicit `₱` — never
`style: 'currency'`. Confirmations through `frontend/src/utils/confirm.js`. Explicit field
whitelists on every create and update; never pass `req.body` to a model. Approvals use atomic
`findOneAndUpdate` on the expected state and return 409 otherwise. `AuditLog` entries carry the
**record's** municipality, not `req.user`'s.

Commit messages carry no AI attribution — no `Co-Authored-By`, no generated-with footer.

## Testing

`npm test` in `backend/` runs serially (`--runInBand`); the parallel run is flaky on Windows because
each suite starts its own `MongoMemoryServer`. A lone red suite whose failures are all
`buffering timed out`, and which passes alone, is environmental — re-run before investigating.

## Local development writes to the live database

`backend/.env` points `MONGO_URI` at the shared Atlas cluster, by the owner's explicit choice. Local
writes are real writes. `npm run seed` wipes eleven collections and its guard only trips when
`NODE_ENV=production`, so it is unguarded locally — **confirm before running it**.
