# The screening room — the capture recipe

How a validate run captures the rendered surface into ONE fresh evidence generation, and
what a complete generation contains. The validate card's capture step executes this
recipe; the `kiln-review screen` / `screen-recheck` verbs grade ONLY the CURRENT
generation named by its manifest. An incomplete capture is an honest act failure — never
a graded artifact, and never a reason to install anything.

## No-install, or the honest hold

Every command below runs what the machine already has — `npx --no-install playwright …`
and `ffmpeg …` only. Probe first, and record both version strings:

```bash
npx --no-install playwright --version
ffmpeg -version
```

A failed probe IS the outcome: return the honest not-ok naming the missing runtime —
never an install, never a substitute capture. The recorded versions land in `meta.json`
and again in the manifest.

## Generations

All evidence lives under `.kiln/evidence/gen-<n>/`. The generation law:

- ALLOCATION reserves `gen-<max(ALL existing gen-* entries) + 1>` via EXCLUSIVE `mkdir`
  with collision retry. A manifest-less crash-residue dir still occupies its number —
  the scan counts names, never manifests.
- The capture pass touches ONLY its reserved dir.
- `manifest.json` is published LAST via temp + rename. Until it lands, the generation
  does not exist to any reader.
- CURRENT generation = the highest `gen-<n>` containing a valid `manifest.json`.
- Temp + rename discipline throughout — no reader ever sees a half-written file.

Reserve with exactly this allocator, from the project root:

```bash
GEN="$(node -e '
const fs = require("fs")
const root = ".kiln/evidence"
fs.mkdirSync(root, { recursive: true })
for (;;) {
  let next = 1
  for (const name of fs.readdirSync(root)) {
    const m = /^gen-(\d+)$/.exec(name)
    if (m) next = Math.max(next, Number(m[1]) + 1)
  }
  const dir = root + "/gen-" + next
  try { fs.mkdirSync(dir); process.stdout.write(dir + "\n"); break }
  catch (e) { if (e.code !== "EEXIST") throw e }
}
')"
```

The non-recursive `mkdir` is the atomic reservation; an `EEXIST` collision loops back to
rescan — it never overwrites, and any other failure throws honestly.

## The required set

Serve the built artifact (a static site serves with `npx --no-install http-server` or
`python3 -m http.server`; a dev server the LAW's own proxies already run needs nothing
new), then capture into `$GEN` — every class below required:

- **meta.json** — served URL, HTTP status, page title, and the probed runtime versions.
- **dom.html** — the RENDERED DOM snapshot (post-load, never the source bytes).
- **console.log** — every browser console line during load and interaction.
- **viewport-desktop.png** — EXACTLY 2 required viewports; desktop is 1280x800, captured to
  a temp name and renamed into place like every other file:
  `npx --no-install playwright screenshot --viewport-size=1280,800 "$URL" "$GEN/.tmp-$$-viewport-desktop.png" && mv "$GEN/.tmp-$$-viewport-desktop.png" "$GEN/viewport-desktop.png"`
- **viewport-mobile.png** — mobile is 390x844:
  `npx --no-install playwright screenshot --viewport-size=390,844 "$URL" "$GEN/.tmp-$$-viewport-mobile.png" && mv "$GEN/.tmp-$$-viewport-mobile.png" "$GEN/viewport-mobile.png"`
- **film.webm** — ONE interaction/scroll film: drive the page once (exercise the primary
  control, scroll the full height) in a playwright context with `recordVideo` — the
  driver below collects dom, console and meta on the same pass. Where playwright video
  cannot run, an `ffmpeg` screen capture (`-f x11grab`) of the same pass is the
  alternative.
- **keyframes/kf-<label>.png** — labeled keyframes extracted from the film with ffmpeg:
  at least 1, at most 6, kebab-case labels naming the moment:
  `ffmpeg -ss <t> -i "$GEN/film.webm" -frames:v 1 "$GEN/keyframes/.tmp-$$-kf-<label>.png" && mv "$GEN/keyframes/.tmp-$$-kf-<label>.png" "$GEN/keyframes/kf-<label>.png"`

Reference images are optional: at most 2, copied INTO `$GEN` from the repo paths the LAW
Perceptual table's `reference` cells name (the pass touches only its reserved dir — it
copies, never links out).

One driver collects film + dom + console + meta in a single pass — interpolate the
probe's version strings where marked:

```bash
node - "$URL" "$GEN" <<'DRIVER'
const { chromium } = require("playwright")
const fs = require("fs")
const [url, gen] = process.argv.slice(2)
const publish = (name, data) => {
  const tmp = gen + "/.tmp-" + process.pid + "-" + name.replace(/\//g, "-")
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, gen + "/" + name)
}
;(async () => {
  const browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    recordVideo: { dir: gen, size: { width: 1280, height: 800 } },
  })
  const page = await context.newPage()
  const lines = []
  page.on("console", (m) => lines.push(m.type() + ": " + m.text()))
  const response = await page.goto(url, { waitUntil: "networkidle" })
  await page.mouse.wheel(0, 4000) // the scroll pass — exercise the primary control here too
  await page.waitForTimeout(1500)
  publish("dom.html", await page.content())
  publish("meta.json", JSON.stringify({
    url, status: response ? response.status() : null, title: await page.title(),
    runtimes: { playwright: "<probed>", ffmpeg: "<probed>" },
  }, null, 2))
  const video = page.video() // grab the handle now — the file is sealed only when the context closes
  await context.close()
  fs.renameSync(await video.path(), gen + "/film.webm")
  publish("console.log", lines.join("\n") + "\n")
  await browser.close()
})()
DRIVER
```

## Bounds

EXACTLY 2 required viewports; keyframes at least 1, at most 6; references at most 2;
total image transport cap: 10 (2 + 6 + 2). The screen verbs reject any overflow before
any grader spawns — pick the keyframes that carry the film's story rather than sampling
densely.

## The manifest — published LAST

When every file above is on disk, compose `manifest.json` naming every file (paths
relative to the generation dir), the counts, its own gen number, and the recorded
runtime versions — then publish it via temp + rename as the FINAL act:

```json
{
  "generation": 3,
  "runtimes": { "playwright": "Version 1.44.0", "ffmpeg": "7.0" },
  "files": {
    "meta": "meta.json",
    "dom": "dom.html",
    "console": "console.log",
    "viewport_desktop": "viewport-desktop.png",
    "viewport_mobile": "viewport-mobile.png",
    "film": "film.webm",
    "keyframes": ["keyframes/kf-settled.png", "keyframes/kf-scrolled.png"],
    "references": []
  },
  "counts": { "keyframes": 2, "references": 0, "images": 4 }
}
```

The manifest is the generation's birth certificate: a dir without one is crash residue —
it occupies its number and nothing more. The screen verbs hold it to its word pre-spawn:
the gen number must match the dir, the runtime versions must be recorded, the counts
must equal the named files, and every named file must physically exist inside the
generation dir — a misdescribing manifest never grades. The graders bind their verdict
to the evidence by digest: the published verdict's `law_hash` is the
sha256 of this manifest's bytes.

## Completeness, or the honest not-ok

The capture contract is binary: a COMPLETE manifest — every required class present,
inside every bound — or an honest not-ok return. On an incomplete pass, retry ONCE with
a fresh generation (abandon the incomplete dir manifest-less; the allocator's occupancy
rule absorbs it); still incomplete, return the failure string naming what is missing.
Never a partial manifest passed off as done.
