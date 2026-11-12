# Player gallery (Zip 36)

Pictures of every player screen, light and dark, made for designing the Christmas skin (see docs/STAGE_NOTES.md). The script is `e2e/player-gallery.cjs`. It changes no site code, no database, and deploys nothing.

## Run it

```
node e2e/player-gallery.cjs
```

About 15 minutes. It writes `docs/player-gallery/` (PNG pictures plus `INDEX.md`, which says what each picture shows, which fake player and clock it uses, and which component draws it). That folder is in `.gitignore` on purpose: the pictures are large and never go on `main`.

Useful switches (all optional):

| Setting | What it does |
| --- | --- |
| `PG_OUT=/some/folder` | write somewhere else |
| `PG_CHAPTER=taps` | run one chapter only (`readonly`, `taps`, `cashout`, `notes`, `extended`, `ladder`, `identity`, `largetext`, `notsetup`; `a\|b` for several) |
| `PG_ONLY=toast` | only pictures whose section or name matches |
| `PG_SCHEMES=light` | only light (faster, for trying a change) |
| `E2E_PORT=5436` | the port of its own copy of the site |

## How it works, in plain words

- It builds the small fake preview group on this computer (`scripts/load-small-local.ts`: the ten fixed names from docs/PREVIEW_FAKE_DB.md, fake phone numbers, the fake PIN read from that same file at run time and never written down), as of **Thu Nov 12, 2026, 3:00 PM Eastern**. Every Settings switch that is on on live is on (the preview's list), plus Extended time. Calm mode is off, so every alert shows, as on live.
- It starts its own copy of the site (vite, a throwaway sqlite file in `.data/`, its own port) and a pinned clock.
- Each chapter starts from a fresh copy of that world, so a tap in one chapter (paying, dropping out, a cash out) never changes another chapter's pictures.
- Each picture is one phone (420 x 912 CSS px, 3x, iPhone Air) taken in light, then the same page flipped to dark. Pop-ups that go by themselves (toasts, the Undo banner) are held still by stopping the page's clock while they are photographed.
- A card, alert or sheet shorter than the screen also gets a tight crop; pages that scroll also get a whole-page picture.
- If the `sharp` package is around (it comes with wrangler) the PNGs are saved with maximum compression.

## Where the pictures live

On a separate branch, `gallery-pictures`, of the repo. It is never merged, has no pull request, and is not deployed. Re-run the script and push `docs/player-gallery/` there (force-add, the folder is ignored on every other branch) when the screens change.
