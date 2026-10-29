# Revision acceptance matrix · 2026-10-30

This records the T01–T64 cases in `Yukino_Revision_Plan.md` as of this branch.
**Partial** means some code or test evidence exists but the entire documented
acceptance has not been demonstrated. **Not verified** is not a pass. The
pre-revision Windows test installer is built from `3f7eb207`, not this branch.

Evidence labels used below:

- **UI**: isolated Electron renderer on Windows and supplemental Linux,
  synthetic state and no real API/device. Latest pre-pet-change Windows run:
  [40960266721](https://github.com/fqxxzyw/Yukino-Companion/actions/runs/40960266721).
- **PET**: production pet renderer/preload/manager with synthetic content and
  temporary preferences. Linux headless cannot prove native desktop movement;
  the Windows job checks one native move, not multi-monitor or repeated drag.
- **UNIT**: automated source tests with synthetic dependencies, not hardware.
- **CPU**: [40948841125](https://github.com/fqxxzyw/Yukino-Companion/actions/runs/40948841125)
  and [40954487007](https://github.com/fqxxzyw/Yukino-Companion/actions/runs/40954487007)
  used the real production services, pinned models and a Windows CPU runner.
  They generated WAVs; the runner had network access and no listening or
  playback/synchronization acceptance was performed.
- **RENDER**: [40958215186](https://github.com/fqxxzyw/Yukino-Companion/actions/runs/40958215186)
  rendered 17 model variants on Microsoft Basic Render Driver. Its independent
  eight-weight WebGL step timed out/failed; this is not physical GPU evidence.
- **INSTALL**: the pre-revision installer was installed and upgraded on a
  Windows runner; that result does not verify an installer from this branch.

## Windows, character and bubble

| Case | Result | Evidence or remaining gap |
| --- | --- | --- |
| T01 | Partial | UI covers synthetic default layout, not all documented operations. |
| T02 | Partial | UI covers compact layout and controls; no full native minimum-size matrix. |
| T03 | Not verified | No complete physical 100/125/150/200% DPI matrix. |
| T04 | Partial | UI covers drag and backdrop transition; no physical motion review. |
| T05 | Partial | UI exercises left/right docking; smooth native transition still needs review. |
| T06 | Not verified | Repeated rapid drag/cancel has no native video/performance acceptance. |
| T07 | Partial | UI checks scene/wardrobe controls; full bottom-menu acceptance pending. |
| T08 | Partial | Thin frame and usable controls in UI; light/dark visual approval pending. |
| T09 | Not verified | Real click through transparency onto a desktop icon has not been tested. |
| T10 | Not verified | Click through to another real application has not been tested. |
| T11 | Partial | UNIT tests the setting and renderer hit tests; real cross-window click pending. |
| T12 | Partial | Model header and recovery controls exist; native hit-test behavior pending. |
| T13 | Partial | Tray recovery is wired and unit tested; physical recovery remains pending. |
| T14 | Partial | PET and model code retain long replies and bound their bodies; real edge displays pending. |
| T15 | Partial | PET checks the scroll body and fixed latest control; physical wheel and model controls pending. |
| T16 | Partial | PET checks a long URL, emoji and bilingual content; long code and physical fonts pending. |
| T17 | Partial | PET checks a same-reply update after scrolling; real streamed multi-window session pending. |
| T18 | Partial | PET checks 2× character scale with unchanged bubble font and bounded width. |
| T19 | Not verified | Four physical screen edges and taskbar have not been exercised. |
| T20 | Partial | UNIT covers geometry and a monitor seam; different physical DPI is untested. |
| T21 | Not verified | Real display disconnection/resolution change not tested. |
| T22 | Partial | Position-only movement and drift guards have tests; real flicker needs video review. |
| T23 | Not verified | Repeated native penetration/drag switching has not been accepted. |
| T24 | Partial | UI uses the selected built-in outfit preview; generated live portraits are not implemented. |
| T25 | Partial | Built-in skin updates are tested; restart/imported/live-modified avatars need real QA. |

## Material and performance

| Case | Result | Evidence or remaining gap |
| --- | --- | --- |
| T26 | Partial | UI pixel comparison shows displaced live application backdrop, not desktop refraction. |
| T27 | Not verified | Broad light/dark/photographic background and contrast acceptance pending. |
| T28 | Partial | Pointer highlight and transitions exist; continuous optical deformation not accepted. |
| T29 | Not verified | Sustained native drag, flicker and GPU timing are unmeasured. |
| T30 | Partial | Reduced-motion handling and transparency fallback exist; OS/hardware behavior not accepted. |
| T31 | Not verified | Native desktop cross-window glass is not implemented or verified. |
| T32 | Partial | Glass uses app backdrop, not a desktop screenshot; no full installed privacy audit. |

## Installation, downloads and inference

| Case | Result | Evidence or remaining gap |
| --- | --- | --- |
| T33 | Partial | CPU performed real inference; clean installed environment and isolation not accepted. |
| T34 | Not verified | Resources currently use user-data paths; explicit old-resource migration is incomplete. |
| T35 | Partial | INSTALL covers prior installer upgrade; current branch resource reuse is unverified. |
| T36 | Not verified | Packaged inference with Chinese/space paths has not been accepted. |
| T37 | Not verified | Installation-directory permission selection/fallback has not been accepted. |
| T38 | Not verified | Real insufficient-disk behavior has not been exercised. |
| T39 | Partial | UNIT covers interrupted ranges, cancellation and resumed verified parts; real interruption pending. |
| T40 | Partial | UNIT covers timeout/source fallback and bounded errors; full real HTTP matrix pending. |
| T41 | Partial | UNIT checks hashes and invalid archives; real installed corruption recovery pending. |
| T42 | Partial | UNIT covers stage failure/retry; installed selective repair remains unverified. |
| T43 | Not verified | Real application exit and restart during installation not accepted. |
| T44 | Partial | CPU generated actual text, translation and three trained-voice WAVs; playback not checked. |
| T45 | Not verified | Compatible physical NVIDIA GPU installation and actual inference unavailable here. |
| T46 | Not verified | Real incompatible driver/out-of-memory and CPU fallback not exercised. |
| T47 | Not verified | Real CPU/GPU switching and isolation are not accepted. |
| T48 | Partial | UNIT covers separate GPT/SoVITS downloads; real independent import/pair validation pending. |
| T49 | Partial | Successful chat/voice clears its matching companion error; automatic revalidation is incomplete. |
| T50 | Partial | Some async configuration races are covered; a unified capability-version service is incomplete. |
| T51 | Partial | Voice errors do not intentionally disable chat; actual separate failure and recovery pending. |
| T52 | Not verified | Installed uninstall/retain/delete choices and external files not accepted. |

## Vision and permissions

| Case | Result | Evidence or remaining gap |
| --- | --- | --- |
| T53 | Partial | UI/UNIT cover settings route and return; real configured provider flow pending. |
| T54 | Not verified | No genuine image-capability request to a user provider has been tested. |
| T55 | Partial | UNIT covers explicit consent boundaries; no physical capture-device audit. |
| T56 | Partial | Consented bounded sampling exists; context-aware autonomous companionship is incomplete. |
| T57 | Not verified | Real selected-window loss and safe pause have not been accepted. |
| T58 | Not verified | Complete similarity detection, budgets and repetition suppression are incomplete. |
| T59 | Not verified | Context-sensitive quiet companionship is incomplete. |
| T60 | Partial | UNIT covers stop, hide and cleanup; real lock/sleep/capture device pending. |
| T61 | Partial | Destination changes revoke consent; real provider/source-change flow pending. |
| T62 | Not verified | Real visual reply, playback, scrolling and deduplication not tested end to end. |
| T63 | Not verified | No end-to-end adversarial screenshot test against a real visual API. |
| T64 | Not verified | Real provider rate limits, budget and recovery not exercised. |

Do not publish a revised final Release or claim this matrix is complete on the
basis of the above partial results. Never add separate public visual model files.
