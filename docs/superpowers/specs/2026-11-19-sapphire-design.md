# ELA: Sapphire execution workspace

The user delegates art direction and requests implementation and a separate PR. This document records implementation decisions, not additional user approvals.

## Diagnosis
The real Chrome baseline is in `docs/screenshots/sapphire-before`. The command is below 1,500px on desktop; an empty network readout takes precedence over doing work. Idle CORE multiplies whole-scene opacity (.5) by plate opacity (.34). Seven execution states collapse into three tones. Every surface repeats the same corner marks and muted gradient. The confirmation bar's display:flex overrides its hidden attribute, exposing irrelevant controls before any transaction lookup.

## Direction
A precise execution workspace, with bright sapphire refraction confined to a semantic six-stage map. Command and analysis precede the map; verified network readings follow. Six distinct planar glyphs describe input, gate, scope, network, read and result. No invented physical device, cylinders, steps or old Core concepts. Waiting stages retain material presence and explicitly say Waiting; only successful stages receive checks. Blocked, failed, skipped, unknown and running carry distinct symbols and text.

Alternatives considered: another isometric device repeats rejected concepts; a decorative hero image adds weight without explaining execution; the semantic map gives state, identity and responsive structure together. My choice is the semantic map. No raster generation, external fonts, new packages, network capabilities or animations disconnected from state.

## System
Deep navy page, saturated sapphire highlights, ice edges, limited violet reflection. Light theme uses white and blue ink; dark uses graphite. System sans typography for reading, monospace for identifiers. Consistent panel borders and generous, bounded spacing. Wide view has six stages; narrow view reflows them and lets every label wrap. No fixed text heights, no truncated headings. At 200% text, labels stay real HTML and grid columns collapse.

## Boundaries
Keep agent/session, interpreter, safety gate, registry, guarded fetch, RPC methods, PQC implementation, lazy chunks and existing workflow permissions untouched. Preserve all existing capabilities, translations and confirmation behavior. Archive the previous renderer. All visual state comes from readRecord(), never timers or invented activity. No success animation.

## Evidence
Run existing tests and build; adapt only visual assertions explicitly superseded by this redesign, preserving safety and behavior assertions. Add all-seven-state semantic tests and audit 6 widths × 3 font scales × 2 languages × 3 themes. Capture waiting, fixture success, refusal, fixture network error, mobile 200% and desktop. Browser font scaling is an approximation, not a claim of physical Redmi testing. Keep fixtures clearly labelled and outside product code.
