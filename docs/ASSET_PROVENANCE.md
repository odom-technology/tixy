# Asset provenance and notices

The repository's code license does not override third-party licenses or grant
rights to ODOM Tech names, logos, trademarks, or other reserved brand assets.
Do not assume every file under `public/` is licensed as application code.

## Fonts

Gabarito and Big Shoulders are used by the application and brand tooling.
Their bundled font files retain their SIL Open Font License 1.1 notices in
`src/app/fonts/`, `public/fonts/card/`, and `public/fonts/brand/`.
Preserve the corresponding OFL notices when redistributing those fonts.
The variable fonts in `public/fonts/brand/` are inputs for the wordmark and
achievement-sheet tools; their bytes are unchanged from the original inputs.

## Chess engine

The `stockfish` npm dependency provides the chess engine under its own GPL
license. `scripts/copy-stockfish.mjs` copies its license notice, when present,
alongside the engine files into the standalone application build. Consult the
installed package's license and source information when distributing engine
binaries. Its license is separate from the application code license.

## Audio

The original project documentation identifies the eight shared cues in
`public/audio/arcade/` as generated with ElevenLabs
`eleven_text_to_sound_v2` on July 30, 2026. The larger bank under
`public/audio/sfx/` is managed by `scripts/sfx/catalog.ts` and the ElevenLabs
generation tooling in `scripts/sfx/`. Procedural sound effects are implemented
in application code.

Source files record prompts and processing, but do not establish the generation
account's subscription terms or confirm a separate redistribution license for
the resulting recordings. No blanket application-code license is asserted for
these sampled audio files. Contact the maintainers before redistributing them
as an independent asset collection.

## Artwork and branding

The repository includes application illustrations, cosmetic artwork, game
previews, Tixy branding, and the ODOM Tech admin-avatar mark. Some artwork is
generated or produced by project tooling. The source snapshot alone does not
prove a uniform license for every image. ODOM Tech brand rights are reserved;
permission to contribute code does not grant permission to claim affiliation
or use its marks to brand another service.

For new assets, record their author or generator, source, redistribution
license, and required attribution in the contribution. Keep personal data,
credentials, and production screenshots out of asset files and metadata.
