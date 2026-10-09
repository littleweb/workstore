# WorkStore adapter

Original baoyu-xhs-images 2.0.1 instructions and references are vendored unmodified under MIT at the pinned commit in UPSTREAM.json. Runtime resources are hash-verified during prebuild. This is an application adapter of an instruction skill, not a standalone SDK.

The application form and explicit Generate button confirm topic, style, layout, palette, count, audience and ratio. Knowledge cards use strategy B (information-dense), with cover and ending sparse. Analysis and outline are persisted with the complete prompt group before image generation. Desktop writes immutable per-group Markdown files under .workstore/course-prompts/<id>/<hash>/prompts/. JSON is the synced source of truth.

The shared WorkStore AI gateway plans text and renders raster images. The cover is generated first without references; later cards use only this cover as their reference and run in two parallel slots. Failed images retry once; saved successful cards are retained. Cancellation, partial results, history, token-checked local files and project memberships use existing infrastructure. No code overlays repair generated text.

Three built-in reference series are original generated examples, not user documents. Viewing examples does not create files. Only Generate or explicit Copy creates a saved work. Other course creation modes remain unavailable until implemented.
