# Inner Graph

Inner Graph builds a map of your inner life from your own writing. You write to an assistant
about what is going on; it picks out the parts of you, beliefs, memories and feelings in what
you wrote, and how they feed one another, and adds them to a map you can look at, question and
correct. Everything on the map points back to your own words, and every change can be undone.

It runs on your computer. Your writing and your map are kept in an encrypted file on your own
disk.

Version <!-- version -->0.3.8<!-- /version -->. What changed in each version is in the
[changelog](CHANGELOG.md).

## Install

Download the installer for your computer from the
[latest release](https://github.com/innerlattice/innergraph/releases/latest):

| Computer | File |
| --- | --- |
| Mac with Apple silicon (M1 or later) | `Inner-Graph-…-mac-arm64.dmg` |
| Mac with an Intel chip | `Inner-Graph-…-mac-x64.dmg` |
| Windows | `Inner-Graph-…-win-x64.exe` |

The installers aren't signed yet, so your system warns you the first time you open the app:

- **macOS** says the app "can't be opened" or is "damaged". Right-click the app in
  Applications and choose Open. If that doesn't work, run this in Terminal:
  `xattr -dr com.apple.quarantine "/Applications/Inner Graph.app"`
- **Windows** says it "protected your PC". Choose More info, then Run anyway.

## Choose a model

The assistant needs a language model. Open Settings (bottom left) and pick one:

- **ChatGPT plan**: uses your ChatGPT subscription. Choose Connect ChatGPT and enter the code
  on OpenAI's page.
- **OpenRouter**: one key for many models. Paste your OpenRouter key.
- **Local model**: a model running on your own computer through
  [Ollama](https://ollama.com), LM Studio or any OpenAI-compatible server. Nothing you write
  leaves your computer.

With ChatGPT or OpenRouter, what you write and the parts of your map the assistant reads are
sent to that provider. The app says so when a hosted model is in use.

Searching your map always runs on your computer, with a small model that comes with the app
and understands meaning in many languages, so finding "my father" also finds "Dad".

## Using it

**Write.** Tell the assistant what happened or what you're thinking about, the way you would
in a journal. It saves your message as an entry, adds what it finds to the map, and shows each
change as a card with an Undo button. The passages it used are highlighted in your message;
click one to see what it became on the map.

**Look at the map.** The views are in the rail on the right:

- **Map**: everything and how it connects. Click to select, shift-click or drag a box to
  select several. What you select appears above the message box, so you can ask the assistant
  about "these".
- **Loops**: patterns that keep themselves going, step by step, with what speeds them up and
  what slows them down.
- **Entries**: everything you've written, and what each entry supports on the map.
- **Log**: every change, in order.

**Explore.** Each item has an Explore button with things to do about it with the assistant:
make sense of how it fits, answer a few questions to fill in the map around it, ask "why"
five times, or look for where a loop could ease.

**Correct it.** What the assistant adds is a suggestion until you say it "Looks right". You
can rename, merge, remove and restore things yourself, or just tell the assistant what's
wrong.

**Undo anything.** Nothing is ever destroyed. Undo a single change from its card, undo a
whole set of changes from History, bring back something removed, or take the whole map back
to how it was at an earlier time.

Conversations are in the rail on the left. A long conversation warns you as it fills up and
then ends; start a new one and carry on, since the map keeps everything.

## Use it from other assistants

Claude Desktop, Claude Code, Codex and Hermes Agent can read and add to the same map.
Open Settings, find "Connect other agents", pick your assistant and copy the snippet to where
it says. The assistant then knows how to work with your map, and its changes are recorded
under its own name, so you can see and undo them like any others.

More detail, including read-only connections and the full list of tools, is in
[docs/MCP.md](docs/MCP.md).

## Your data

The app keeps everything in one folder, created the first time it runs:

- macOS: `~/Library/Application Support/Inner Graph/vault`
- Windows: `%APPDATA%\Inner Graph\vault`

The folder holds the encrypted database and `vault.key`, the key that opens it. To back up or
move your map, copy the whole folder while the app is closed. Without `vault.key` the database
can't be read, so keep them together, and keep the folder private: anyone with both files can
read your map.

## More

- [CONTRIBUTING.md](CONTRIBUTING.md): running from source, the command line, tests, building
  installers and shipping versions.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): how it is built and why.
- [docs/SPEC.md](docs/SPEC.md): the core model and its vocabulary.
- [docs/DESIGN.md](docs/DESIGN.md): the visual design system.
