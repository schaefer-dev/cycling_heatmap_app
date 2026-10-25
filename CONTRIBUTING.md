# Contributing to Ridestack

Thanks for your interest! Bug reports, ideas and pull requests are welcome.

## Before you start

- **Bugs**: open an issue with steps to reproduce, what you expected and what happened. Logs help;
  please remove API keys, tokens and anything that reveals where you live first.
- **Features**: for anything bigger than a small fix, open an issue first so we can agree on the
  approach before you invest time.

## Development setup

Requires Node.js ≥ 22.18 (see `.nvmrc`). The server runs TypeScript directly, no build step.

```bash
npm ci
DB_PATH=./data/demo.db npm run demo:seed   # synthetic rides, no accounts needed
DB_PATH=./data/demo.db npm run dev         # http://localhost:5173
```

## Ground rules

- `npm run check` (lint + typecheck + tests) must pass; CI runs the same plus `npm run build`.
  `npm run format` applies Prettier.
- **Never commit real GPS data.** Tests build synthetic tracks (`server/test/helpers/tracks.ts`)
  and FIT files (`server/test/helpers/fit.ts`); screenshots use the demo dataset.
- Route matching behaviour is pinned by scenarios in `server/test/matching.test.ts`. Extend them
  when you change matching.
- Database schema changes go into a new migration in `server/src/db/migrations/` (never edit a
  released one).
- The server uses only erasable TypeScript syntax (no enums, namespaces or parameter properties)
  and relative imports with the `.ts` extension.
- Keep pull requests focused; describe what changed and how you tested it.

## License of contributions

Ridestack is licensed under the [GNU AGPL-3.0](LICENSE). By submitting a contribution you agree
that it is licensed under the AGPL-3.0, and you grant the maintainer (Daniel Schäfer) a perpetual,
irrevocable, worldwide, royalty-free license to use, modify and relicense your contribution as part
of Ridestack, including under other license terms. This keeps the project's licensing in one hand.
You keep the copyright to your contribution.
