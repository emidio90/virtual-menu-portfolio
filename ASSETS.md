# Asset provenance

## Food illustration fixtures

- `src/assets/pasta.svg` / `public/fixtures/pasta.svg`: lemon-and-herb pasta illustration
- `src/assets/bowl.svg` / `public/fixtures/bowl.svg`: colorful harvest bowl illustration
- `src/assets/salmon.svg` / `public/fixtures/salmon.svg`: citrus salmon illustration

These self-contained SVGs were authored as code during the AI-assisted portfolio refactor. They contain no externally fetched image, photograph, texture or font. The `public` copies support landing-page images; the `src` copies support local demo background-color variants. They illustrate the UI and do not prove Gemini output quality, depict a real restaurant's dish, or exactly match arbitrary text a visitor enters.

The demo can rasterize them to a requested PNG export size. This does not add photographic detail. The aesthetic controls recolor a fixture background; they do not run an image model.

## Icons and fonts

Interface icons come from the installed `lucide-react` package, under its applicable ISC license. Text uses system font fallbacks; no external webfont request is made. No Unsplash stock photos from the source prototype were carried into this edition.

## Rights

No public open-source license is granted by this file. The portfolio remains UNLICENSED pending the owner's decision. Third-party dependency licenses and notices continue to apply. Review provenance and rights before publication.
