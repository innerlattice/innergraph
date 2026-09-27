Before every commit that changes code, run `npm run quality` and fix anything it flags (CRAP <= 8 median/mode, every file MI > 70).

`npm run quality` also runs Biome (`npm run lint`; `npm run format` fixes formatting) and knip (`npm run unused`); the compiler rejects unused locals and parameters.

For a refactor meant to change no behaviour (renames, moves, unexports, deleting dead code), prove it: `npm run fingerprint -- --save` before, `npm run fingerprint -- --check` after. The fingerprint hashes the bundled server and web app with local names normalised, so it only moves when behaviour-bearing code does, and `--check` prints the lines that changed. Rename with the compiler (the TypeScript language service, e.g. ts-morph `rename`), not search and replace.

Every push is a version. When a piece of work is committed and ready to go out, first read the README, `docs/` and `plugin/` and update anything the changes made stale, then run `npm run ship -- patch` (fixes, polish) or `npm run ship -- minor` (new features); `major` only when the person asks. It runs the checks, bumps the version, writes the changelog from the commit subjects (so write them as the change a person would notice), commits, tags and pushes. Don't bypass the pre-push hook. Building installers is a separate, manual step: `npm run dist`, or the Installers workflow on GitHub.
