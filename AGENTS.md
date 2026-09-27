Before every commit that changes code, run `npm run quality` and fix anything it flags (CRAP <= 8 median/mode, every file MI > 70).

`npm run quality` also runs knip (`npm run unused`); the compiler rejects unused locals and parameters.

For a refactor meant to change no behaviour (renames, moves, unexports, deleting dead code), prove it: `npm run fingerprint -- --save` before, `npm run fingerprint -- --check` after. The fingerprint hashes the bundled server and web app with local names normalised, so it only moves when behaviour-bearing code does, and `--check` prints the lines that changed. Rename with the compiler (the TypeScript language service, e.g. ts-morph `rename`), not search and replace.
