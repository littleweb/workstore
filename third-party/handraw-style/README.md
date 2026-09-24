# handraw-style integration

Source: https://github.com/yang0/handraw-style

The vendored snapshot is version 1.2.5, imported from the complete installed package. It contains all 277 indexed styles, 119 layout definitions and 30 colors. The snapshot's file hashes and original relative paths are in `manifest.json`; no unverified upstream commit is asserted. Original skill contracts, index data, the canonical style descriptions and MIT license are retained here. The app's attribution dialog includes the license.

`python3 scripts/handraw-style/import.py /path/to/handraw-style` reproduces the catalog and bundled references from that source snapshot. The importer copies only explicitly selected public resources, never credentials or user-generated covers. Assets prefer numbered grid references when present, exactly as the upstream resolver does. The style catalog remains complete even when the UI filters by category or search.

The cover adapter implements the style activation decision, positive trait filtering, explicit layout instructions, theme-color selection and poster text integration. Codex's configured reasoning model is not treated as a known image-model identity; the adapter therefore uses the upstream unknown-model fallback and includes the numbered style reference. User text and edit-target references are distinct from style references. The original skill is a resource and prompt workflow, not a bundled model or independent server.

Saved covers and generated images live in the user's workspace, not this repository. Real model quality and exact typography depend on the configured image-capable provider and require separate acceptance testing.
