# Asset provenance

## Pre-generated AI food photography

The nine bundled food images were created with ChatGPT image generation on 2026-10-12 for this portfolio. They are photorealistic AI-generated samples, not photographs of real restaurant dishes and not output from the application's Gemini integration. No stock photography or externally hosted food images are used.

| Subject | Rustic / Dark | Bright / Modern | Social Media |
| --- | --- | --- | --- |
| Lemon & herb pasta | `public/fixtures/pasta-rustic.webp` | `public/fixtures/pasta-modern.webp` | `public/fixtures/pasta-social.webp` |
| Roasted harvest bowl | `public/fixtures/bowl-rustic.webp` | `public/fixtures/bowl-modern.webp` | `public/fixtures/bowl-social.webp` |
| Citrus-glazed salmon | `public/fixtures/salmon-rustic.webp` | `public/fixtures/salmon-modern.webp` | `public/fixtures/salmon-social.webp` |

Each subject/style combination is a distinct generated image. The original RGB PNGs were 1254 × 1254 pixels. All nine were visually inspected, resized to 1024 × 1024 using Lanczos resampling, and compressed as WebP at quality 84–86. Each web asset is under 250 kB; the complete set is 1,982,688 bytes. No additional generative edits or composites were applied. Original PNGs are preserved separately from the deployment source to avoid shipping approximately 25 MB of unnecessary image data.

[PHOTO_ASSETS.json](docs/PHOTO_ASSETS.json) records the exact original and bundled dimensions, byte counts and SHA-256 hashes. [PHOTO_PROMPTS.json](docs/PHOTO_PROMPTS.json) records the generation prompt for every image. The earlier code-authored SVG food illustrations have been replaced.

## Runtime behavior and export limits

The demo loads existing local images. Changing aesthetic selects the corresponding image; it does not invoke an image model or incur provider charges. The landing-page photographs and style thumbnails use the same local collection.

Only the three exact synthetic menu examples are identified as the matching sample dishes. Any custom menu entry, including an altered description under an existing sample name, is visibly labeled a representative sample. Its accessible image description and preview explain which sample is shown. Unknown dishes are not claimed to have been generated or accurately depicted.

The 1K PNG export is 1024 × 1024. The 2K and 4K exports are resampled to 2048 × 2048 and 4096 × 4096 respectively. They are explicitly labeled upscaled, including in download filenames, and add no native detail. These images must not be used to infer actual ingredients, allergens, nutritional content or restaurant product accuracy.

## Icons and fonts

Interface icons come from the installed `lucide-react` package, under its applicable ISC license. Text uses system font fallbacks; no external webfont request is made. No Unsplash stock photos from the source prototype were carried into this edition.

## Rights

No public open-source license is granted by this file. The portfolio remains UNLICENSED pending the owner's decision. Third-party dependency licenses and notices continue to apply. Review AI-generated asset suitability and applicable rights before external commercial reuse.
