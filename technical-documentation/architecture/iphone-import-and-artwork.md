# iPhone import and Artwork Studio

OpenScreen's macOS private beta accepts videos and still images from Files or from the system
Photos picker. Photos access is selection-scoped: the Swift helper receives only the items the
user chooses and copies them to a temporary transfer directory. The main process then copies each
item into the current project's `Media/Imports` directory, fingerprints it, records source
provenance, and removes only that temporary Photos transfer. The source in Photos, iCloud Drive,
Finder, or AirDrop is never modified.

## Media normalization

`projectMediaImport.ts` probes every video before it joins the project. Its persisted metadata
includes codec, rotation, dimensions, nominal and average frame rate, variable-frame-rate status,
colour primaries/transfer/matrix, HDR and Dolby Vision flags, audio codecs and track count,
duration, and byte size. HEVC, ProRes, HDR, variable-frame-rate, 4K, and high-frame-rate media get
a hardware H.264/Rec.709 editing proxy on macOS. Export continues to reference the managed
original. HDR/Dolby Vision is deliberately edited through a tone-mapped SDR proxy and exported as
Rec.709 until a separately tested HDR output pipeline exists.

Imports are multi-select jobs. Progress and per-item errors cross the native bridge, cancellation
uses an `AbortController`, and completed items remain available when another item fails. Imports
warn before exhausting available project storage. A copied original's SHA-256 becomes its stable
identity for duplicate detection, Collect Media, recovery, and relinking.

## Artwork data and rendering

Schema v8 adds optional `artworkAssets` and `artworkDesigns`; v7 projects migrate to empty
collections. Designs are independent of the timeline and hold typed text, image, shape, and
bundled-icon layers, a versioned platform preset, optional source-frame and brand-kit references,
and bounded revision history. A design edit does not mutate video.

Artwork Studio can capture the exact playhead frame or extract evenly spaced candidates. A signed
Swift helper uses Apple Vision locally to score sharpness, exposure, face visibility, and free text
space without identifying people. The same helper can create a local person-segmentation cutout;
the result becomes another managed artwork asset and stays editable. Local Qwen receives a bounded
transcript summary and returns three schema-validated headline/layout proposals. No frame,
transcript, prompt, or artwork is sent to a network provider.

The renderer uses an exact-size canvas for PNG or JPEG. It applies crop, contain/cover/fill,
opacity, blur, rotation, text wrapping, stroke, shadow, vector shapes, bundled icons, safe areas,
and platform resizing deterministically. Export validates the encoded dimensions again in the
main process before writing through a user-selected destination. Platform packs are directories of
individually validated files.

The optional opening-card command encodes the selected design as a short H.264/Rec.709 clip with a
silent AAC track. OpenScreen creates a separate linked project, copies that clip into the new
project, prepends it, and reprojects original timeline modifiers. The source project is never
changed.

## Boundaries

- macOS 13 or newer only for Photos selection and the installed private-beta helpers.
- AirDrop, Finder, and iCloud items use the Files import. No iOS companion or Wi-Fi server exists.
- HEIC, JPEG, and PNG are artwork sources. Live Photo motion and Cinematic depth/focus editing are
  not interpreted; an exported movie can still be imported normally.
- Artwork automation is optional and review-first. OpenScreen does not upload, publish, or sign in
  to a social platform.
