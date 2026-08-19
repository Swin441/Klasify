# Testing

## Live RLS tests

The regular test suite keeps live database tests opt-in so a developer's
shared database is not modified accidentally. Apply the migrations to an
isolated Supabase project, then load its environment and run:

```powershell
$env:RUN_FOLLOW_UP_RLS = "true"
npm test -- src/lib/rls.integration.test.ts src/lib/follow-ups/rls.integration.test.ts
```

The live suites create uniquely named Auth users and tenant rows, then remove
the test users in `afterAll`. They require `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.