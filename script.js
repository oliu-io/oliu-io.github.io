/* ============================================
   Ollie Liu — Personal Website
   Fills the page from content/*.md.

   The page layout lives in index.html: every
   <section data-src="…" data-type="…"> is filled
   by the renderer of that type (see RENDERERS).
   ============================================ */

(function () {
  "use strict";

  /* ===========================================
     PARSERS
     =========================================== */

  /**
   * Parse an item-list markdown file into
   * [{ title, group, fields: {key: value}, body }].
   *
   * Format per item:
   *   ## Item title
   *   - key: value
   *
   *   Optional free-text body (markdown).
   *
   * "# Group name" lines set `group` for the items that follow.
   * Anything before the first heading (e.g. HTML comments) is ignored.
   */
  function parseItems(text) {
    var items = [];
    var group = "";
    var current = null;
    var lines = text.split(/\r?\n/);

    function push() {
      if (!current) return;
      current.body = current.bodyLines.join("\n").trim();
      delete current.bodyLines;
      delete current.inBody;
      items.push(current);
      current = null;
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^##\s+/.test(line)) {
        push();
        current = {
          title: line.replace(/^##\s+/, "").trim(),
          group: group,
          fields: {},
          bodyLines: [],
          inBody: false
        };
      } else if (/^#\s+/.test(line)) {
        push();
        group = line.replace(/^#\s+/, "").trim();
      } else if (!current) {
        continue; // preamble / comments before first item
      } else if (!current.inBody && /^-\s+\w[\w ]*:\s/.test(line)) {
        var kv = splitFirst(line.replace(/^-\s+/, ""), ": ");
        current.fields[kv[0].trim().toLowerCase()] = parseValue(kv[1]);
      } else if (!current.inBody && /^\s*$/.test(line)) {
        continue; // blank line between fields and body
      } else {
        current.inBody = true;
        current.bodyLines.push(line);
      }
    }
    push();
    return items;
  }

  /**
   * Parse front matter (supports one level of `- key: value` lists,
   * e.g. `links`). Returns { meta: {...}, body: string }.
   */
  function parseFrontMatter(text) {
    var match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)/);
    if (!match) return { meta: {}, body: text };

    var meta = {};
    var lines = match[1].split(/\r?\n/);
    var currentKey = null;
    var listItem = null;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^\s*#/.test(line) || /^\s*$/.test(line)) continue;

      if (/^\w/.test(line) && line.indexOf(": ") !== -1) {
        var kv = splitFirst(line, ": ");
        currentKey = kv[0].trim();
        meta[currentKey] = parseValue(kv[1]);
      } else if (/^\w/.test(line) && line.trim().endsWith(":")) {
        currentKey = line.trim().slice(0, -1);
        meta[currentKey] = [];
      } else if (/^\s+- /.test(line) && Array.isArray(meta[currentKey])) {
        listItem = {};
        meta[currentKey].push(listItem);
        var rest = splitFirst(line.replace(/^\s+- /, ""), ": ");
        if (rest[0]) listItem[rest[0].trim()] = parseValue(rest[1]);
      } else if (/^\s+\w/.test(line) && listItem) {
        var kv2 = splitFirst(line.trim(), ": ");
        if (kv2[0]) listItem[kv2[0].trim()] = parseValue(kv2[1]);
      }
    }
    return { meta: meta, body: match[2].trim() };
  }

  function splitFirst(str, sep) {
    var idx = str.indexOf(sep);
    if (idx === -1) return [str, ""];
    return [str.slice(0, idx), str.slice(idx + sep.length)];
  }

  /** Booleans and quote-stripping for field values */
  function parseValue(raw) {
    if (!raw) return "";
    raw = raw.trim();
    if (raw === "true") return true;
    if (raw === "false") return false;
    if ((raw.startsWith('"') && raw.endsWith('"')) ||
        (raw.startsWith("'") && raw.endsWith("'"))) {
      return raw.slice(1, -1);
    }
    return raw;
  }

  function isExternal(url) {
    return /^https?:\/\//.test(url) || /\.pdf$/i.test(url);
  }

  function linkAttrs(url) {
    return 'href="' + escapeHtml(url) + '"' +
      (isExternal(url) ? ' target="_blank" rel="noopener"' : "");
  }

  /** Inline markdown: strips comments, **bold**, [text](url) */
  function mdInline(text) {
    if (!text) return "";
    return String(text)
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, label, url) {
        return "<a " + linkAttrs(url) + ">" + label + "</a>";
      })
      .trim();
  }

  /** Block markdown: paragraphs split on blank lines */
  function mdParagraphs(text) {
    return mdInline(text)
      .split(/\n\s*\n+/)
      .map(function (p) { return p.trim(); })
      .filter(Boolean)
      .map(function (p) { return "<p>" + p + "</p>"; })
      .join("\n");
  }

  /** Extract [label](url) pairs from a `links:` field */
  function parseLinks(raw) {
    var links = [];
    var re = /\[([^\]]+)\]\(([^)\s]+)\)/g;
    var m;
    while ((m = re.exec(raw || "")) !== null) {
      links.push({ label: m[1], url: m[2] });
    }
    return links;
  }

  function escapeHtml(str) {
    if (str === undefined || str === null) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  var ARROW = '<span class="arrow" aria-hidden="true">&#8599;</span>';

  /* ===========================================
     RENDERERS
     Each takes the raw file text and the section
     element's data-* options, and returns HTML.
     =========================================== */

  function renderHero(text) {
    var meta = parseFrontMatter(text).meta;
    var h = '<div class="label hero-photo">';
    if (meta.photo) {
      h += '<img src="' + escapeHtml(meta.photo) + '" alt="' +
        escapeHtml(meta.name || "") + '" width="96" height="96">';
    }
    h += '</div><div class="hero-main">';
    h += '<div class="hero-id"><h1 class="hero-name">' + escapeHtml(meta.name || "") + "</h1>";
    if (meta.aka) h += '<span class="hero-aka">' + mdInline(meta.aka) + "</span>";
    h += "</div>";
    if (meta.headline) h += '<p class="hero-headline">' + mdInline(meta.headline) + "</p>";
    var links = (meta.links || []).map(function (l) {
      return "<li><a " + linkAttrs(l.url) + ">" + escapeHtml(l.label) +
        (isExternal(l.url) ? ARROW : "") + "</a></li>";
    });
    if (meta.email) links.push('<li class="hero-email">' + escapeHtml(meta.email) + "</li>");
    if (links.length) h += '<ul class="hero-links">' + links.join("") + "</ul>";
    return h + "</div>";
  }

  /** About: the body of hero.md (everything after the front matter) */
  function renderAbout(text) {
    return '<div class="prose">' + mdParagraphs(parseFrontMatter(text).body) + "</div>";
  }

  /** News: one "## date" heading per item, text below it */
  function renderNews(text, opts) {
    var items = parseItems(text);
    var limit = parseInt(opts.limit, 10) || items.length;
    var html = '<ul class="news-list">' + items.map(function (item, i) {
      return '<li class="news-item' + (i >= limit ? " is-hidden" : "") + '">' +
        '<span class="news-date">' + escapeHtml(item.title) + "</span>" +
        '<span class="news-text prose">' + mdInline(item.body) + "</span></li>";
    }).join("") + "</ul>";
    if (items.length > limit) {
      html += '<button class="text-btn news-more" type="button">Show all ' +
        items.length + " &darr;</button>";
    }
    return html;
  }

  function bindNews(el) {
    var btn = el.querySelector(".news-more");
    if (!btn) return;
    btn.addEventListener("click", function () {
      el.querySelectorAll(".news-item.is-hidden").forEach(function (li) {
        li.classList.remove("is-hidden");
      });
      btn.remove();
    });
  }

  /** Year for a paper: explicit field → venue string → arXiv id */
  function paperYear(fields) {
    if (fields.year) return String(fields.year);
    var m = /(19|20)\d{2}/.exec(fields.venue || "");
    if (m) return m[0];
    var links = parseLinks(fields.links);
    for (var i = 0; i < links.length; i++) {
      var am = /arxiv\.org\/abs\/(\d{2})/.exec(links[i].url);
      if (am) return "20" + am[1];
    }
    return "";
  }

  /** Papers: newest first; "Selected" shows `featured: true` items */
  function renderPapers(text) {
    var papers = parseItems(text).map(function (item, i) {
      return { item: item, year: paperYear(item.fields), order: i };
    });
    // Newest year first; file order within a year
    papers.sort(function (a, b) {
      return (b.year || "0").localeCompare(a.year || "0") || a.order - b.order;
    });

    var featured = papers.filter(function (p) { return p.item.fields.featured === true; });
    var hasSelected = featured.length > 0;

    var bar = '<div class="paper-bar" role="group" aria-label="Filter papers">';
    if (hasSelected) {
      bar += '<button class="text-btn paper-tab" type="button" data-filter="selected" aria-pressed="true">' +
        'Selected<span class="count">' + featured.length + "</span></button>" +
        '<button class="text-btn paper-tab" type="button" data-filter="all" aria-pressed="false">' +
        'All<span class="count">' + papers.length + "</span></button>";
    }
    bar += '<span class="paper-legend">* equal contribution</span></div>';

    var list = papers.map(function (p) {
      var f = p.item.fields;
      var links = parseLinks(f.links);
      var isPreprint = /preprint/i.test(p.item.group) && !f.venue;
      var venue = f.venue || (isPreprint ? "Preprint" : "");
      var title = escapeHtml(p.item.title);
      if (links.length) title = "<a " + linkAttrs(links[0].url) + ">" + title + "</a>";

      var html = '<li class="paper" data-featured="' + (f.featured === true) +
        '" data-year="' + escapeHtml(p.year) + '">' +
        '<span class="paper-year"></span><div>' +
        '<p class="paper-title">' + title + "</p>";
      if (f.authors) html += '<p class="paper-authors">' + mdInline(f.authors) + "</p>";
      html += '<p class="paper-meta">';
      if (venue) html += "<span>" + escapeHtml(venue) + "</span>";
      if (f.note) html += '<span class="paper-note">' + escapeHtml(f.note) + "</span>";
      if (links.length) {
        html += '<span class="paper-links">' + links.map(function (l) {
          return "<a " + linkAttrs(l.url) + ">" + escapeHtml(l.label) + "</a>";
        }).join("") + "</span>";
      }
      return html + "</p></div></li>";
    }).join("");

    return bar + '<ol class="paper-list">' + list + "</ol>";
  }

  function bindPapers(el) {
    var tabs = el.querySelectorAll(".paper-tab");
    var items = el.querySelectorAll(".paper");

    function apply(filter) {
      var lastYear = null;
      items.forEach(function (li) {
        var show = filter === "all" || li.getAttribute("data-featured") === "true";
        var year = li.getAttribute("data-year");
        li.classList.toggle("is-hidden", !show);
        // Print the year only on the first visible paper of each year
        li.querySelector(".paper-year").textContent = show && year !== lastYear ? year : "";
        if (show) lastYear = year;
      });
      tabs.forEach(function (t) {
        t.setAttribute("aria-pressed", String(t.getAttribute("data-filter") === filter));
      });
    }

    tabs.forEach(function (t) {
      t.addEventListener("click", function () { apply(t.getAttribute("data-filter")); });
    });
    apply(tabs.length ? "selected" : "all");
  }

  /**
   * Generic list for any item-list file (experience, education, …):
   *   date → left column; role/degree → after the title;
   *   other fields → a faint line; body → paragraph.
   */
  function renderList(text) {
    return '<ul class="entry-list">' + parseItems(text).map(function (item) {
      var f = item.fields;
      var sub = f.role || f.degree || "";
      var meta = Object.keys(f).filter(function (k) {
        return ["date", "role", "degree"].indexOf(k) === -1 && f[k] !== true && f[k] !== false;
      }).map(function (k) { return mdInline(f[k]); });

      var html = '<li class="entry"><span class="entry-date">' + escapeHtml(f.date || "") + "</span><div>" +
        '<p><span class="entry-title">' + mdInline(item.title) + "</span>" +
        (sub ? '<span class="entry-sub"> — ' + mdInline(sub) + "</span>" : "") + "</p>";
      if (meta.length) html += '<p class="entry-meta">' + meta.join(" · ") + "</p>";
      if (item.body) html += '<p class="entry-body prose">' + mdInline(item.body) + "</p>";
      return html + "</div></li>";
    }).join("") + "</ul>";
  }

  var RENDERERS = {
    about:  { render: renderAbout },
    news:   { render: renderNews, bind: bindNews },
    papers: { render: renderPapers, bind: bindPapers },
    list:   { render: renderList }
  };

  /* ===========================================
     THEME
     =========================================== */

  function initTheme() {
    var toggle = document.getElementById("theme-toggle");
    if (!toggle) return;
    var media = window.matchMedia("(prefers-color-scheme: dark)");

    function current() {
      return document.documentElement.getAttribute("data-theme") ||
        (media.matches ? "dark" : "light");
    }

    toggle.addEventListener("click", function () {
      var next = current() === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("theme", next); } catch (e) {}
    });
  }

  /* ===========================================
     INITIALIZATION
     =========================================== */

  var cache = {};
  function load(file) {
    if (!cache[file]) {
      cache[file] = fetch("content/" + file).then(function (res) {
        if (!res.ok) throw new Error(file + " → HTTP " + res.status);
        return res.text();
      });
    }
    return cache[file];
  }

  initTheme();
  document.getElementById("year").textContent = new Date().getFullYear();

  var hero = document.querySelector("[data-hero]");
  if (hero) {
    load(hero.getAttribute("data-hero"))
      .then(function (text) { hero.innerHTML = renderHero(text); })
      .catch(function (err) { console.error("hero:", err); });
  }

  // Each section fails independently: a missing file hides only that section.
  document.querySelectorAll("section[data-src]").forEach(function (el) {
    var type = RENDERERS[el.getAttribute("data-type")] || RENDERERS.list;
    load(el.getAttribute("data-src"))
      .then(function (text) {
        el.innerHTML =
          '<h2 class="label">' + escapeHtml(el.getAttribute("data-title") || "") + "</h2>" +
          '<div class="section-body">' + type.render(text, el.dataset) + "</div>";
        if (type.bind) type.bind(el);
      })
      .catch(function (err) {
        console.error(el.id + ":", err);
        el.remove();
      });
  });
})();
