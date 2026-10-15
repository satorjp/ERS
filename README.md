# IT Equipment Request — Backend

NestJS + Prisma + PostgreSQL API for requesting and approving IT equipment.
Database design: [`../database-design.md`](../database-design.md)

## Requirements

- Node.js 20+
- Docker (for PostgreSQL)

## Setup

```bash
npm install
cp .env.example .env          # then set JWT_SECRET
npm run db:up                 # PostgreSQL on localhost:5433
npm run prisma:deploy         # apply migrations
npm run prisma:seed           # seed users / equipment / sample requests
npm run start:dev             # http://localhost:3001
```

- API docs (Swagger): http://localhost:3001/docs
- Health check: `GET /health`

During development, use `npm run prisma:migrate` to create new migrations.
`npm run prisma:seed` is re-runnable: it wipes all tables first.

## Test accounts

| Email | Password | Role |
|---|---|---|
| `admin@company.com` | `Admin@1234` | ADMIN |
| `employee1@company.com` | `Employee@1234` | EMPLOYEE |
| `employee2@company.com` | `Employee@1234` | EMPLOYEE |

Seed data also includes one INACTIVE item (`IBM Model M (Retired)`), one out-of-stock item
(`Samsung 32" Curved Monitor`), 24 requests across all statuses and a matching stock ledger.

## Project structure

```
src/
├── main.ts                     # bootstrap (CORS, Swagger)
├── app.module.ts               # root module + global guards
├── app.setup.ts                # global pipes/filters (shared with e2e tests)
├── config/                     # env validation
├── database/                   # PrismaService / PrismaModule (global)
├── common/                     # cross-cutting, feature-agnostic code
│   ├── decorators/             # @Public, @Roles, @CurrentUser
│   ├── guards/                 # JwtAuthGuard, RolesGuard
│   ├── filters/                # Prisma error → HTTP mapping
│   ├── dto/                    # PaginationQueryDto
│   ├── interfaces/             # AuthUser, JwtPayload
│   ├── transformers/           # @Trim
│   └── utils/                  # paginate()
└── modules/                    # one folder per feature
    ├── <feature>/
    │   ├── dto/                # request validation
    │   ├── <feature>.controller.ts
    │   ├── <feature>.service.ts
    │   ├── <feature>.select.ts # Prisma select shapes (response contract)
    │   └── <feature>.module.ts
    ├── auth/  (+ strategies/)
    ├── categories/
    ├── equipment/
    ├── health/
    ├── requests/
    └── stock-movements/
prisma/                         # schema, migrations, seed
test/
├── setup/                      # test DB bootstrap (migrate + seed "<db>_test")
├── utils/test-app.ts           # shared app/login/fixture helpers
└── *.e2e-spec.ts               # one spec per feature
```

## API

All routes except `POST /auth/login` and `GET /health` require `Authorization: Bearer <token>`.

| Method | Path | Role | Description |
|---|---|---|---|
| POST | `/auth/login` | Public | `{ email, password }` → `{ accessToken, user }` |
| GET | `/auth/me` | Any | Current user |
| GET | `/categories` | Any | All categories |
| GET | `/equipment` | Any | `?q=&categoryId=&status=&page=&limit=` — employees only see ACTIVE |
| GET | `/equipment/:id` | Any | Equipment detail |
| POST | `/equipment` | Admin | Create equipment; opening stock is recorded as a RESTOCK movement |
| PATCH | `/equipment/:id` | Admin | Update name / category / status (stock is changed via `/stock-movements`) |
| POST | `/requests` | Employee | `{ equipmentId, quantity, reason }` → PENDING request |
| GET | `/requests/me` | Employee | Own requests `?status=&q=&page=&limit=` |
| GET | `/requests` | Admin | All requests `?status=&q=&page=&limit=` (`q` matches equipment or requester name) |
| GET | `/requests/:id` | Owner / Admin | Request detail + audit log timeline |
| PATCH | `/requests/:id/approve` | Admin | Approve and deduct stock (single transaction) |
| PATCH | `/requests/:id/reject` | Admin | `{ rejectReason }` → REJECTED (stock unchanged) |
| GET | `/stock-movements` | Admin | Stock ledger `?equipmentId=&type=&requestId=&page=&limit=` |
| POST | `/stock-movements` | Admin | `{ equipmentId, type: RESTOCK\|ADJUST\|RETURN, quantityChange, note?, requestId? }` |

Paginated responses are shaped as `{ data: T[], meta: { page, limit, total, totalPages } }`.

Error codes: `400` invalid input, `401` missing/invalid token, `403` wrong role,
`404` not found (including other employees' requests), `409` business-rule conflict
(request not pending, out of stock, equipment inactive).

## Design notes

- **Auth:** global `JwtAuthGuard` (opt-out with `@Public()`) and `RolesGuard` (`@Roles(Role.ADMIN)`),
  so every new route is protected by default.
- **Validation:** global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted`; strings are trimmed
  so blank reasons are rejected.
- **Approve transaction:** conditional updates inside one `prisma.$transaction`:
  1. `UPDATE request ... WHERE status = 'PENDING'` — 0 rows ⇒ 409 (prevents double approval)
  2. `UPDATE equipment SET stock = stock - qty WHERE stock >= qty AND status = 'ACTIVE'` — 0 rows ⇒ 409
  3. insert `stock_movements` (REQUEST_APPROVED, balance_after)
  4. insert audit log

  Any thrown error rolls back all steps. PostgreSQL row locks on the conditional `UPDATE` make
  concurrent approvals safe without locking whole tables.
- **Stock ledger (`stock_movements`):** `StockMovementsService.applyChange()` is the only code that
  changes `equipment.stock_quantity`. It does a conditional update and inserts a movement row
  (`type`, signed `quantity_change`, `balance_after`, actor, optional request, note) in the caller's
  transaction. Approval writes `REQUEST_APPROVED` atomically with the status change. Invariant:
  `SUM(quantity_change)` per equipment = `stock_quantity`, and an e2e test checks it.
  - `RESTOCK` / `RETURN` must be positive. `ADJUST` may be ±, and requires a note.
  - A `RETURN` linked to a request must reference an APPROVED request for the same equipment and
    cannot exceed the issued quantity.
- **Defence in depth:** DB-level CHECK constraints (stock ≥ 0, quantity > 0, non-blank reason,
  reject-reason/review-field consistency) in `prisma/migrations/*_constraints_and_search_indexes`.
- **Search:** `pg_trgm` GIN indexes on `equipment.name` and `users.full_name` for `ILIKE '%q%'`.

## Tests

```bash
npm test              # unit tests (RequestsService, mocked Prisma)
npm run test:e2e      # e2e against a separate "<db>_test" database (migrated + seeded automatically)
```

The e2e suites cover role enforcement, input validation, transaction rollback on insufficient stock,
double-approval prevention, concurrent approvals never overselling, stock ledger rules, and the
ledger/stock reconciliation invariant.
