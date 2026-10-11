(function () {
  try {
    var p = new URLSearchParams(location.search);
    if (p.get('embed') === '1') document.documentElement.setAttribute('data-embed', '1');
    var t = localStorage.getItem('pt-theme');
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) {}
})();
