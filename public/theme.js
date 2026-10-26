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
