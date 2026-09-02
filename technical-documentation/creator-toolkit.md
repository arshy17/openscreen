# Creator Toolkit

The Creator Toolkit is an optional layer over OpenScreen's ordinary manual editor. Opening it does not modify a document. Every mutating action is an explicit **Apply** or **Create** click, is saved through the normal project store, and is undoable when it changes the current project.

## Product rules

- Existing projects load with every Toolkit feature off.
- Manual editing remains available before and after every Toolkit action.
- The Toolkit never exports, uploads, posts, or publishes.
- Built-in visuals use OpenScreen-owned icons and callouts. External media is never downloaded automatically.
- Clip and social variants are created as separate projects; the source document is not overwritten.
- Project-level Toolkit settings live in the backward-compatible `legacyEditor` envelope, so no schema migration is required.

## Recording preflight

The Rec stage continuously reports the selected capture source, exact microphone plus live meter, exact camera plus live preview, the user's system-audio choice, and the presenter-only windows excluded from macOS capture. A disabled microphone, camera, or system-audio capture is reported as optional/off rather than as a failure. Refreshing the preflight does not start a recording or change any choice.

After a macOS capture stops, OpenScreen compares the requested audio sources with both the helper's delivery timeline and the saved file's decoded audio peaks. A missing or effectively silent enabled track is reported immediately, while the take remains intact for recovery and diagnosis.

## Review-first edit plan

`buildCreatorEditPlan` is a pure document read. It proposes only transcript segments explicitly marked as silence and leaves semantic cuts to a separately selected AI refinement pass. The review lets the user independently choose:

- design/caption preset;
- built-in visuals (off by default);
- each silence cut;
- optional AI semantic refinement (off by default and unavailable without a transcript).

Only the selected portions are applied. The model's Creator Edit tool surface remains bounded to trims and never receives export or publishing tools.

## Templates

OpenScreen ships nine previewable platform templates for Reels, TikTok, Shorts, YouTube, feed posts, tutorials, podcasts, webinars, and professional content. A user can also capture the current editor, caption, and audio-enhancement settings as a named local template. Custom templates are stored in app-local browser storage and are capped at 24 entries.

Applying a template is one undoable document edit. Built-in visuals are a separate, off-by-default choice.

Brand kits are stored locally and can include primary, secondary, and text colors, a font family, local logo path, lower-third, intro, and outro copy. Applying a kit changes the composition palette and captions and adds ordinary editable brand elements in one undoable document edit. Older single-color saved kits remain loadable with safe fallback colors.

## Clips and social variants

Transcript-backed clip suggestions offer up-to-15, 30, or 60-second source windows. Suggestions prefer speech windows with hook language and show their exact source time and transcript preview before creation.

Creating a clip or social variant first creates a new project and then copies the source assets/document state into that project. The new project records `creatorVariant.sourceProjectId` metadata. This is provenance, not live two-way synchronization: later source edits are not silently pushed into a variant.

## Dynamic layout scenes

Camera layout recipes compile into the existing `cameraFullscreenRegions` timeline model:

- **Screen first** clears automatic full-camera regions.
- **Camera hook** uses up to 3.5 seconds of full camera at the start.
- **Camera pulse** uses short camera moments about every 18 seconds.

The resulting regions remain normal editable timeline regions. Camera-dependent recipes are disabled when the document has no webcam track.

## Privacy review

The local transcript scanner flags possible email addresses, phone numbers, and credential phrases. On macOS, an additional opt-in Vision scan samples the selected recording locally, detects face and text candidates, flags email, phone, credential-like, and plate-like strings, and proposes bounded motion tracks. Candidate preview text never leaves the Mac unless the user separately asks the configured loopback OpenAI-compatible model to propose possible person names. Cloud providers and non-loopback endpoints are rejected for that optional step. Nothing is selected or masked automatically.

Only user-confirmed candidates become ordinary editable mosaic annotation keyframes. The user can resize, move, retime, or delete them with existing annotation tools. A scan or name proposal is rejected if the project changes before application, and the UI never claims coverage is complete until the user reviews the whole preview. Local-model name classification only relabels review candidates; it does not select a candidate or count as authoritative protection.

## Local audio enhancement

Voice enhancement is off by default and has three presets: Clarity, Podcast, and Broadcast. Intensity is stored per project. Preview uses a local WebAudio high-pass/compression/makeup chain. Native export applies the corresponding voice chain before mixing background music, so music is not voice-processed. The finished programme is then measured with K-weighting plus absolute and relative gates, normalized to the selected platform target, and peak-limited after music and output trim. Disabled enhancement is an exact native bypass.

The export pass is authoritative because it sees the assembled, trimmed programme; preview uses the same preset parameters on the currently playing source for responsive editing. A stereo-linked transient limiter preserves loudness around short peaks, corrects post-limit loudness in two bounded passes, and reserves codec headroom because AAC can create inter-sample overshoot after PCM processing.

## Reliability additions

- The Recovery tab exposes manual restore points, rolling automatic history, reversible restores, and checksum-verified Collect Media folders.
- Creator Edit saves a pre-apply recovery point and shows evidence plus confidence for every proposed silence cut.
- Audio adds optional room-noise cleanup, measured social/podcast/broadcast loudness targets, a safety limiter, and background-music ducking. Whole-programme stages are authoritative during export.
- Privacy includes manual paths plus review-first local Vision OCR/face candidates and editable tracked mosaic keyframes. It never claims complete protection without user review.
- The Performance tab warns about long duration, dense regions, and oversized caption transcripts without modifying the project.
