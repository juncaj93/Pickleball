# Feature switches

Every switch is a plain on/off value in `wrangler.toml`. Changing one needs a deploy from main (with the usual backup first).
None of them touches money, seats, prices or the database: they only show or hide things. Last updated Sun Nov 1, 2026.

| Switch | Where | Now | What it controls | Private test on your phone | To turn it off |
| --- | --- | --- | --- | --- | --- |
| `GO_LINKS` | `[vars]` | on | Night-before Telegram alerts link to the direct text page `/go/...` | none | `GO_LINKS = "off"` (alerts fall back to the admin link), deploy |
| `TIME_SHIFT` | `[vars]` | on | Moved-game look: tilde times, court borders, "Still in" notice, Confirmed x of y | `?timeshift=on` (also Settings, "Moved-game notice for everyone") | `TIME_SHIFT = "off"`, deploy |
| `MOTION` | `[vars]` | on (since Sun Nov 1, 8:2x PM) | Animations on the PLAYER screens | `?motion=on` once per phone (`?motion=off` ends it) | `MOTION = "off"`, deploy |
| `MOTION_ADMIN` | `[vars]` | on (since Sun Nov 1, about 10:10 PM) | Animations on the ORGANIZER screens (`/admin`). Separate from `MOTION` on purpose, so each side can be switched alone | `/admin?motionadmin=on` once per phone (`?motionadmin=off` ends it) | `MOTION_ADMIN = "off"`, deploy |
| `PAY_ALWAYS` | `[vars]` + Settings | live since Mon Nov 2, 12:01 AM; allowed, OFF for everyone (Settings > Money > "Ask for payment on every game" is off) | Pay, "$14 due" and I paid on Not booked and Waitlist games too (display only: no money rule changes) | `?payalways=on` once per phone (`?payalways=off` ends it) | Settings switch off (no deploy). Kill switch for everyone incl. test links: `PAY_ALWAYS = "off"`, deploy |

## Notes
- Anything other than `"on"` counts as off (for `TIME_SHIFT` and `PAY_ALWAYS`, anything other than `"off"` counts as on: those two are kill switches, and who sees them is a Settings switch).
- The `[env.preview.vars]` block holds the same switches for preview links, which use the fake database. Production only reads `[vars]`.
- The private test links only work while the switch is off for everyone. Once it is on, they change nothing.
- Quiet windows for switching one on: Wed 6:00 AM to 6:00 PM, and Fri through Mon 6:00 PM (see SITE_RULES). Never in the hour after Alex texts the group.
- Quickest rollback for the motion switches: set the value to `"off"` and deploy (no data restore needed). Rollbacks are listed per deploy in `STAGE_NOTES.md`.
- The layout polish (Mon Nov 2: big text, long names, keyboard, shared phone) and the "No Venmo? Pay Alex directly" note have no switch: the layout rules are plain CSS that only act when text is big or a name is long, and the note only shows when the Venmo app fails to open. See STAGE_NOTES, "Layout polish".
