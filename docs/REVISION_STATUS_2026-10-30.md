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
  keeps controls fixed while its reply body scrolls. The pet bubble sizes to its
  content up to a limit, scrolls only its body, preserves reading position when
  the same reply changes, and has a separate return-to-latest button. A local
  quote cannot replace the reply while the user is reading/selecting it.
- Optional mouse-through has explicit controls and preserves interaction with
  the desktop controls. The model hit test uses actual Three.js mesh geometry;
  transparent texture cutouts and native desktop behavior require further QA.
- The main-window character frame is thinner. Its rim, the composer and the
  scene menu apply a displacement filter to the live **application** backdrop,
  with a moving rim highlight, reduced-transparency fallback, and a
  background/blur transition during panel drag. `scripts/verify-glass-ui.cjs`
  compares both the rim and composer against a synthetic moving stripe background
  and ordinary blur. This is an initial material, not completed liquid-glass
  acceptance: it does not sample windows behind the Electron window or establish
  production GPU performance, contrast across themes, or motion quality.
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
- Contact and chat avatars use the selected built-in outfit's pinned local
  preview. Imported models without a safe local preview show a neutral fallback;
  live snapshots for imported or visually modified versions remain outstanding.
- Decorative setup and community copy was shortened. A wardrobe button press
  no longer overrides the vertical centering transform, which previously
  moved the button away from the pointer before release.

## Local evidence

The source regression ran with 755 Node tests, 66 Python tests and 19 community
tests passing. The production build completed. Electron 45 on Linux with
software rendering completed 86 main-interface checks, pet-menu checks and a
moving-background glass comparison. This is supplemental to Windows; the
headless pet run explicitly skipped native desktop-window movement. The latest
pet renderer run passed 15 checks (including long reply, reading position,
independent font size at 2× character scale, and menu checks) and saved 5
screenshots; one native movement check was skipped in that headless run.

