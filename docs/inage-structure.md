# Inage Overpass structure correction

The upper vehicle deck and lower pedestrian span share a longitudinal axis.
National Route 14 crosses underneath both, perpendicular to that axis. The
pedestrian staircase belongs to the end of the elevated walkway: its narrow
central treads and broad smooth side ramps rise toward the pier landing, rather
than descending into an island in the ground road. A curved ascending approach
wraps around the pier beside the wooded bank.

The reconstruction uses the user's Google Maps screenshots and these inspected
photographs:

- [Wide photograph, own work by 掬茶, 2011](https://commons.wikimedia.org/wiki/File:Inage_overpass.jpg): upper arch road, lower span, and perpendicular ground road.
- [Photographer's field visit, 2024](https://rasandroad.com/spiral/inage.html): blue underside bracing, curved ramp and upper road approach.
- [Pedestrian approach photographs](https://ameblo.jp/hinata-himawari2020/entry-12627908457.html): central stairs, side ramps, portal pier and landing.
- [On-site walking account and photographs](https://baytown.dokkoisho.com/chiba/inage/inage-sengen.htm): access routes and vertical separation.

Google Maps automatic access failed during this correction. Its supplied
screenshots were inspected; no new Google Maps panorama was captured. Reference
photos are used for construction decisions, not shipped as textures or assets.
Dimensions and unobserved approaches remain miniature approximations, not a
survey. The reported 17 m local elevation difference is not used as the gap
between the two decks.

`node scripts/review-inage-structure.mjs` captures the production scene in an
isolated hidden Electron window to `build/inage-structure-review/`: overview,
side, end, top, walkway, road underpass and night. It also opens the actual shared
scene menu twice and checks every catalog icon and the composer, covering the
previous white-screen regression. This does not exercise real desktop IPC,
model inference or user data.
