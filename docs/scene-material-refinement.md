# Miniature scenes and live architectural materials

The production registry now contains ten scenes. Saved IDs remain compatible:
`city` loads Lawson, `forest` loads Arashiyama and `bookshop` loads the original
bookshop block with a new Tenkaippin restaurant. Retired forest/stream and
convenience factories are no longer imported. `inage` and `kyoto` are new entries.
The classroom, school, seaside hall and Crystal View retain their composition
with the material/detail pass.

## Reference and construction decisions

Made using `3dviz-pro-max`: object reasoning, object craft, lighting direction
and scale, motion/state and actual rendered review. Catalog knowledge adapted:
`knowledge.dielectric-surface`, `knowledge.material-porous-weathered-stone` and
`knowledge.tree-crown-root-architecture`. Geometry is custom Three.js; no
scene kits or AI-generated bitmap assets are used. The November 3 pass adds the
bundled CC0 photographic textures documented below.
User photographs and three extracted frames from the supplied five-second
overpass video provided visual references.

| Scene | Distinctive construction and finish |
| --- | --- |
| Arashiyama | Tapered culms with actual raised nodes; irregular leaf sprays; curved path ending in a T junction; rear brush fence, stone bank and dense vegetation; bamboo rails, twig fencing, drainage stones, moss and fallen leaves |
| Lawson | Blue/white fascia with thin rose stripe, aluminium storefront, shelves behind glazing, blue parcel lockers, tactile strip and parking stops; branching trees and individual leaves replace spherical crowns |
| Inage | Steel arches, hangers, underside braces and concrete piers; separate pedestrian level with narrow central stair and broad bicycle ramps; practical street lights |
| Kiyomizu + torii | Red gate columns, painted bracket stacks, upturned tiled roofs, pagoda and finial, stone terrace/stairs; curving torii corridor with black feet, curved caps and donor markings |
| Bookshop + Tenkaippin | Original bookshop and street retained; adjacent restaurant adds framed cream signs, red disc emblem, paper lanterns, timber lattice, counter, red stools and bowls |
| School | Chalky plaster, muted red horizontal gate panels, silver window divisions, recessed glazing/blinds and individual hedge leaves |
| Seaside hall | Mineral stair treads with grout, dark timber entrance, satin rails and clipped leaf hedges |
| Crystal View | Nonmetallic glazed skin with restrained sky response; slender mullions and internal stairs retained |
| Classroom | Separate roughness for timber, paper, plaster and steel; dry interiors |
| Sakura stream | Branch-supported weeping blossoms, translucent flowing shallow water, submerged stones, petal fall/float, continuous bank and blossom path, distant green bridge and mountain layers |

