# spring

A Japanese garden diorama in the browser: a stream through a small garden with a teahouse, an arched bridge,
stone lanterns and a shrine, in a Tiny Glade-style miniature look with Ghost of Tsushima-inspired seasons.
Built with three.js, no build step.

- **Spring** (default): cherry blossoms and milky turquoise hot-spring water.
- **Autumn**: red maples, silver pampas grass and a clear jade stream.
- Four times of day (afternoon, golden hour, blue hour, night), wildlife, wind and falling petals or leaves.

## Run locally

Browsers won't load the JavaScript modules from `file://`, so serve the folder:

```bash
python serve.py
```

Then open http://localhost:5183. Any static file server works.

## Controls

Drag to orbit · right-drag to pan · scroll to zoom · double-click to look closer · WASD / arrows to move ·
Q/E to turn · 1–4 for the time of day · H hides the bar.

## Deploy

It's a static site, ready for Vercel (`npx vercel`), GitHub Pages or any static host.
`vercel.json` sets caching and `.vercelignore` leaves out the dev-only files.

Textures are CC0 from [Poly Haven](https://polyhaven.com).
