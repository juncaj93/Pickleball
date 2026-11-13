// Zip 38, Just me: saving the organizer's theme choice on the server, one request at a time, always ending on the LATEST choice.
// Quick taps on the logo would otherwise send several requests that can finish in any order (the server could end up saying the opposite of the
// screen). A failed save is tried again (up to 3 times); if a newer choice arrives meanwhile, the older one is dropped.
export function makeMeSaver(post: (on: boolean) => Promise<unknown>): (on: boolean) => void {
  let busy = false;
  let latest: boolean | null = null;
  const run = async () => {
    if (busy) return;
    busy = true;
    try {
      while (latest !== null) {
        const value = latest;
        latest = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await post(value);
            break;
          } catch {
            if (latest !== null) break; // a newer choice replaces this one
          }
        }
      }
    } finally {
      busy = false;
    }
  };
  return (on) => {
    latest = on;
    void run();
  };
}
