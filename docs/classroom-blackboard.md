# Classroom clock and hidden blackboard

The wall clock samples the computer's local time. Its hour, minute and second
hands share that sample and catch up after suspension. A one-second host
invalidation keeps it current with decorative motion paused. Hidden windows
sleep; scene changes and disposal release the timer.

The companion camera faces the blackboard straight along Z. Vertical framing
uses a lens shift rather than camera pitch, keeping the board a rectangle while
showing the classroom floor. Its placement leaves the board between the sidebar
and character panel. Temporary scene overview interpolates that shift to zero
and restores it on return; inspection never changes the saved scene preference.

The classroom blackboard is an unadvertised Easter egg. Drag directly over the
actual board to leave white freehand marks. There is no toolbar, drawing pad,
hint, border, ring, glow, pointer change or other visible affordance. The empty
board always retains its authored material and dusty texture. White marks live
on a genuinely transparent CanvasTexture on an owned, non-additive overlay mesh
sharing the exact board geometry. Only that ink layer changes or disappears; it
does not add a rectangular background, border, highlight or glow. Disposal
releases the owned texture/material/mesh and never the shared board geometry.

A fully transparent, non-intercepting polygon follows the actual four projected
board corners. Document capture starts drawing only after a raycast hits the
board, and subsequent UV hits remain within that mesh. Pointer capture keeps a
stroke coherent; leaving the board stops ink and re-entry starts a fresh segment.
Native buttons, links, inputs, textareas, editable content, scene controls and the
character panel keep their existing interactions even when visually overlapping
the board. Hidden documents, blur, cancellation and unmount release capture.

Starting a new conversation or moving/resizing the character panel automatically
submits existing ink into the current conversation. Finishing a stroke also arms
a silent 180000 ms (three-minute) idle deadline. A held pointer cannot time out;
every new stroke resets the deadline at its release. Empty boards never submit.
The same unchanged snapshot is attempted only once, retaining ink on failure.
Hidden or temporarily disabled boards wait to deliver until visible/active again,
catching up an elapsed deadline only in the same conversation/character scope.
Changing that scope cancels the stale deadline, while new drawing can rearm it.
Unmount cancels the timer. The idle helper never clears ink independently. New-conversation submission
belongs to the outgoing conversation. Queued drawings retain their conversation
and character identity, and later marks survive an earlier snapshot's acceptance.

The exported image is a 1568 × 444 PNG with a dark-green background and white ink.
That background is composited into a separate export canvas; it never appears
on the live transparent ink canvas or replaces the authored blackboard. It is
saved into local conversation history before ink clears, then sent through the
configured vision route with persona, text history, streaming and translation.
Missing vision configuration or failed local saving retains the board. A remote
failure retains the already-saved image. Browser UI preview allows drawing but
has no Electron IPC for actual sending. No screen/camera capture is involved.

The backend accepts only bounded PNG data URLs (2 MiB decoded, at most 2048 ×
2048) and validates native decoding. Image contents remain user data. Validation
uses `classroom-clock.test.cjs`, `scene-clock-host.test.cjs`,
`blackboard-drawing.test.cjs`, `blackboard-idle.test.cjs`, `chat-image.test.cjs`, and optional browser probes
`blackboard-overlay-browser.mjs` and `blackboard-chat-browser.mjs`. These probes
use isolated fixture data and make no actual provider requests.
