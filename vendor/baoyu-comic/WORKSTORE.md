# WorkStore adapter

The original baoyu-comic skill and reference files are vendored unmodified under
MIT, pinned by `UPSTREAM.json`. `scripts/story-comic/build-resources.mjs` verifies
all source hashes and builds the runtime reference bundle. Update the pinned
source, hashes, and generated bundle together; never silently fetch at runtime.

WorkStore executes an application adapter of this instruction-based skill; it
does not invoke a nonexistent baoyu-comic SDK or run the interactive skill CLI.
`src/story-comic/baoyu.ts`, `model.ts`, and `workflow.ts` load original analysis,
character, storyboard, base-prompt, art, tone, layout and preset definitions.

Application adaptations:
- The saved topic, style, tone, language and audience form replaces EXTEND.md and
  interactive confirmation; Generate confirms these settings. Internal outline
  and prompt review remain hidden as requested by the product specification.
- Six art styles and five presets use upstream IDs; seven tones are selectable
  for art styles. Presets keep their prescribed tone and special rules.
- Analysis, characters and panel-by-panel storyboard are structured into the
  local document JSON. Complete prompts are saved there before image calls;
  desktop saves also materialize immutable standalone Markdown prompt groups
  in `.workstore/story-comic-prompts/<id>/<hash>/prompts/`. The JSON is synced;
  prompt files can be recreated on another device from that source of truth.
- WorkStore's unified AI interface supplies text and raster generation. The
  shared service capacity is two, so two page workers use the same prior
  character reference. Failed items retry once; existing successful pages stay.
- Product auto page counts are 4–8 including cover; manual counts extend to 20.
  Output dimensions offer 3:4, 1:1, 9:16, 4:3 and 16:9. Prompt contracts
  explicitly override the older base-prompt template's 2:3 default. Whole-page scaling/padding normalizes explicit output
  dimensions without cropping or repainting any lettering.
- Generated pages contain native lettering. No Canvas lettering is applied to
  newly generated baoyu pages. Legacy saved images remain unchanged; the legacy
  compositor remains available only for legacy content.
- Existing content-addressed image storage, cancellation, conflict handling,
  version history, PNG/ZIP/PDF export remain the application infrastructure.
  Browser preview stores prompts in IndexedDB (no desktop prompt directory).

No automatic visual inspection or guaranteed text accuracy is claimed. A page
with poor lettering can be regenerated while retaining the prior image.
