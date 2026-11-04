# Attendly – Account Lifecycle & Semester Limits Update

This is an **overlay update** for the existing Attendly project. It is not a standalone project.

## Included changes

1. **Permanent student account deletion (Super Admin only)**
   - Requires typing the student's username to confirm.
   - Deletes the student's sessions, semesters, timetable, subjects, timetable mappings, attendance, attendance categories, subscriptions, payment claims and transactions, notifications, policy acceptances, free-semester preference, pending email OTPs, and user-identifying audit rows.
   - Cleans nullable administrative references before removing the student.
   - If a student ID is unexpectedly referenced as a payment verifier, deletion is refused with HTTP 409 before any records are changed, to avoid corrupting payment audit history.
   - A non-identifying accountability audit entry remains for the Super Admin action.

2. **Suspension notice and logout**
   - The suspension reason is stored in `app_user.suspension_reason` and returned by the authentication API.
   - Active student sessions are retained while suspended only so the browser can receive the reason; protected API requests are rejected.
   - The app polls `/auth/me` while a student is signed in. When suspension is detected, a blocking dialog displays the administrator's note.
   - The student clicks “Understood · Sign out”; the app calls `/auth/logout` and clears local authenticated state.
   - Logout is allowed during maintenance mode so a suspended student can complete sign-out.

3. **Semester limits and permanent semester deletion**
   - Free students: maximum 1 semester.
   - Pro students: maximum 3 semesters.
   - Limits are enforced server-side in the INSERT statement, so parallel requests cannot create an extra semester.
   - Deleting a semester removes its attendance, timetable, subject mappings, timetable, categories, subjects and semester-scoped audit entries. This permanently frees a semester slot.
   - Existing Free-plan read-only semester rules remain in force.

4. **D1 index audit**
   - Existing migrations already create indexes for attendance by semester/date and semester/subject, timetable subject lookups, semester ownership/order, subscriptions, payment references, notifications, sessions, categories and OTP expiry/lookup.
   - `EXPLAIN QUERY PLAN` was checked for attendance-by-date, attendance-by-subject, timetable-subject FK lookup and semester listing. The expected indexes are selected.
   - No duplicate index migration is added. Migration `0009_account_lifecycle_semester_limits_indexes.sql` is included as the existing schema migration reference.

## Files in this overlay

- `cloudflare/src/modules/admin.ts`
- `cloudflare/src/modules/auth.ts`
- `cloudflare/src/modules/academic.ts`
- `cloudflare/src/index.ts`
- `cloudflare/src/lib/platform-controls.ts`
- `cloudflare/migrations/0009_account_lifecycle_semester_limits_indexes.sql`
- `attendance-management-v1/frontend/src/App.tsx`
- `attendance-management-v1/frontend/src/styles.css`
- `attendance-management-v1/frontend/src/services/api.ts`
- `attendance-management-v1/frontend/src/pages/SaasPages.tsx`
- `attendance-management-v1/frontend/src/pages/InstallAttendlyPage.tsx`
- `attendance-management-v1/frontend/public/manifest.webmanifest` and the four existing Attendly PWA icons

The frontend files retain the More page and PWA install page from the current working source used to prepare this overlay.

## Apply safely

1. Back up the current Attendly folder, including your local-only `cloudflare/wrangler.toml`.
2. Extract this ZIP and copy its contents into the existing Attendly project root, preserving the folder structure. Replace matching files only.
3. Do not replace or delete your local `cloudflare/wrangler.toml`; it is intentionally not included.
4. Run `APPLY_UPDATE.bat`. Continue only if all Cloudflare, frontend and local-backend builds pass.
5. Run `MIGRATE_DATABASE.bat`. Wrangler applies pending migrations only; if migration 0009 is already applied, it should report that there is nothing pending. Do not manually run the SQL file.
6. Run `DEPLOY.bat` only after the build and migration checks succeed.
7. Test with a dedicated test student first. Do not test permanent deletion against a real student's account.

## Acceptance tests

- Free account cannot create a second semester.
- Pro account can create three semesters; fourth is rejected.
- Deleting one of three Pro semesters permanently removes the child's data; a new semester can then be created.
- Super Admin can delete a test student after username confirmation; verify all related user data rows are gone.
- Non-Super-Admin cannot use the permanent deletion endpoint.
- When a student is suspended with a reason, the student sees a blocking reason dialog within the next API request or the 15-second status poll; acknowledging it signs the student out.
- Re-activating an account clears old sessions, requiring the student to sign in again.
- Verify existing More navigation, PWA install page, attendance and subscription screens still work.

## Verification performed for this package

- SQLite migrations 0001–0009 executed successfully with foreign-key enforcement enabled.
- Account-deletion test removed the sample student's account-owned records; `PRAGMA foreign_key_check` returned no violations.
- Semester-cap test accepted three Pro semesters and rejected the fourth.
- Semester-purge test removed semester rows and semester-scoped audit entries; foreign-key check returned no violations.
- TypeScript/TSX syntax transpilation: 19 source files, zero diagnostics.
- Full npm production builds were not completed in this environment. The local `APPLY_UPDATE.bat` checks are mandatory before deployment.

## Important

Account deletion and semester deletion are permanent. Confirm the correct student/semester before executing either action. This update does not modify Cloudflare secrets, `wrangler.toml`, D1 data directly, or deployment settings.
