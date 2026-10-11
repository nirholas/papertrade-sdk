(function () {
  var root = document.documentElement;
  var themeBtn = document.getElementById('theme');
  function current() {
    var t = root.getAttribute('data-theme');
    if (t) return t;
    return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  if (themeBtn) {
    themeBtn.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', next);
      try { localStorage.setItem('pt-theme', next); } catch (e) {}
    });
  }

  var menu = document.getElementById('menu');
  var side = document.getElementById('side');
  if (menu && side) {
    menu.addEventListener('click', function () {
      var open = side.getAttribute('data-open') === 'true';
      side.setAttribute('data-open', String(!open));
      menu.setAttribute('aria-expanded', String(!open));
    });
  }

  document.querySelectorAll('pre').forEach(function (pre) {
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'copy';
    btn.textContent = 'Copy';
    btn.setAttribute('aria-label', 'Copy code');
    btn.addEventListener('click', function () {
      var code = pre.querySelector('code');
      navigator.clipboard.writeText((code || pre).textContent).then(
        function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy'; }, 1500); },
        function () { btn.textContent = 'Press Ctrl+C'; }
      );
    });
    pre.appendChild(btn);
  });

  var input = document.getElementById('q');
  var results = document.getElementById('results');
  var index = null;
  var loading = null;
  function load() {
    if (!loading) {
      loading = fetch('/docs/search-index.json').then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      }).then(function (j) { index = j; });
    }
    return loading;
  }
  function esc(s) { return s.replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function search(q) {
    var terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    var hits = [];
    index.forEach(function (d) {
      var score = 0;
      var hay = d.text.toLowerCase();
      var title = d.title.toLowerCase();
      for (var i = 0; i < terms.length; i++) {
        var t = terms[i];
        var inTitle = title.indexOf(t) >= 0;
        var pos = hay.indexOf(t);
        if (!inTitle && pos < 0) return;
        score += (inTitle ? 10 : 0) + (d.heading ? 0 : 0) + (pos >= 0 ? 1 : 0);
      }
      var p = hay.indexOf(terms[0]);
      var snip = p >= 0 ? d.text.slice(Math.max(0, p - 40), p + 110) : d.text.slice(0, 120);
      hits.push({ d: d, score: score, snip: snip });
    });
    hits.sort(function (a, b) { return b.score - a.score; });
    return hits.slice(0, 8);
  }
  function render(q) {
    if (!q.trim()) { results.hidden = true; results.innerHTML = ''; return; }
    results.hidden = false;
    var hits = search(q);
    if (!hits.length) {
      results.innerHTML = '<p class="empty">No results for "' + esc(q) + '". Try a shorter term such as "bust", "mcp" or "session".</p>';
      return;
    }
    results.innerHTML = hits.map(function (h) {
      return '<a href="' + esc(h.d.url) + '"><strong>' + esc(h.d.title) + '</strong><span>' + esc(h.snip) + '</span></a>';
    }).join('');
  }
  if (input && results) {
    input.addEventListener('input', function () {
      var q = input.value;
      load().then(function () { render(q); }, function () {
        results.hidden = false;
        results.innerHTML = '<p class="empty">Search is unavailable right now. Reload the page to try again.</p>';
        loading = null;
      });
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && document.activeElement !== input && !/INPUT|TEXTAREA/.test(document.activeElement.tagName)) {
        e.preventDefault(); input.focus();
      }
      if (e.key === 'Escape') { input.value = ''; results.hidden = true; input.blur(); }
    });
  }

  var toc = document.querySelectorAll('.toc a');
  if (toc.length && 'IntersectionObserver' in window) {
    var map = {};
    toc.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) {
          toc.forEach(function (a) { a.removeAttribute('aria-current'); });
          var a = map[en.target.id];
          if (a) a.setAttribute('aria-current', 'true');
        }
      });
    }, { rootMargin: '0px 0px -75% 0px' });
    document.querySelectorAll('main h2[id], main h3[id]').forEach(function (h) { io.observe(h); });
  }
})();
