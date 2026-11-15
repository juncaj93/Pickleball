# Zip 47 audit probes

Probe tests written for docs/audits/AUDIT_C_2026-11.md. They are kept here, outside `tests/`, so the normal test run and typecheck skip them
(7 guest probes fail on purpose: they assert the right answer and show MUST-FIX M-1 and FIX LATER F-2, F-4, F-6).

To run one area: copy its folder back, for example `cp -r docs/audits/zip47-probes/guest tests/_probe47/guest`, then
`npx vitest run tests/_probe47/guest`. Delete `tests/_probe47` afterwards. Fake data only; no PIN or secret is in these files.