These are illustrated miniatures, not surveyed reconstructions. Kiyomizu and
Fushimi Inari are deliberately combined at the user's request; their juxtaposition
is not real geography. Unseen backs/interiors are approximated. References were
cross-checked with [Kiyomizu-dera](https://www.kiyomizudera.or.jp/en/visit/),
[Fushimi Inari](https://inari.jp/en/) and [Tenkaippin](https://www.tenkaippin.co.jp/).
The Google Maps page was inaccessible; no Google 3D view was used or claimed
as inspected.

## Shader and resource design

`surface-materials.mjs` preserves Three's standard lighting/shadow pipeline and
adds world-space colour, roughness and normal variation through `onBeforeCompile`.
Instanced transforms participate. Derivative filtering fades fine grain below
pixel scale. Existing paving maps retain their own joints. Bamboo, mossy earth,
aggregate, wood, paper, metal and glass have separate responses. Glass is alpha
compositing with view-dependent opacity, not ray-traced transmission. Toon
upgrades preserve source maps, wind hooks and animated colour/emission.

`canopy-rays.mjs` illustrates Tyndall scattering with three softly faded volumes
from canopy openings to path receivers. Orientation follows the key light.
Clouds attenuate their strength; night, overcast and low-angle rays extending
outside the miniature hide them. This is atmospheric approximation, not
volumetric path tracing. Static detail is merged by material; bamboo and leaves
are instanced. Moving leaves retain vertex wind; fallen leaves remain still.
Disposal releases added GPU resources exactly once.

## Real time and weather

The main app retains its single `useSceneClimate` provider, local clock fallback,
location consent and normalized current Open-Meteo data. New scenes use the same
input. No fixed photo mood overrides live time or weather.

- Solar input updates light direction within a lighting preset without rebuilding
  geometry or changing the camera.
- Clouds soften contrast and alter the sky reflection. Rain darkens exposed
  surfaces, lowers roughness, adds streaks and atmospheric attenuation.
- Snow affects exposed upward-facing surfaces; historical accumulation is not
  inferred. Wind changes leaf motion.
- Practical lamps respond to day/evening/night. Outdoor night skies darken;
  daytime forest shafts vanish.
- Interiors stay dry. Unknown weather clears weather effects and does not claim
  actual clear skies.

The existing input supplies elevation/hour angle, not calibrated building
orientation: world-space sunlight is an artistic mapping of real input, not a
geographic shadow survey. The browser preview has not enabled location weather:
its clock is live and weather remains unavailable until authorized.

## Preview and verification

Settings > Appearance > `观赏当前三维景观` opens the production gallery.
`近景细看` selects the photo camera; `完整微缩景观` or Home restores the complete
base. Both retain live climate. Drag/scroll controls and the scene menu remain.

`node scripts/review-scene-materials.mjs expanded-final` renders all nine actual
factories in isolated Electron using the production backdrop. It captures
normal, close, rain and night views and checks shader/browser errors, solar
movement, unchanged geometry/camera and dry-weather reset. Test climates are
injected only into that isolated review, not the user's live preview.
Report: `build/material-review/expanded-final/report.json`.
The subsequent bamboo surface-winding correction is verified separately with
`REVIEW_SCENES=forest` and phase `bamboo-final`; downward raycasts verify visible
asphalt at the entry, middle, end and T junction.

Regressions: `diorama-construction`, `scene-finish`, `scene-gallery`,
`coastal-scene-factories`, `scene-climate`, `scene-weather`, `scene-overview`.
Build: `npx vite build`. Review timing includes GPU synchronization, not full-app
FPS with a character. Images and automated checks show rendered behaviour;
they are not a claim of photographic fidelity or user approval.

## November 2 feedback pass: form, canopy and Shader revisions

Applied `3dviz-pro-max` object-craft and rendered-review workflow. GitHub references inspected:
- [Three.js official modified-material example](https://github.com/mrdoob/three.js/blob/dev/examples/webgl_materials_modified.html): retained lighting pipeline, composed `onBeforeCompile` hooks, shared time uniforms and distinct program cache keys.
- [Sakuragaoka Station design notes](https://github.com/Kenton-GMI/sakuragaoka-station/blob/main/docs/DESIGN.md): reference-led Japanese street construction, branch/foliage separation, batching static details and checking close-up output. Its project-specific instructions and toon-only rules are not adopted.
- [Three.js post-processing example](https://github.com/Experience-Monks/threejs-post-process-example/blob/master/README.md): reviewed as historical pipeline reference; no old dependencies installed.

Bamboo: removed the small sign; dull physical culms, filtered longitudinal grain,
rooted wind deformation shared by shadow depth shaders, nighttime ground lights,
finer asphalt relief, darker canopy. Subsequent feedback removed disconnected
cross-bars: shoots now originate on actual transformed culms, taper upward and end
inside leaf sprays. Green albedo and ambient balance were adjusted to reduce grey
wash while preserving shade. The rear T junction remains. No Blender round trip
was necessary for these procedural changes.

Tenkaippin: frontage widened from 5.2 to 7.3 metres; two-storey window divisions,
small facade tiles, sign frames, projecting sign, paper lantern ribs, shoji bays,
service duct and counter/stools. Both old cherry blobs are hidden; replacements
use branch-supported individual five-petal geometry, with matte folded shading.

Kyoto: rebuilt west gate and a detached pagoda behind its right shoulder; continuous
double-skin curved roofs, tile ribs and end caps, visible rafter tips, brackets,
open passage, recessed lattices, ashlar terrace, stairs, stone lanterns and a
curving torii approach. This remains an illustrative miniature composite, not a
photogrammetric reconstruction or a claim that the sites are adjacent.

Validation: `critique-final` captures the three revised factories in day, rain,
night and bamboo motion states with zero shader/browser errors. The subsequent
`bamboo-canopy-final` repeats these checks after canopy feedback. Review includes
actual distinct wind frames, path/T-junction raycasts, solar direction changes,
unchanged camera/geometry and wetness reset. 47 related tests pass, including
wind/shadow uniform sharing, motion pause/resume and depth resource disposal.
Production Vite build passes; existing large-chunk warning remains.

## November 3: photographic surfaces, forest depth and clear moving water

Read the actual GitHub skill files requested by the user, as design and
engineering references rather than substituting a generic JS tutorial:

- [Anthropic frontend-design SKILL.md](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md): ground the visual direction in the subject and critique the result against the brief. Here the subject is quiet Japanese streets, painted infrastructure, forest shrines and spring water; typography/UI redesign is outside this pass.
- CloudAI-X [materials](https://github.com/CloudAI-X/threejs-skills/blob/main/skills/threejs-materials/SKILL.md), [lighting](https://github.com/CloudAI-X/threejs-skills/blob/main/skills/threejs-lighting/SKILL.md) and [shaders](https://github.com/CloudAI-X/threejs-skills/blob/main/skills/threejs-shaders/SKILL.md) skills: distinct dielectric/metal response, colour versus scalar texture data, physical light falloff, environment response, composed Standard-material shader hooks, and shader-error inspection. Their r186 examples were checked against the locally installed r185 implementation; the existing WebGL renderer is retained.

`architecture-textures.mjs` preloads bundled CC0 albedo/roughness maps before
scene creation, then creates scene-owned texture clones. World-space triplanar
projection gives a physical scale independent of mesh UVs. Photographed grain
adds colour, roughness and derivative bump variation; painted timber retains its
vermilion coating. Data and sources are in
`public/textures/architecture/SOURCES.md`. No Claude application or image API
was invoked, and no unknown skill scripts were installed or executed.

Inage preserves its approved two-deck structure. Blue-painted steel and pale
painted railing remain dielectrics; only exposed galvanized fasteners are
metallic. Splice plates, hex bolts, form ties, expansion joints and shielded
downward lamps explain the construction. The middle lamp casts an actual
shadow; the other fixtures avoid multiplying shadow-map cost. Near and night
views are checked in `build/patina-independent-review`.

Kyoto adds a continuous rising hillside and connected curved path, coping
stones, layered trees, fern understory, fallen leaves and small warm path
lanterns. The companion camera looks along the torii corridor at walking
height. The separate gate and pagoda remain available in the complete miniature
and photo views. This is still the documented composite, not a real-site scan.

`sakura` / 花影随流 is a new independent scene, based on the user's photo and
three frames extracted from their video. The bank height field owns ground,
stones, grass, path and petal contact. The shallow water retains the colours of
the bed instead of applying an opaque gray/blue tint. Actual planar scene
reflection/refraction follows installed Three
[Reflector](https://threejs.org/docs/pages/Reflector.html),
[Refractor](https://threejs.org/docs/pages/Refractor.html) and
[Water2](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/objects/Water2.js)
implementations. Optical ripples flow toward +Z; water-level geometry is flat.
Sun glints and a restrained caustic modulation approximate appearance rather
than solve fluid dynamics or full light transport. Petals fall, land on the
waterline and drift inside its curved banks. Pause freezes phase and transforms.
Foreground flowers have curved, cupped five-petal geometry. More distant crown
fullness uses branch-attached alpha cutouts drawn procedurally from many small
five-petal blossoms, with open texture gaps; these move with their woody branch.
The forest backdrop also uses individual folded leaves, not opaque crown balls.

The shop block and Lawson now include neighboring buildings, side lanes,
recessed windows/balconies and utility lines. Lawson's main view faces the
frontage. Scene names stay in the metadata catalog, so existing saved IDs are
preserved. The hidden blackboard has no visible hints or glow. Its locally
saved image sends on character-panel movement, new conversation, or three
minutes after the final stroke release; accepted receipts cannot clear newer
ink. Failed submissions retain the drawing. Actual-App tests cover the busy
reply queue as well as idle reset and one-shot delivery.

Final verification for this pass:

- 68 related unit/integration tests across the scene, clock, blackboard, image
  routing and material suites; the final material/bridge/stream subset is 21/21.
- Actual-App blackboard probe: ten baseline behaviours plus five three-minute
  timing behaviours; the five timing cases were rerun after removing the queued
  drawing status notice. No page errors, and no provider requests were made.
- `scripts/verify-scene-ui.mjs`: ten actual scene selections, composer usability
  and background inspection without moving the character; isolated profile,
  `build/scene-ui-review/report.json` passed.
- `build/patina-independent-review/report.json`: actual photographed shader
  samplers, day/night/close views and five alternating disposal cycles. All
  per-scene photographic texture clones release once; renderer cache counts
  remain flat.
- `build/clear-stream-review/report.json`: visible coloured bed/reflection,
  changed flow frames, pixel-identical paused frames, offscreen render state
  restoration and exactly-once resource release.
- `build/sakura-stream-review/report.json`: inspected final day, night, rain,
  clear-day water close-up and two motion frames. Measurement is GPU-synchronized
  scene rendering on this machine, not a full-app or cross-machine FPS promise.
- Production `vite build` and `scripts/review-built-scenes.mjs --record`: actual
  `file://` compiled scene chunks and bundled photographic maps. The latter
  writes `build/built-scenes-review` day/night frames and a short creek recording.

## Follow-up: clearer light, complete campus, and flowing water

The shared finish now uses Neutral tone mapping, stronger pigment chroma,
clearer blue daylight and a higher direct-to-fill ratio. Dry-day atmospheric
fog is reduced without changing explicit rain/fog weather. Native material
colours, solar direction and exposure remain authoritative; repeated climate
updates do not compound the adjustments. Native detail is retained on common
150% Windows displays by raising the background pixel-ratio ceiling to 1.5
(interactive inspection: 1.75). All ten scenes use this pipeline. See
[Khronos' explanation of Neutral colour reproduction](https://www.khronos.org/news/press/khronos-pbr-neutral-tone-mapper-released-for-true-to-life-color-rendering-of-3d-products).

Every outdoor scene has a distant cratered moon outside its finite framing
bounds. It follows night visibility and fades behind cloudy/rainy/foggy weather;
geometry still occludes it and stream captures include its reflection. The
classroom remains an interior. Kyoto's main walking camera is centred on the
torii passage. The Inage lowest road has six actual shielded practicals; an
isolated lamp-only render verifies the illumination of the road surface.

The school is one campus with a courtyard and entrances on perpendicular
streets, following the user's reference photographs and the
[official campus plan](https://www.city.chiba.jp/kyoiku/kyoikusomu/kikaku/documents/documents/410inagegakkouyouran.pdf).
The default camera faces the white entrance from pedestrian height. Lower
red gate walls reveal the paired stairs; the library/clock entrance and corner
overview remain separate camera presets. School massing is a compact
reconstruction rather than a measured survey.

The stream bed is approximately 0.9–1.14 m below its waterline and the grassy
embankment rises about 1.58 m. Trees, path, bridge approaches and landed petals
share the same height field. Curved rooted blades, root fibres and bundled
CC0 [Leafy Grass](https://polyhaven.com/a/leafy_grass) photographs replace flat
lawn colour on the creek banks, bridge verges, school and coastal lawns.
Cherry limbs have cylindrical bark maps, lenticels, cupped flowers and
irregular hanging blossom curtains. Local wave wakes follow real protruding
stones. Water optics retain the actual reflected/refracted scene, with
directional solar highlights and one authoritative paused/resumed flow clock;
this remains an appearance model, not a fluid solver. Local site orientation
rotates the real sun and its water input together.

Appearance settings now save light/dark/system UI themes independently of
scene lighting. Scene-time settings can preserve a fixed HH:MM across reloads;
water motion and real wall clocks keep their existing independent behaviour.
`scripts/review-scene-preferences.mjs` checks these controls and native save/
reload in an isolated real desktop app profile.

The follow-up verification passed 93 scene/clock/blackboard/theme integration
tests plus two new current-obstruction and pause/solar tests. The final changed
water/material subset passed 24/24. All ten compiled `file://` scenes rendered
day and night without page/GL errors, and required grass/architecture maps were
verified from bundled files. The final creek recording decoded to 104 moving
frames. Actual-app preference persistence and all ten menu selections also
passed in isolated profiles. Reports are under `build/built-scenes-review`,
`build/scene-preferences-review`, `build/scene-ui-review` and
`build/water-turbulence-review`.
