# `forkhub` AI Guidelines

## Bun & PNPM

Default to using Bun instead of Node.js, and PNPM for package management.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `pnpm install` instead of `npm install` or `yarn install` or `bun install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `pnpx <package> <command>` instead of `npx <package> <command>` for not locally-installedp package, and `pnpm <package> <command>` instead of `npm <package> <command>` for locally-installed package.
- Bun automatically loads .env, so don't use dotenv.

### APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

### Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

### Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

## Release Channels

Two channels only. Never mix artifacts between them.

| Channel | Trigger | Version format | Published to |
|---|---|---|---|
| **canary** | EVERY push to the `canary` branch (CI: `.github/workflows/canary.yml`) | `<dev-version>-canary.<YYYYMMDDHHmm>.<sha7>` — CI-generated, never hand-edit | npm dist-tag `canary`; also installable via `github:ImBIOS/forkhub#canary&path:packages/cli` |
| **latest (stable)** | pushing a `vX.Y.Z` tag cut from `main` (CI: `.github/workflows/publish.yml`) | exact `X.Y.Z` | npm dist-tag `latest` + GitHub Release (**mandatory, always**) |

Rules:

- Cut stable tags ONLY from `main`, and only when CI (`test.yml`) is green.
- A stable tag WITHOUT a GitHub Release is a bug. `publish.yml` must publish to npm, build binaries, attach them (+ `SHA256SUMS`) to the GitHub Release, and update `Formula/forkhub.rb`. If any step fails, fix and re-run — don't leave a half-released tag.
- Canary publishes are automatic on every push to `canary`. Do not bump versions for canary by hand; CI derives `<base>-canary.<timestamp>.<sha>` at publish time.
- Keep `packages/cli/package.json` version strictly ABOVE the last stable tag (right after cutting `vX.Y.Z`, bump main/canary base to `X.Y.(Z+1)` or next minor) so canary semver always sorts above stable — otherwise npm rejects canary publishes.
- After cutting a stable release, verify: `npm view forkhub version` matches the tag, the GitHub Release exists with binaries attached, and `brew install ImBIOS/tap/forkhub` still resolves.
- First-ever publish of the package name requires a manual `npm publish` from `packages/cli` (claim name + configure OIDC trusted publishers for BOTH `publish.yml` and `canary.yml` in npm package settings). CI-only publishing works after that.
