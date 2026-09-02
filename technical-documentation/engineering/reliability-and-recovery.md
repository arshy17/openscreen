# Reliability and recovery

OpenScreen treats an edit as recoverable data, not as a single mutable JSON file. All features in this document are local and optional unless explicitly stated.

## Project persistence

- Canonical `.openscreen` documents continue to use serialized temp-file, flush, and atomic-rename writes.
- Before a changed canonical document is replaced, OpenScreen retains a timestamped automatic recovery point at most once per minute.
- The newest 40 automatic points are retained per project. Manual, AI, and pre-restore points are not removed by that rolling limit.
- Creator Edit creates a `Before Creator Edit` point before applying any approved proposal.
- Restoring a point first saves the state being replaced, so recovery can itself be undone from the Recovery panel.
- If the canonical JSON cannot be parsed, opening falls back to the newest validated recovery point without overwriting the damaged source.

Recovery files live under `userData/projects/.recovery/<project-id>/`. Deleting a project removes its associated recovery directory.

## Portable projects and media relinking

`Creator Toolkit > Recovery > Collect media` creates a new folder under the user's Documents directory at `OpenScreen Projects/`. It contains:

- `project.openscreen` with screen, camera, and background-music paths rewritten to the collected copies;
- `Media/` with de-duplicated local media;
- `manifest.json` with a SHA-256 digest and byte count for every copied file.

The folder is assembled under a temporary name and renamed only after every copy and manifest write succeeds. A failure removes the incomplete temporary folder and leaves the source project unchanged.

## Reviewable AI edits

The deterministic Creator Edit plan reports current and proposed duration, a reason, evidence, confidence, stable operation ID, and source-document revision for every suggested cut. The user can deselect any proposal. Semantic model refinement remains a separate opt-in action. A plan whose source revision no longer matches the project is rejected, and applying an approved plan creates a recovery point before one undoable transaction.

## Audio mastering boundary

All audio controls default to bypass. The live preview mirrors the core high-pass, compression, and makeup stages. Export owns the whole-programme stages that require the assembled timeline:

- conservative stationary room-noise reduction (not marketed as ML voice isolation);
- gated BS.1770-style loudness targets for social, podcast, and broadcast presets, measured after music and output trim;
- an optional stereo-linked transient limiter with immediate attack, smooth release, two-pass loudness correction, and AAC codec headroom;
- optional programme-driven background-music ducking.

This is standards-aligned local normalization, not a certified broadcast meter. Native DSP tests pin opt-out bypass, K-weighted silence gating, post-mix target measurement, output bounds, soundtrack fades, limiter headroom, and sustained-speech ducking.

Native Open/Save panels are always invoked through Electron's parent-window overload. Passing a `BrowserWindow` inside the options object is ignored by Electron and can leave a macOS panel behind the editor while the UI waits on “Starting…”. The dialog wrapper is covered for live, missing, and destroyed parents.

## Privacy masks

Transcript privacy scanning remains local and review-only. A tracked visual mask accepts a confirmed start position, end position, and time range, then creates bounded normal editable mosaic regions along the interpolated path. On macOS, the opt-in Vision helper samples the local video, detects faces and OCR text, classifies sensitive-looking strings, associates candidates over time, and returns proposed keyframes without writing the project. The user can separately ask an already-configured loopback OpenAI-compatible model to relabel bounded OCR candidates as possible person names; non-loopback endpoints are refused, no candidate is selected, and no project write occurs. Only explicitly selected candidates are converted into the same editable annotation contract. Stale scan and classification results are rejected when the project revision changes. OpenScreen does not label detection as complete protection; the user must review the full preview before export.

## Performance and build provenance

The Performance panel reports duration, edit-region count, and caption word count before a project crosses guarded thresholds. A two-hour/3,600-segment regression fixture must complete planning, assessment, and bounded tracking in under 1.5 seconds on shared CI.

`npm run build:custom:manifest` writes a schema-v2 local custom-channel manifest containing app identity, version, commit, dirty state, source digest, lockfile digest, exact Node/npm versions, platform, every staged native payload checksum, packaged ASAR checksum, and every packaged native payload checksum. Verification rejects source, toolchain, identity, payload-inventory, or package drift:

```sh
npm run verify:custom-build -- /absolute/path/to/custom-manifest.json
```

The dedicated `reliability.yml` workflow runs the project-safety and performance gates on macOS, Windows, and Linux and runs native audio DSP tests on each platform. CI is not a substitute for the packaged real-device rows in the manual E2E checklist.

The `custom-local` beta is installed only through `npm run install:custom:mac-beta`. The command requires a clean commit, removes the upstream update metadata, deep-signs the final bytes, saves the prior installed app, swaps through a validated staging path, and rolls back if post-install verification fails.

For a private package intended only for the current Mac, `OPENSCREEN_MACOS_FLOOR=host` makes the native-payload guard compare against that Mac's actual OS version. It is rejected in CI and does not disable payload scanning. The packaged app must also declare the same local minimum with electron-builder's `mac.minimumSystemVersion` override. Public builds must leave this variable unset and retain the repository's macOS 13 floor.
