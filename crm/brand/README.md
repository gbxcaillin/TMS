Put your logo files here and name them in `brand.json` under `logo`:

- `mark`: a square image (PNG or SVG, 512 px or more) that reads on a dark background. It becomes the app icon, the
  home-screen icon and the mark at the top of the left bar.
- `light`: your logo for white backgrounds. It is used on the sign-in page, invoices and PDF documents.

Then run `node tools/rebrand.js`. Leave both empty to get a monogram in your brand colours instead.
