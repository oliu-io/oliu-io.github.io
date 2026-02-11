/* ============================================
   Ollie Liu — Personal Website
   Data-driven: loads content from YAML/Markdown
   ============================================ */

(function () {
  "use strict";

  /* ===========================================
     PARSERS
     =========================================== */

  /**
   * Minimal BibTeX parser.
   * Returns array of { entryType, citeKey, fields: { key: value, ... } }
   */
  function parseBibTeX(text) {
    var entries = [];
    // Match each @type{key, ... } block
    var re = /@(\w+)\s*\{([^,]*),/g;
    var match;
    while ((match = re.exec(text)) !== null) {
      var entryType = match[1].toLowerCase();
      var citeKey = match[2].trim();
      // Find the balanced closing brace
      var start = re.lastIndex;
      var depth = 1;
      var pos = start;
      while (pos < text.length && depth > 0) {
        if (text[pos] === '{') depth++;
        else if (text[pos] === '}') depth--;
        pos++;
      }
      var body = text.slice(start, pos - 1);
      var fields = parseBibFields(body);
      entries.push({ entryType: entryType, citeKey: citeKey, fields: fields });
    }
    return entries;
  }

  /** Parse the key={value} or key="value" pairs inside a BibTeX entry body */
  function parseBibFields(body) {
    var fields = {};
    var i = 0;
    while (i < body.length) {
      // Skip whitespace and commas
      while (i < body.length && /[\s,]/.test(body[i])) i++;
      if (i >= body.length) break;
      // Read key
      var keyStart = i;
      while (i < body.length && body[i] !== '=' && !/[\s,}]/.test(body[i])) i++;
      var key = body.slice(keyStart, i).trim().toLowerCase();
      if (!key) break;
      // Skip whitespace and =
      while (i < body.length && /[\s]/.test(body[i])) i++;
      if (i >= body.length || body[i] !== '=') continue;
      i++; // skip =
      while (i < body.length && /[\s]/.test(body[i])) i++;
      if (i >= body.length) break;
      // Read value
      var value = '';
      if (body[i] === '{') {
        i++; // skip opening {
        var depth = 1;
        var valStart = i;
        while (i < body.length && depth > 0) {
          if (body[i] === '{') depth++;
          else if (body[i] === '}') depth--;
          if (depth > 0) i++;
        }
        value = body.slice(valStart, i);
        i++; // skip closing }
      } else if (body[i] === '"') {
        i++; // skip opening "
        var valStart2 = i;
        while (i < body.length && body[i] !== '"') i++;
        value = body.slice(valStart2, i);
        i++; // skip closing "
      } else {
        // Bare value (number, etc.)
        var valStart3 = i;
        while (i < body.length && body[i] !== ',' && body[i] !== '}') i++;
        value = body.slice(valStart3, i).trim();
      }
      fields[key] = value;
    }
    return fields;
  }

  /**
   * Convert parsed BibTeX entries to publication objects matching our renderer.
   * Fields: title, authors, type, venue_short, featured, note, pdf, code, website
   */
  function bibToPublications(entries) {
    return entries.map(function (entry) {
      var f = entry.fields;
      var title = (f.title || '').replace(/[{}]/g, '');
      var authors = formatBibAuthors(f.author || '');
      var abbr = f.abbr || '';
      var isPreprint = abbr === 'Preprint' || (!f.booktitle && !abbr);
      var venue_short = '';
      if (!isPreprint && abbr) {
        // Extract year from the year field
        var year = f.year || '';
        venue_short = abbr + (year ? ' ' + year : '');
      }
      // Build note from booktitle annotations like [Oral] or [Spotlight]
      var note = '';
      var bt = f.booktitle || '';
      var bracketMatch = bt.match(/^\[([^\]]+)\]/);
      if (bracketMatch) {
        note = bracketMatch[1];
      }

      // PDF link: prefer arxiv, fall back to url
      var pdf = '';
      if (f.arxiv) {
        pdf = 'https://arxiv.org/abs/' + f.arxiv;
      } else if (f.url) {
        pdf = f.url;
      }

      return {
        title: title,
        authors: authors,
        type: isPreprint ? 'preprint' : 'conference',
        venue_short: venue_short,
        featured: f.selected === 'true',
        note: note,
        pdf: pdf,
        code: f.code || '',
        website: f.website || ''
      };
    });
  }

  /**
   * Format BibTeX author string into display format.
   * Handles "Last, First and Last, First" and "First Last and First Last" formats.
   * Bolds any author with last name "Liu" + first containing "Ollie" or "Oliver".
   */
  function formatBibAuthors(raw) {
    if (!raw) return '';
    var authors = raw.split(/\s+and\s+/);
    return authors.map(function (a) {
      a = a.trim();
      if (!a) return '';
      // Handle "others" → "et al."
      if (a === 'others') return 'et al.';
      var display = '';
      if (a.indexOf(',') !== -1) {
        // "Last, First" format
        var parts = a.split(',');
        var last = parts[0].trim();
        var first = parts.slice(1).join(',').trim();
        display = first + ' ' + last;
      } else {
        display = a;
      }
      // Clean up extra whitespace
      display = display.replace(/\s+/g, ' ').trim();
      // Bold Ollie Liu variants — strip trailing * before checking, re-add after
      var star = '';
      if (display.endsWith('*')) {
        star = '*';
        display = display.slice(0, -1).trim();
      }
      if (/\bLiu\b/.test(display) && /\b(Ollie|Oliver)\b/.test(display)) {
        display = '**' + display + '**' + star;
      } else {
        display = display + star;
      }
      return display;
    }).join(', ');
  }

  /**
   * Parse the hero.md front-matter, which has a nested `links` array.
   * Returns { meta: { name, subtitle, links: [...] }, body: string }
   */
  function parseFrontMatter(text) {
    var match = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)/);
    if (!match) return { meta: {}, body: text };

    var metaText = match[1];
    var body = match[2].trim();
    var meta = {};
    var lines = metaText.split("\n");
    var currentKey = null;
    var linkItem = null;

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^\s*#/.test(line) || /^\s*$/.test(line)) continue;

      // Top-level key with value: "name: Ollie Liu"
      if (/^\w/.test(line) && line.indexOf(": ") !== -1) {
        var kv = splitFirst(line, ": ");
        currentKey = kv[0].trim();
        meta[currentKey] = parseValue(kv[1]);
      }
      // Top-level key with no inline value: "links:"
      else if (/^\w/.test(line) && line.trim().endsWith(":")) {
        currentKey = line.trim().slice(0, -1);
        meta[currentKey] = [];
      }
      // Nested array item: "  - label: Email"
      else if (/^  - /.test(line) && Array.isArray(meta[currentKey])) {
        linkItem = {};
        meta[currentKey].push(linkItem);
        var rest = line.slice(4);
        if (rest.indexOf(": ") !== -1) {
          var kv2 = splitFirst(rest, ": ");
          linkItem[kv2[0].trim()] = parseValue(kv2[1]);
        }
      }
      // Nested continuation: "    url: mailto:..."
      else if (/^    \S/.test(line) && linkItem) {
        var trimmed = line.trim();
        if (trimmed.indexOf(": ") !== -1) {
          var kv3 = splitFirst(trimmed, ": ");
          linkItem[kv3[0].trim()] = parseValue(kv3[1]);
        }
      }
    }
    return { meta: meta, body: body };
  }

  /** Split string on first occurrence of separator */
  function splitFirst(str, sep) {
    var idx = str.indexOf(sep);
    if (idx === -1) return [str, ""];
    return [str.slice(0, idx), str.slice(idx + sep.length)];
  }

  /** Parse a YAML value: booleans, strip quotes, or return as-is */
  function parseValue(raw) {
    if (!raw) return "";
    raw = raw.trim();
    // Strip inline comments (only outside quotes)
    if (!raw.startsWith('"') && !raw.startsWith("'")) {
      var commentIdx = raw.indexOf(" #");
      if (commentIdx !== -1) raw = raw.slice(0, commentIdx).trim();
    }
    if (raw === "true") return true;
    if (raw === "false") return false;
    if (
      (raw.startsWith('"') && raw.endsWith('"')) ||
      (raw.startsWith("'") && raw.endsWith("'"))
    ) {
      return raw.slice(1, -1);
    }
    return raw;
  }

  /** Render inline Markdown: **bold**, [text](url), paragraphs (double newline) */
  function renderMarkdownInline(text) {
    if (!text) return "";
    return text
      .split(/\n\n+/)
      .map(function (para) {
        return para.trim()
          .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
          .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
      })
      .filter(function (p) { return p; })
      .join("</p><p>");
  }

  /** Escape HTML for plain-text fields */
  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* ===========================================
     RENDERERS
     =========================================== */

  var LINK_ICONS = {
    "Google Scholar": '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3L1 9l4 2.18v6L12 21l7-3.82v-6l2-1.09V17h2V9L12 3zm6.82 6L12 12.72 5.18 9 12 5.28 18.82 9zM17 15.99l-5 2.73-5-2.73v-3.72L12 15l5-2.73v3.72z"/></svg>',
    "GitHub": '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/></svg>',
    "X / Twitter": '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>'
  };

  function renderHero(meta, bodyHtml) {
    // Top section: photo + contact card side by side
    var h = '<div class="hero-card">';

    if (meta.photo) {
      h += '<div class="hero-photo"><img src="' + escapeHtml(meta.photo) +
           '" alt="' + escapeHtml(meta.name) + '"></div>';
    }

    h += '<div class="hero-info">';
    if (meta.title) {
      h += '<p class="hero-title">' + renderMarkdownInline(meta.title) + '</p>';
    }
    if (meta.role) {
      h += '<p class="hero-role">' + renderMarkdownInline(meta.role) + '</p>';
    }
    if (meta.links && meta.links.length) {
      h += '<div class="hero-links">';
      meta.links.forEach(function (link) {
        var icon = LINK_ICONS[link.label] || '';
        var cls = link.style === "primary" ? "btn" : "btn btn-outline btn-icon";
        h += '<a href="' + escapeHtml(link.url) + '" class="' + cls +
             '" aria-label="' + escapeHtml(link.label) + '" title="' +
             escapeHtml(link.label) + '">' + icon + '</a>';
      });
      h += '</div>';
    }
    h += '</div>';
    h += '</div>';

    // Divider + bio
    h += '<hr class="hero-divider">';
    h += '<div class="tagline"><p>' + bodyHtml + '</p></div>';

    return h;
  }

  function renderEducation(items) {
    return items.map(function (item) {
      var meta = item.meta
        ? '<p class="meta">' + escapeHtml(item.meta) + '</p>' : '';
      return '<div class="timeline-item">' +
        '<div class="timeline-date">' + escapeHtml(item.date) + '</div>' +
        '<div class="timeline-content">' +
          '<h3>' + escapeHtml(item.institution) + '</h3>' +
          '<p>' + escapeHtml(item.degree) + '</p>' +
          meta +
        '</div>' +
      '</div>';
    }).join("\n");
  }

  function renderPublications(items) {
    return items.map(function (item) {
      var isPreprint = item.type === "preprint";
      var tagClass = isPreprint ? "pub-tag tag-preprint" : "pub-tag";
      var tagLabel = isPreprint ? "Preprint" : (item.venue_short || "");
      var featuredAttr = item.featured ? ' data-featured' : '';
      var featuredBadge = item.featured
        ? '<span class="pub-featured-badge">Featured</span>' : '';
      var note = item.note
        ? '<p class="pub-note">' + escapeHtml(item.note) + '</p>' : '';

      var linkKeys = ["pdf", "code", "website"];
      var links = linkKeys
        .filter(function (k) { return item[k]; })
        .map(function (k) {
          return '<a href="' + escapeHtml(item[k]) + '">' + k + '</a>';
        })
        .join("");

      return '<li class="pub-item" data-type="' + escapeHtml(item.type) + '"' +
        featuredAttr + '>' +
        '<span class="' + tagClass + '">' + escapeHtml(tagLabel) + '</span>' +
        featuredBadge +
        '<p class="pub-title">' + escapeHtml(item.title) + '</p>' +
        '<p class="pub-authors">' + renderMarkdownInline(item.authors) + '</p>' +
        note +
        '<div class="pub-links">' + links + '</div>' +
      '</li>';
    }).join("\n");
  }

  function renderExperience(items) {
    return items.map(function (item) {
      var meta = item.meta
        ? '<p class="meta">' + escapeHtml(item.meta) + '</p>' : '';
      var desc = item.description
        ? '<p>' + escapeHtml(item.description) + '</p>' : '';
      return '<div class="timeline-item">' +
        '<div class="timeline-date">' + escapeHtml(item.date) + '</div>' +
        '<div class="timeline-content">' +
          '<h3>' + escapeHtml(item.organization) +
          ' <span class="role">' + escapeHtml(item.role) + '</span></h3>' +
          meta + desc +
        '</div>' +
      '</div>';
    }).join("\n");
  }

  function renderTeaching(items) {
    return items.map(function (item) {
      return '<div class="teaching-item">' +
        '<span class="teaching-role">' + escapeHtml(item.role) + '</span>' +
        '<div>' +
          '<h3>' + escapeHtml(item.course) + '</h3>' +
          '<p>' + escapeHtml(item.institution) + '</p>' +
        '</div>' +
      '</div>';
    }).join("\n");
  }

  function renderAwards(items) {
    return items.map(function (item) {
      var detail = item.detail
        ? ' — ' + escapeHtml(item.detail) : '';
      return '<li>' +
        '<strong>' + escapeHtml(item.title) + '</strong>' + detail +
        '<span class="award-source">' + escapeHtml(item.source) + '</span>' +
      '</li>';
    }).join("\n");
  }

  function renderService(items) {
    return items.map(function (item) {
      return '<div class="service-item">' +
        '<h3>' + escapeHtml(item.title) + '</h3>' +
        '<p>' + escapeHtml(item.description) + '</p>' +
      '</div>';
    }).join("\n");
  }

  /* ===========================================
     CONTENT LOADER
     =========================================== */

  function loadContent(filename) {
    return fetch("content/" + filename).then(function (res) {
      if (!res.ok) throw new Error("Failed to load " + filename + ": " + res.status);
      return res.text();
    });
  }

  /* ===========================================
     INTERACTIVITY
     =========================================== */

  /** Theme toggle (runs immediately — DOM elements exist at load) */
  function initTheme() {
    var toggle = document.getElementById("theme-toggle");
    var iconSun = document.getElementById("icon-sun");
    var iconMoon = document.getElementById("icon-moon");

    function setTheme(theme) {
      document.documentElement.setAttribute("data-theme", theme);
      localStorage.setItem("theme", theme);
      iconSun.style.display = theme === "dark" ? "none" : "block";
      iconMoon.style.display = theme === "dark" ? "block" : "none";
    }

    var saved = localStorage.getItem("theme");
    setTheme(saved || "light");

    toggle.addEventListener("click", function () {
      var current = document.documentElement.getAttribute("data-theme");
      setTheme(current === "dark" ? "light" : "dark");
    });
  }

  /** Publication filter buttons — must be called after pub items are rendered */
  function bindPublicationFilters() {
    var filterBtns = document.querySelectorAll(".filter-btn");
    var pubItems = document.querySelectorAll(".pub-item");

    filterBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var filter = btn.getAttribute("data-filter");
        filterBtns.forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");

        pubItems.forEach(function (item) {
          if (filter === "all") {
            item.classList.remove("hidden");
          } else if (filter === "featured") {
            item.classList.toggle("hidden", !item.hasAttribute("data-featured"));
          } else {
            item.classList.toggle("hidden", item.getAttribute("data-type") !== filter);
          }
        });
      });
    });
  }

  /** Scroll-based nav highlight */
  function initNavHighlight() {
    var sections = document.querySelectorAll(".section, #hero");
    var navLinks = document.querySelectorAll(".nav-links a");

    function update() {
      var current = "";
      sections.forEach(function (section) {
        var top = section.offsetTop - 100;
        if (window.scrollY >= top) {
          current = section.getAttribute("id");
        }
      });
      navLinks.forEach(function (link) {
        link.style.color = "";
        if (link.getAttribute("href") === "#" + current) {
          link.style.color = "var(--fg)";
        }
      });
    }

    window.addEventListener("scroll", update, { passive: true });
    update();
  }

  /* ===========================================
     INITIALIZATION
     =========================================== */

  // 1. Theme toggle (synchronous — static DOM)
  initTheme();

  // 2. Load all content in parallel, then render
  Promise.all([
    loadContent("hero.md"),
    loadContent("publications.bib"),
  ])
    .then(function (results) {
      var hero = parseFrontMatter(results[0]);
      var bibEntries = parseBibTeX(results[1]);
      var publications = bibToPublications(bibEntries);

      // Render into DOM
      document.getElementById("hero-content").innerHTML =
        renderHero(hero.meta, renderMarkdownInline(hero.body));
      document.getElementById("publications-content").innerHTML =
        renderPublications(publications);

      // Bind interactivity after DOM is populated
      bindPublicationFilters();
      initNavHighlight();
    })
    .catch(function (err) {
      console.error("Failed to load site content:", err);
    });
})();
