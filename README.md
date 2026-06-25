# Swipely

A browser-based carousel maker for LinkedIn & Instagram creators. Type your text,
pick a theme, download slides as images. Runs **100% client-side** — no backend,
no per-user cost — so it deploys to any free static host.

## Why this exists (the business)

- **Product:** free carousel/quote-graphic maker (capped at 2 carousels/day),
  paid "Pro" tier ($6/mo) goes unlimited, removes the watermark, and unlocks the
  premium gradient themes.
- **Growth loop (the whole point):** every free export carries a small
  *"Made with Swipely"* mark. Creators post those graphics publicly → their
  audience sees the tool → some come make their own. Distribution is built into
  the product, so it grows without ad spend or manual outreach.
- **Cost to run:** ~$0/month. Rendering happens in the user's browser; static
  files host free on Netlify / Vercel / Cloudflare Pages / GitHub Pages.

## Files

| File | Purpose |
|------|---------|
| `index.html` | Marketing landing page (SEO, pricing, CTA). The discovery front door. |
| `app.html` | The editor UI. |
| `app.js` | Editor logic + the canvas renderer that paints/export slides. |
| `templates.js` | Theme definitions. Add a theme = add one object here. |
| `styles.css` | Editor styles. |

## Run locally

It's static files, but `file://` blocks some browser APIs, so serve it over HTTP:

```bash
cd carousel-maker
python -m http.server 8000
# open http://localhost:8000/         (landing page)
# open http://localhost:8000/app.html (editor)
```

## Deploy (free)

Any static host works. Easiest:

1. Push this folder to a GitHub repo.
2. Connect it to **Netlify** or **Vercel** (free tier) — no build command, publish
   directory is the folder itself.
3. Point a domain at it. Done.

## Roadmap (in priority order)

1. **Stripe Pro tier ($6/mo)** — flip `state.isPro` after checkout to drop the
   watermark, unlock `pro: true` themes, and lift the daily cap. Use Stripe
   Payment Links + a tiny serverless function (or Stripe + Cloudflare Workers) to
   stay near $0. Note: the free daily cap (`FREE_DAILY_EXPORTS` in `app.js`) is
   currently a *soft* client-side limit — resettable by clearing the browser.
   Hard enforcement needs the same backend, so it's bundled with this step.
2. **More themes** — the watermark loop only works if free output looks great, so
   keep free themes strong.
3. **Export sizes** — square 1:1 is done (Pro). Still to add: 16:9 widescreen.
   Custom brand colors are also done (Pro).
4. **Font choices** — optional Google Font loading for nicer type.
5. **Blog / SEO pages** under `/` targeting "linkedin carousel template",
   "instagram carousel maker", etc. Secondary, organic discovery channel.

## Rebranding

Change the `BRAND` constant at the top of `app.js` and the logo text in the two
HTML files. The watermark, upsell copy and export filenames all follow it.

> Name note: "Swipely" is a working title — check trademark/domain availability
> before you commit to it.
