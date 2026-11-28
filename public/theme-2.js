// Runs before the page draws so dark or light mode never flashes.
// Settings saves "light", "dark", or nothing (follow the phone).
(function () {
  try {
    var t = localStorage.getItem('pb_theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {
    /* storage blocked: follow the phone */
  }
})();

// Zip 102: the Christmas skin from the first paint. Inside the window (the Friday after US Thanksgiving through Dec 31, Eastern), on a player
// Home address only (never /admin or any other page), this phone's last answer decides how the page starts: Everyone = the Christmas logo at
// once (it is the button), the theme ON only if this phone tapped it on; Just me = its saved choice. data-skin-early tells the skin store
// (src/skin/store.ts) the mode; data-skin="christmas" is set only when the theme is ON. The Christmas logo is fetched now so it is ready when
// the header draws. The same rule as earlySkin() in shared/christmasSkin.ts (tests/zip102.test.ts runs both). Storage blocked, an old phone,
// anything odd: nothing happens, exactly as before. (A new file name, theme-2.js: phones keep the old theme.js for a day, public/_headers.)
(function () {
  try {
    if (!/^\/(g\/[A-Za-z0-9_-]+\/?)?$/.test(location.pathname)) return;
    var mode = localStorage.getItem('pb_xmas_mode');
    var start = mode === 'all' ? 'all' : mode === 'me-on' || mode === 'me-off' ? 'me' : null;
    if (!start) return;
    var on = start === 'all' ? localStorage.getItem('pb_xmas_theme') === 'on' : mode === 'me-on';
    var parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Detroit', year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(new Date());
    var y = 0;
    var mo = 0;
    var d = 0;
    for (var i = 0; i < parts.length; i++) {
      if (parts[i].type === 'year') y = Number(parts[i].value);
      if (parts[i].type === 'month') mo = Number(parts[i].value);
      if (parts[i].type === 'day') d = Number(parts[i].value);
    }
    // The fourth Thursday of November, then the Friday after it.
    var firstWeekday = new Date(Date.UTC(y, 10, 1)).getUTCDay();
    var friday = 1 + ((4 - firstWeekday + 7) % 7) + 21 + 1;
    if (!(mo === 12 || (mo === 11 && d >= friday))) return;
    var root = document.documentElement;
    root.setAttribute('data-skin-early', start + (on ? '-on' : '-off'));
    if (on) root.setAttribute('data-skin', 'christmas');
    if (start === 'all') {
      var link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'image';
      link.href = '/logo-xmas.png';
      link.setAttribute('fetchpriority', 'high');
      document.head.appendChild(link);
    }
  } catch (e) {
    /* storage blocked or an old phone: draw plain, as before */
  }
})();
