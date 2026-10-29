# Desktop revision status · 2026-10-30

This work continues from `c972a26e561ef299440012c4489fbe16a4bbc915` on
`handoff/codex-current-20261028`. The previously published
[`v0.4.0-test.40913001300`](https://github.com/fqxxzyw/Yukino-Companion/releases/tag/v0.4.0-test.40913001300)
is built from `3f7eb207d7bb15ede50bce1f9165da7778bc18e0`; it does **not** contain
the changes described here. Keep the history and release assets intact.

## Changes in this branch

- Desktop-pet walking uses the same visible-body bounds as dragging and rejects
  corrections that would move opposite to the requested gait. Long bilingual
  replies are no longer truncated by the companion manager; the model window
  keeps controls fixed while its reply body scrolls.
- Optional mouse-through has explicit controls and preserves interaction with
  the desktop controls. The model hit test uses actual Three.js mesh geometry;
  transparent texture cutouts and native desktop behavior require further QA.
- The main-window character frame is thinner. Its rim applies a displacement
  filter to the live **application** backdrop, with a moving highlight, reduced
  transparency fallback, and a background/blur transition during panel drag.
  `scripts/verify-glass-ui.cjs` compares the actual renderer against a synthetic
  moving stripe background and ordinary blur. It does not sample windows behind
  the Electron window or establish production GPU performance.
- Concurrent setup downloads use a stable managed voice-model root and merge
  results through serialized writes. UI saves send only edited fields, so stale
  form data cannot replace freshly installed weights. Selecting weights,
  automatic saving, setup and cancellation have regression coverage. Real
  GPT-SoVITS synthesis remains an independent acceptance requirement.
- The current published catalogue has 75 multipart links. A shared limit of
  128 permits those parts to start concurrently; each supported aria2 download
  requests up to eight connections. Server range support, throttling and the
  HTTPS fallback can change the actual connection count and speed.
- Vision configuration has a direct settings route and return link. Changing
  the destination revokes active capture/send consent and requires a new
  preview. This is bounded image sampling, not continuous video calling.
- Decorative setup and community copy was shortened. A wardrobe button press
  no longer overrides the vertical centering transform, which previously
  moved the button away from the pointer before release.

## Local evidence

The source regression ran with 749 Node tests, 66 Python tests and 19 community
tests passing. The production build completed. Electron 45 on Linux with
software rendering completed 84 main-interface checks, pet-menu checks and a
moving-background glass comparison. This is supplemental to Windows; the
headless pet run explicitly skipped native desktop-window movement.

The Windows workflow added on this branch runs source, build and Electron
checks without publishing artifacts. A workflow file or queued run is not a
passing Windows result. The new code has not yet produced a tested installer.

## Outstanding acceptance work

Do not mark the full revision plan or product complete. In particular:

- Test native Windows desktop hit testing, dragging/flicker, multi-monitor DPI,
  both gait directions, long-message scrolling and actual graphics performance.
- Refine the glass material across the requested surfaces and evaluate light,
  dark and complex backgrounds, transitions, readability and performance.
  Desktop cross-window refraction is not implemented by CSS backdrop filters.
- Complete and time real local generation → Japanese translation → trained
  voice synthesis → playback and lip/body synchronization on CPU and GPU.
  File presence and mocked tests do not prove inference is working.
- Verify current-install isolation and resource migration, a real vision API,
  capture devices and context-aware low-interruption visual companionship.
- Complete the remaining seven-model blink, hair, garment, expression and prop
  action acceptance already documented in `HANDOFF_2026-10-30.md`.

Do not upload new standalone model files. The user permits an extractable
installer with its seven visual models, but not separate public model uploads.
