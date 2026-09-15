# Contributing to Script Glow

Thanks for helping. Script Glow is for actors, most of whom are not technical, so plain words and a simple screen matter as much as the code.

## Set up

Follow the README: Node.js 24, `npm install`, and the [voice server](voice-server/README.md) if you need real audio.

## Before you open a pull request

```sh
npm test                                   # unit and API tests
npm run build                              # type check and build
node verification/studio-workspace.mjs     # browser checks with fake voices, no GPU
node verification/project-library.mjs
node verification/render-guard.mjs
```

The other scripts in `verification/` need a running app or a GPU. Say in your pull request which checks you ran.

## Guidelines

- Keep changes small and focused. Match the style of the code around your change.
- Add or update a test for any bug fix or behavior change.
- Use plain words in the interface. Avoid terms like "render", "TTS", or "endpoint" on screen.
- Update the README and the in-app help (`src/help.ts`) when you change what a user sees.
- Never commit personal voice recordings, `data/`, `.cache/`, or connection profiles. Only use voices whose owners agreed to it.

## Reporting bugs

Open an issue with the steps, what you expected, and what happened. Security problems go through [SECURITY.md](SECURITY.md) instead.
