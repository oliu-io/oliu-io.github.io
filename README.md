# ollieliu.com

Personal website. Plain HTML/CSS/JS, with no framework and no build step. All
content lives in Markdown files under [`content/`](content/), so day-to-day
edits never touch code.

## Editing content

| File | What it controls |
|---|---|
| [`content/hero.md`](content/hero.md) | Name, headline, photo, links (front matter) and the About text (body) |
| [`content/news.md`](content/news.md) | News, newest first |
| [`content/publications.md`](content/publications.md) | Papers, with Selected / All tabs |

Each file starts with a comment describing its fields.

### Headline

The top of `hero.md` sets the name, the grey aliases beside it, and the
one-line headline under it:

```yaml
name: Ollie Liu
headline: "Reinforcement learning at [Reflection AI](https://reflection.ai/)."
```

Everything below the second `---` becomes the About section.

### Adding news

Add a block at the top of `content/news.md`. The heading is the date (any
text), and the line below it is the item:

```markdown
## Mar 2026
Gave a talk on RL for reasoning at [Some Workshop](https://example.com).
```

The first 5 items show by default, with a "Show all" button for the rest.
Change `data-limit` on the News section in `index.html` to adjust.

### Adding a paper

Add a block under `# Conference Papers` or `# Preprints` in
`content/publications.md`:

```markdown
## Paper Title Goes Here
- authors: A. Coauthor, **Ollie Liu**, B. Coauthor
- venue: ICLR 2026
- featured: true
- note: Spotlight Presentation
- links: [paper](https://arxiv.org/abs/xxxx.xxxxx) [code](https://github.com/...)
```

- `featured: true` puts the paper in the default **Selected** tab.
- The title links to the first link. Papers are sorted newest first; the year
  comes from `venue`, the arXiv id, or an explicit `year:` field.
- `**Ollie Liu**` highlights your name; `*` marks equal contribution.

## Adding, removing, or reordering sections

The page layout lives in [`index.html`](index.html). Each section is one line:

```html
<section class="row section" id="news" data-title="News" data-src="news.md" data-type="news" data-limit="5"></section>
```

Move a line to reorder, delete it to hide. Section types:

| `data-type` | Renders |
|---|---|
| `about` | The body of a front-matter file (`hero.md`) |
| `news` | `## date` + text items |
| `papers` | Publications with Selected / All tabs |
| `list` | Any `##` item file: `date` on the left, `role`/`degree` after the title, other fields on a faint line, body below |

Experience, education, teaching, awards, and service are already written in
`content/` and wired up as commented-out lines in `index.html`; uncomment one
to show it.

## Design

A two-column grid: small mono labels on the left, content on the right.
Geist for text and Geist Mono for metadata, on a warm paper background.
Orange is the accent throughout: `--accent` for the agent and interaction
(link hovers, the active tab), `--accent-soft` / `--accent-ink` for highlights
(your name in author lists, paper notes, the latest news date, text
selection), and `--accent-line` for link underlines. Light and dark themes follow the system, with a
toggle in the top-right corner. All colors and sizes are CSS variables at the
top of [`styles.css`](styles.css).

**Fig. 1** ([`gridworld.js`](gridworld.js)) is a small live grid-world:

- **Value (dot size):** each dot's size is `V(s) = γ^d` for distance `d`
  to the goal. When a goal appears, its values
  spread outward one cell per tick, like value iteration.
- **Q (orange whiskers):** four short strokes around the agent show
  `Q(s, a)` for each move; the longest is the one it takes next.
- **Intrinsic reward (orange aura):** a count-based curiosity bonus
  `1/√(1 + N(s))` for nearby states, dimmer where the agent has already been.

With no goal, or before the value wave reaches it, the agent wanders by
curiosity. Once value arrives it follows `Q` to the goal, rests, and wanders
again until a new goal appears. Hover or tap to set the goal. Constants
(`GAMMA`, `CURIOSITY`, speeds, wall density) are at the top of the file.
Delete the `<figure>` in `index.html` to remove it. It pauses when off screen
and renders a static frame under `prefers-reduced-motion`.

## Local preview

Content is loaded with `fetch()`, so the site needs a local server (opening
`index.html` directly won't work):

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>.

## Deploy

GitHub Pages serves this repo directly (`.nojekyll`, custom domain via
`CNAME`). Push to `master` and the site updates.
