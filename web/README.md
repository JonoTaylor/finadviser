This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Data-plan loader

`scripts/apply-data-plan.ts` loads a reviewed JSON "data plan" (tenancies, journals, letting type, owner tax profile) into the database. It only ever INSERTs and UPDATEs, is idempotent, and its dry run is read-only. The plan format is `src/lib/data-plan/schema.ts`; `scripts/data-plan.example.json` is a made-up template (keep real plans outside the repo: `*.plan.json` is git-ignored).

```bash
export DATABASE_URL=postgres://...
npm run data-plan:check -- --plan plan.json --snapshot              # what the database holds now
npm run data-plan:check -- --plan plan.json --account alias="Exact Name"   # dry run: prints a change digest
npm run data-plan:apply -- --plan plan.json --account alias="Exact Name" --expect-digest <digest>
```

Before the latest migration has run (`npm run db:migrate`, or the next deploy), the dry run still works: it says "schema not migrated yet", lists the letting-type and tax-profile items as "pending migration" and plans everything else. `--apply` refuses until the schema is present.

**From a sandbox that only reaches the internet through an HTTPS CONNECT proxy** (no WebSocket upgrades), use the HTTP driver. It speaks plain HTTPS on port 443, through `HTTPS_PROXY`, and trusts the proxy's CA via `NODE_EXTRA_CA_CERTS`:

```bash
npm run data-plan:check -- --driver http --plan plan.json --account alias="Exact Name"
npm run data-plan:apply -- --driver http --plan plan.json --account alias="Exact Name" --expect-digest <digest from the dry run>
```

`DATA_PLAN_DRIVER=http` does the same as `--driver http`. In this mode `--expect-digest` is required: apply sends all its writes as one atomic batch, every write guards itself in SQL, and a final check rolls the whole batch back if anything changed since the read (see the header of `src/lib/data-plan/http-statements.ts`).

Exit codes: 0 ok, 1 unexpected error (or a failed post-commit check), 2 refused, 3 not ready to apply (dry run), 4 bad usage or invalid plan.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
