# Attendly Backend Refactor

## Scope

This refactor is based only on the uploaded `src.zip`. That archive contained:

- `src/server.ts` — an Express application with HTTP setup, authentication, semester/subject APIs, attendance calculations, reports, backup/restore and LAN startup in one file.
- `src/db.ts` — SQLite connection setup, schema creation and additive compatibility upgrades.

The refactor restructures this **local Node.js + Express + better-sqlite3 backend**. It does not restructure the separately deployed Cloudflare Worker because that Worker source was not present in the uploaded archive.

## New source structure

```text
src/
├── app.ts                         # Express app assembly; no listen() side effect
├── server.ts                      # Runtime entry point, LAN URLs, shutdown handling
├── db.ts                          # Backward-compatible re-export of database connection
│
├── config/
│   ├── constants.ts               # Cookie, session and attendance constants
│   └── database.config.ts         # Database path configuration
│
├── database/
│   ├── connection.ts              # SQLite connection and pragmas
│   ├── schema.ts                  # Base table definitions
│   └── migrations.ts              # Additive upgrades for older local databases
│
├── models/                        # Domain/data contracts (not ORM classes)
│   ├── user.model.ts
│   ├── semester.model.ts
│   ├── subject.model.ts
│   └── attendance.model.ts
│
├── repositories/                  # All SQL queries and database writes
│   ├── auth.repository.ts
│   ├── semester.repository.ts
│   ├── subject.repository.ts
│   └── attendance.repository.ts
│
├── validators/                    # Request/input validation
│   ├── auth.validator.ts
│   ├── semester.validator.ts
│   ├── subject.validator.ts
│   ├── attendance.validator.ts
│   └── backup.validator.ts
│
├── services/                      # Business rules and workflows
│   ├── auth.service.ts
│   ├── semester.service.ts
│   ├── subject.service.ts
│   ├── attendance.service.ts
│   ├── calendar.service.ts
│   ├── analytics.service.ts
│   └── reports.service.ts
│
├── controllers/                   # HTTP request/response only
│   ├── auth.controller.ts
│   ├── semester.controller.ts
│   ├── subject.controller.ts
│   ├── attendance.controller.ts
│   ├── calendar.controller.ts
│   ├── analytics.controller.ts
│   ├── reports.controller.ts
│   └── backup.controller.ts
│
├── routes/                        # URL-to-controller mapping
│   ├── index.ts
│   ├── auth.routes.ts
│   ├── semester.routes.ts
│   ├── calendar.routes.ts
│   ├── attendance.routes.ts
│   ├── analytics.routes.ts
│   ├── reports.routes.ts
│   └── backup.routes.ts
│
├── middlewares/
│   ├── auth.middleware.ts
│   ├── async-handler.middleware.ts
│   ├── not-found.middleware.ts
│   └── error.middleware.ts
│
├── jobs/
│   └── session-cleanup.job.ts     # Removes expired sessions once daily
│
├── utils/
│   ├── app-error.ts
│   ├── crypto.util.ts
│   ├── date.util.ts
│   ├── csv.util.ts
│   └── network.util.ts
│
└── types/
    └── express.d.ts               # Adds userId to Express Request
```

## Request lifecycle

```text
HTTP request
    ↓
Express app + global middleware
    ↓
Route module
    ↓
Authentication middleware (for protected routes)
    ↓
Controller
    ↓
Validator
    ↓
Service (business rules)
    ↓
Repository (SQL)
    ↓
SQLite database
    ↓
Controller response
```

Errors flow to the central error middleware. Controllers do not run SQL directly. Services do not construct HTTP responses. Repositories own SQL statements.

## Responsibilities

- **Routes:** Declare endpoints and attach middleware/controllers.
- **Controllers:** Read request parameters/body, call services and format responses.
- **Services:** Implement the application's business rules and coordinate repositories.
- **Repositories:** Encapsulate all SQLite SQL and transactions.
- **Models:** Define TypeScript domain and database record interfaces. This project uses raw SQLite rather than an ORM, so there are no ORM model classes.
- **Validators:** Validate untrusted request data before business operations.
- **Middlewares:** Authentication, async error forwarding, 404 and centralized error handling.
- **Jobs:** Background housekeeping. The current job removes expired sessions daily.
- **Database:** Connection, base schema and additive local database upgrades.
- **Utils:** Small shared helpers with no business ownership.

## API compatibility

The refactor retains the route paths and the response shapes from the uploaded `server.ts`:

| Method | Route | Purpose |
|---|---|---|
| GET | `/api/status` | First-account/setup status |
| POST | `/api/auth/setup` | Create the first account |
| POST | `/api/auth/register` | Register a user |
| POST | `/api/auth/login` | Login |
| POST | `/api/auth/logout` | Logout |
| GET | `/api/auth/me` | Current user |
| PATCH | `/api/auth/profile` | Update email |
| GET/POST | `/api/semesters` | List/create semesters |
| PATCH/DELETE | `/api/semesters/:id` | Update/delete semester |
| GET/PUT | `/api/semesters/:id/timetable` | Read/update weekly timetable |
| GET/POST | `/api/semesters/:id/subjects` | List/create subjects |
| PATCH/DELETE | `/api/semesters/:id/subjects/:subjectId` | Update/delete subject |
| GET/PUT | `/api/semesters/:id/subject-timetable` | Read/update subject timetable |
| POST | `/api/semesters/:id/subjects/apply-timetable` | Apply subject mapping to old records |
| GET | `/api/calendar/:semesterId` | Monthly calendar |
| PUT | `/api/attendance/:semesterId/:date` | Save daily attendance |
| GET | `/api/analytics/:semesterId` | Semester analytics |
| GET | `/api/reports/:semesterId.csv` | CSV report |
| GET | `/api/reports/:semesterId.json` | JSON report |
| GET | `/api/backup` | Export current user's backup |
| POST | `/api/backup/restore` | Restore current user's backup |

## Database and data safety

- The SQLite path is unchanged by default: `path.resolve(process.cwd(), 'data', 'attendance.db')`.
- `DATABASE_PATH` is an optional override; leave it unset to retain the original location.
- `src/database/schema.ts` contains the same base table definitions as the uploaded `src/db.ts`.
- `src/database/migrations.ts` contains the existing additive compatibility logic.
- No table is intentionally dropped or reset by this refactor.
- No database migration is required simply to adopt the new source structure.
- The expired-session cleanup only deletes rows whose expiry timestamp has passed.

## Runtime compatibility

- `src/server.ts` remains the runtime entry point, so existing build/start scripts that compile `src/server.ts` should continue to work.
- `src/db.ts` remains as a compatibility re-export for any code that still imports `./db.js`.
- Existing dependencies are reused: `express`, `cookie-parser`, `helmet`, `express-rate-limit`, `bcryptjs`, `better-sqlite3` and `dotenv`.
- No new runtime dependency is introduced.
- `src/app.ts` exports the Express app separately, which makes future integration tests easier.

## Important deployment distinction

The uploaded archive is the **local Express backend**. The currently hosted Attendly website is deployed through a Cloudflare Worker and D1. Do not copy this Express backend into the Cloudflare Worker source directory. The Worker has a different runtime and database adapter; its source must be audited/refactored separately if the goal is to modularize the live SaaS backend.
