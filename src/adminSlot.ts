// Zip 48: an empty marker. src/main.tsx imports it on the line where the organizer screens used to be imported, so that position in the
// style order is written down in the code. The site never uses it. tests/zip48-split.test.ts builds a copy of the site whose style is "one file, as before"
// (the old layout) in which this marker stands for src/pages/AdminEntry.tsx (vite.config.ts, PB_ONE_FILE), and checks the split site's style order
// on /admin against it.
export {};
