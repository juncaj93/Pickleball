// Zip 48: the one door into the organizer file (the "admin chunk", fetched by src/adminChunk.ts). Everything the organizer screens use and
// the player screens do not comes in through here.
export { AdminApp } from './Admin';
// LAST, after every organizer style above: the late player style files again (see the file for why). Keep it the last line.
import '../admin-late.css';