The Windows workflow added on this branch runs source, build and Electron
checks without publishing artifacts. Run
[`40940785377`](https://github.com/fqxxzyw/Yukino-Companion/actions/runs/40940785377)
passed the Windows source/build, interface, pet and moving-backdrop checks;
ten Python cases were skipped on that Windows runner. No installer was built.

The independent Windows integration run
[`40940785351`](https://github.com/fqxxzyw/Yukino-Companion/actions/runs/40940785351)
rendered all seven base models but failed while waiting for the walk14 preview;
the eight-weight WebGL step timed out after five minutes. Its renderer was
Microsoft Basic Render Driver, not a verified physical GPU. These failures are
not covered by the successful Windows source/interface job and remain open.
The model capture now records its last state and waits for a visible frame when
an entering model is still outside the window; it still requires genuine gait
phases and a final rendered model. A Linux software-rendering rerun completed
all 17 model versions and synthetic audio-clock checks. This does not close the
Windows failures or prove trained-voice synthesis.

In the later Windows run
[`40948587343`](https://github.com/fqxxzyw/Yukino-Companion/actions/runs/40948587343),
all 17 model versions, walking phases and synthetic audio-clock checks passed.
The earlier runner inherited system reduced motion; the motion-specific test
now explicitly emulates normal motion in its isolated window. The independent
eight-weight WebGL step still failed/timed out on the basic software driver.
The later exact-branch run
[`40958215186`](https://github.com/fqxxzyw/Yukino-Companion/actions/runs/40958215186)
again passed those model renders and again failed the eight-weight step. Its
separate Windows interface/source workflow
[`40958215259`](https://github.com/fqxxzyw/Yukino-Companion/actions/runs/40958215259)
passed; these runs predate the latest composer and scene-menu material changes.
The later Windows source/interface workflow
[`40960266721`](https://github.com/fqxxzyw/Yukino-Companion/actions/runs/40960266721)
passed after the composer and scene-menu material changes, but predates the
pet long-reply changes described above.
With the pet changes, Windows source, build, interface, glass and 16 pet checks
passed in [`40961966554`](https://github.com/fqxxzyw/Yukino-Companion/actions/runs/40961966554);
the pet test includes one native window movement, not repeated dragging or a
multi-monitor test. Python skipped ten cases. The paired integration run
[`40961966637`](https://github.com/fqxxzyw/Yukino-Companion/actions/runs/40961966637)
again passed the model render step but failed the eight-weight step.
Future revision UI jobs preserve only synthetic window screenshots and reports
as time-limited workflow artifacts, never model binaries or user profiles.
The next documentation/workflow-only commit passed the separate Windows revision
checks in [`40963958613`](https://github.com/fqxxzyw/Yukino-Companion/actions/runs/40963958613),
including evidence upload. Its paired integration run
[`40963958602`](https://github.com/fqxxzyw/Yukino-Companion/actions/runs/40963958602)
failed before model rendering because a synthetic download fallback test used
a 15 ms idle timeout and the second source did not finish under CI load. The
test now gives the successful source 500 ms while still requiring the first
source to time out and checking the fallback bytes and progress. That change
does not alter the production download timeout or close the eight-weight gap.
After the test adjustment, the Windows source/interface workflow
[`40965754603`](https://github.com/fqxxzyw/Yukino-Companion/actions/runs/40965754603)
passed; the paired integration run
[`40965754778`](https://github.com/fqxxzyw/Yukino-Companion/actions/runs/40965754778)
passed 17 model render variants but again failed its eight-weight WebGL step.

`windows-revision-candidate.yml` builds an unpublished candidate on the
revision branch and separately tests its native installation against the exact
source and payload manifest. It has read-only repository permissions and
uploads only the permitted extractable EXE and manifests, not standalone model
files. Its presence is not evidence that a candidate was built or installed;
check the actual workflow run and keep final publication gated on acceptance.
Candidate run [`40967422342`](https://github.com/fqxxzyw/Yukino-Companion/actions/runs/40967422342)
built an installer with seven visual outfits and verified 101 installed payload
files, then launched and rendered the default model. Its native smoke failed
because the old layout assertion required the action menu outside the panel,
contrary to the revision requirement. The installed-window check now requires
the menu inside the panel and tests a bounded, independently scrollable long
reply with fixed controls; a new run must execute the remaining upgrade and
uninstall checks before those can be reported for the revised installer.

`windows-real-offline-qa.yml` is a separate CPU-only attempt on an isolated
runner. It prepares the published runtime and pinned resources concurrently,
then calls `verify-offline-chain.cjs` with the real services and preserves only
the report and newly synthesized WAVs. It does not upload model weights or
prove physical playback, GPU use, or mouth/body synchronization. Starting the
job is not evidence that the real chain completed; check its result and report.

The unmodified published CPU runtime in
[`40948841125`](https://github.com/fqxxzyw/Yukino-Companion/actions/runs/40948841125)
completed two real local generation → Japanese translation → trained-voice
synthesis turns without an API request, producing three newly generated WAVs.
The runner had network access, so this is not a disconnected-network test.
The cold first WAV took 60.05 seconds, including 33.60 seconds loading voice;
the second turn reused the voice worker and took 5.55 seconds to its first WAV.
These are generation timings, not measured time to audible playback. One reply
misunderstood who was going to rest; response quality is not accepted by this
smoke test. The current branch starts voice preparation during the response,
with cancellation guards. Its real performance and subjective quality must be
measured separately before claiming an improvement.

[`40954487007`](https://github.com/fqxxzyw/Yukino-Companion/actions/runs/40954487007)
completed the same real CPU chain with voice loading overlapped. Its first WAV
was ready after 45.89 seconds and the second turn after 6.11 seconds. These are
separate hosted runs, not a controlled hardware benchmark or a measurement of
speaker latency. Generated WAVs and the exact report were preserved separately;
playback, listening quality and synchronization remain unverified.

## Outstanding acceptance work

Do not mark the full revision plan or product complete. In particular:

[`REVISION_QA_MATRIX_2026-10-30.md`](REVISION_QA_MATRIX_2026-10-30.md) records
the documented T01–T64 acceptance cases with evidence and remaining gaps.

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
