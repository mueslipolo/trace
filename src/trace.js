// Trace — a small diagram language that draws in the "redrawn docs" style.
// Parser → model → ELK layout (with hand-stacked column/row groups) → SVG.

const KINDS = new Set(['box', 'store', 'engine', 'state', 'pill', 'ask', 'start', 'final', 'end']);
const NODE_TAGS = new Set(['ok', 'bad', 'dashed', 'muted', 'span', 'bridge']);
const EDGE_TAGS = new Set(['ok', 'bad', 'dashed', 'muted']);
const FRAME_TAGS = new Set(['green', 'blue', 'orange', 'purple', 'grey', 'gray', 'dashed']);
const RAIL_SIDES = new Set(['top', 'bottom', 'left', 'right']);
const RAIL_TAGS = new Set([...FRAME_TAGS, ...RAIL_SIDES]);
const ARROWS = /\s*(<->|<--|-->|<-|->|--)\s*/;
const ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

// Icons: every Lucide icon by its own name, plus friendlier names for common diagram elements.
// `lucide/name` skips the aliases (needed for `lucide/bridge`, since `bridge` is a Trace tag).
// The drawings of the named icons ship with the engine; any other icon is fetched when a diagram
// first uses it (see loadIcons). Every name is known up front, so mistakes are caught while parsing.
const IN_NODE = typeof module !== 'undefined';
const ICON_CORE = IN_NODE ? require('./lucide-core.js') : LUCIDE_CORE;
const ICON_NAMES = new Set(IN_NODE ? require('./lucide-names.js') : LUCIDE_NAMES);
const ICON_LOADED = new Map();
const ICON_ALIASES = {
  browser: 'app-window', queue: 'list-end', firewall: 'brick-wall-fire', storage: 'archive', loadbalancer: 'graph-hub',
  api: 'webhook', internet: 'globe', mobile: 'smartphone', switch: 'ethernet-port', vpn: 'shield-check', dns: 'network',
  camera: 'cctv', cache: 'zap', function: 'square-function', document: 'file-text', chart: 'chart-column', key: 'key-round',
};
const ICON_SIZE = 22;
const ICON_CDN = 'https://cdn.jsdelivr.net/npm/lucide-static@1.79.0/icons/';
function lucideName(name) { return name.startsWith('lucide/') ? name.slice(7) : (ICON_ALIASES[name] || name); }
function iconKnown(name) { return ICON_NAMES.has(lucideName(name)); }
function iconSvg(name) { const l = lucideName(name); return ICON_CORE[l] || ICON_LOADED.get(l) || null; }
// Fetch the drawings a model needs and does not have yet. Failures are returned, not thrown:
// the node is then drawn without its icon.
async function loadIcon(name, loader) {
  const l = lucideName(name);
  if (ICON_CORE[l] || ICON_LOADED.has(l)) return iconSvg(name);
  const svg = await (loader || defaultIconLoader)(l);
  const m = svg && /<svg[^>]*>([\s\S]*)<\/svg>/.exec(svg);
  if (!m) return null;
  ICON_LOADED.set(l, m[1].replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim());
  return ICON_LOADED.get(l);
}
// `a: Label` + "database" -> `a [database]: Label`; keeps the other tags, replaces an earlier icon.
// Returns null when the line is not a node line (links, blocks, keys), so the caller can say so.
function withIcon(line, name) {
  const c = firstColon(line);
  if (c < 0 || ARROWS.test(line.slice(0, c)) || /^\s*(frame|column|row|key|title|direction|spacing)\b/.test(line)) return null;
  const lhs = line.slice(0, c), rest = line.slice(c);
  const m = lhs.match(/^(.*?)\s*\[([^\]]*)\]\s*$/);
  if (!m) return lhs.trimEnd() + ` [${name}]` + rest;
  const keep = m[2].trim().split(/[\s,]+/).filter(t => t && (NODE_TAGS.has(t) || t === 'top'));
  return m[1] + ` [${[...keep, name].join(' ')}]` + rest;
}
async function loadIcons(model, loader) {
  const need = [...new Set([...model.nodes.values()].filter(n => n.icon && !iconSvg(n.icon)).map(n => lucideName(n.icon)))];
  const failed = [];
  await Promise.all(need.map(async name => {
    try { if (!(await loadIcon(name, loader))) throw new Error('no drawing'); } catch (e) { failed.push(name); }
  }));
  return failed;
}
async function defaultIconLoader(name) {
  if (IN_NODE) { const all = require('./lucide.js'); return all[name] ? `<svg>${all[name]}</svg>` : null; }
  const r = await fetch(ICON_CDN + name + '.svg');
  return r.ok ? r.text() : null;
}
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
function iconHint(name) {
  const q = name.replace(/^lucide\//, '');
  const all = [...new Set([...Object.keys(ICON_ALIASES), ...ICON_NAMES])];
  const near = all.map(n => ({ n, d: n.includes(q) ? 0 : editDistance(q, n) })).filter(c => c.d <= 2)
    .sort((a, b) => a.d - b.d || a.n.length - b.n.length).slice(0, 5).map(c => c.n);
  return near.length ? ` Did you mean ${near.join(', ')}?` : '';
}
// the tags a node accepts: the fixed ones, `top`, and any icon name
const NODE_TAG_SET = {
  has: t => NODE_TAGS.has(t) || t === 'top' || iconKnown(t),
  hint: t => `Unknown tag "${t}" on a node. Use ${[...NODE_TAGS, 'top'].join(', ')}, or an icon name such as database, server, user, firewall.${iconHint(t)}`,
};

class TraceError extends Error {}

function stripComment(line) {
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') q = !q;
    else if (c === '#' && !q && (i === 0 || /\s/.test(line[i - 1]))) return line.slice(0, i);
  }
  return line;
}

function firstColon(s) {
  let q = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"') q = !q;
    else if (s[i] === ':' && !q) return i;
  }
  return -1;
}

function unquote(s) {
  s = s.trim();
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') return s.slice(1, -1);
  return s;
}

function takeTags(s, allowed, where) {
  const m = s.match(/\[([^\]]*)\]\s*$/);
  if (!m) return { rest: s, tags: [] };
  const tags = m[1].trim().split(/[\s,]+/).filter(Boolean);
  for (const t of tags) {
    if (!allowed.has(t)) throw new TraceError(allowed.hint ? allowed.hint(t) : `Unknown tag "${t}" on ${where}. Use: ${[...allowed].join(', ')}`);
  }
  return { rest: s.slice(0, m.index).trimEnd(), tags };
}

function labelTags(label, allowed) {
  // a trailing [ok bad] after the label also counts, if every word is a known tag
  const m = label.match(/\s*\[([^\]]*)\]\s*$/);
  if (!m) return { label, tags: [] };
  const tags = m[1].trim().split(/[\s,]+/).filter(Boolean);
  if (!tags.length || !tags.every(t => allowed.has(t))) return { label, tags: [] };
  return { label: label.slice(0, m.index).trim(), tags };
}

function splitLabel(text) {
  const t = text.replace(/\\n/g, '\n');
  const i = t.indexOf('|');
  if (i < 0) return { name: t.trim(), note: '' };
  return { name: t.slice(0, i).trim(), note: t.slice(i + 1).trim() };
}

function parse(src) {
  const model = {
    direction: 'RIGHT', spacing: 1, title: '',
    nodes: new Map(), frames: new Map(), rails: new Map(), groups: [], edges: [], keys: [], aligns: [], errors: [],
  };
  const root = { type: 'root', id: '', items: [], parent: null };
  model.root = root;
  const stack = [root];
  let fcount = 0, gcount = 0;
  const cur = () => stack[stack.length - 1];

  function placeNode(n, container) {
    if (n.parent) {
      const i = n.parent.items.indexOf(n);
      if (i >= 0) n.parent.items.splice(i, 1);
    }
    n.parent = container;
    container.items.push(n);
  }

  function ensure(id, ln) {
    if (!ID_RE.test(id)) throw new TraceError(`"${id}" is not a valid name: use letters, digits and _ . -`);
    if (model.frames.has(id) || model.rails.has(id)) return;
    if (!model.nodes.has(id)) {
      const n = { type: 'node', id, kind: 'box', name: id, note: '', tags: [], parent: null, implicit: true, line: ln };
      model.nodes.set(id, n);
      placeNode(n, cur());
    }
  }

  function handle(line, ln) {
    if (line === '}') {
      if (stack.length === 1) throw new TraceError('There is no open block for this } to close');
      stack.pop();
      return;
    }
    let m;
    if ((m = line.match(/^direction\s+(\S+)$/i))) {
      const d = m[1].toLowerCase();
      if (['right', 'lr'].includes(d)) model.direction = 'RIGHT';
      else if (['down', 'td', 'tb'].includes(d)) model.direction = 'DOWN';
      else throw new TraceError('direction is right or down');
      return;
    }
    if ((m = line.match(/^spacing\s+([\d.]+)$/i))) {
      model.spacing = Math.min(3, Math.max(0.5, parseFloat(m[1]) || 1));
      return;
    }
    if ((m = line.match(/^title\s+(.+)$/i))) { model.title = unquote(m[1]); return; }
    if ((m = line.match(/^align\s+(.+)$/i))) {
      // align a b [c ...]: keep each pair level, by making the link between them straight
      const ids = m[1].trim().split(/[\s,]+/).filter(Boolean);
      if (ids.length < 2) throw new TraceError('align takes two or more nodes that are linked, one after the other: align topic consumer');
      for (const id of ids) if (!ID_RE.test(id)) throw new TraceError(`"${id}" is not a valid name`);
      for (let i = 1; i < ids.length; i++) model.aligns.push({ a: ids[i - 1], b: ids[i], line: ln });
      return;
    }
    if ((m = line.match(/^key\s+(.*)$/i))) {
      const c = firstColon(m[1]);
      if (c < 0) throw new TraceError('A key line reads: key <shape or arrow> [tags] : text');
      const { rest, tags } = takeTags(m[1].slice(0, c).trim(), new Set([...NODE_TAGS, ...EDGE_TAGS, ...FRAME_TAGS]), 'key');
      const shape = rest.trim();
      const ok = KINDS.has(shape) || ['->', '-->', '--', 'frame'].includes(shape);
      if (!ok) throw new TraceError(`A key shows a shape (${[...KINDS].join(', ')}, frame) or an arrow (->, -->)`);
      model.keys.push({ shape, tags, text: m[1].slice(c + 1).trim(), line: ln });
      return;
    }
    if (line.endsWith('{')) {
      const head = line.slice(0, -1).trim();
      const hm = head.match(/^(frame|column|row|rail)\b\s*(.*)$/i);
      if (!hm) throw new TraceError('Only frame, column, row and rail open a block with {');
      const kind = hm[1].toLowerCase();
      const parent = cur();
      if (parent.type === 'rail') throw new TraceError('A rail holds nodes only: they are what its links feed into');
      if (kind === 'rail') {
        // a rail runs along one edge of the whole diagram; the nodes inside it are where its links end
        if (parent.type !== 'root') throw new TraceError('A rail goes at the top level, along an edge of the whole diagram: put it outside every frame, row and column');
        let { rest, tags } = takeTags(hm[2], RAIL_TAGS, 'rail');
        let title = '';
        const qm = rest.match(/"([^"]*)"\s*$/);
        if (qm) { title = qm[1]; rest = rest.slice(0, qm.index).trim(); }
        const id = rest.trim();
        if (!id || !ID_RE.test(id)) throw new TraceError('A rail needs a name that links can use: rail logs "Logging" [bottom] {');
        if (model.rails.has(id) || model.frames.has(id)) throw new TraceError(`There is already a frame or rail called "${id}"`);
        const ex = model.nodes.get(id);
        if (ex) {
          if (!ex.implicit) throw new TraceError(`"${id}" is already a node; give the rail another name`);
          ex.parent.items.splice(ex.parent.items.indexOf(ex), 1);
          model.nodes.delete(id);
        }
        const sides = tags.filter(t => RAIL_SIDES.has(t));
        if (sides.length > 1) throw new TraceError('A rail runs along one side: top, bottom, left or right');
        const rl = { type: 'rail', id, title: title || id, side: sides[0] || null, tags: tags.filter(t => !RAIL_SIDES.has(t)), items: [], parent, line: ln };
        model.rails.set(id, rl);
        parent.items.push(rl);
        stack.push(rl);
        return;
      }
      if (parent.type === 'group') {
        // a row or column that holds frames or other blocks is a lane: it places them side by side or
        // one above the other, and draws nothing itself
        if (parent.title) throw new TraceError(`A ${parent.axis === 'v' ? 'column' : 'row'} that holds frames or other blocks has no title: put the title on a frame`);
        parent.type = 'lane';
        model.groups.splice(model.groups.indexOf(parent), 1);
      }
      if (kind === 'frame') {
        let { rest, tags } = takeTags(hm[2], FRAME_TAGS, 'frame');
        let title = '';
        const qm = rest.match(/"([^"]*)"\s*$/);
        if (qm) { title = qm[1]; rest = rest.slice(0, qm.index).trim(); }
        let id = rest.trim();
        if (id && !ID_RE.test(id)) throw new TraceError(`"${id}" is not a valid frame name`);
        if (!id) id = '_frame' + (++fcount);
        if (model.frames.has(id)) throw new TraceError(`There is already a frame called "${id}"`);
        const ex = model.nodes.get(id);
        if (ex) {
          if (!ex.implicit) throw new TraceError(`"${id}" is already a node; give the frame another name`);
          ex.parent.items.splice(ex.parent.items.indexOf(ex), 1);
          model.nodes.delete(id);
        }
        const f = { type: 'frame', id, title: title || (id.startsWith('_') ? '' : id), tags, items: [], parent, line: ln };
        model.frames.set(id, f);
        parent.items.push(f);
        stack.push(f);
      } else {
        const rest = hm[2].trim();
        let title = '';
        if (rest) {
          const qm = rest.match(/^"([^"]*)"$/);
          if (!qm) throw new TraceError(`A ${kind} takes an optional title in quotes: ${kind} "backends" {`);
          title = qm[1];
        }
        const g = { type: 'group', id: '_g' + (++gcount), axis: kind === 'column' ? 'v' : 'h', title, items: [], parent, line: ln };
        model.groups.push(g);
        parent.items.push(g);
        stack.push(g);
      }
      return;
    }

    const c = firstColon(line);
    let lhs = c < 0 ? line : line.slice(0, c);
    let label = c < 0 ? null : line.slice(c + 1).trim();

    if (ARROWS.test(lhs)) {
      let { rest, tags } = takeTags(lhs.trim(), EDGE_TAGS, 'a link');
      if (label) { const lt = labelTags(label, EDGE_TAGS); label = lt.label; tags = tags.concat(lt.tags); }
      const parts = rest.split(ARROWS).map(s => s.trim());
      if (parts.length < 3 || parts.length % 2 === 0 || parts.some((p, i) => i % 2 === 0 && !p)) {
        throw new TraceError('A link reads: a -> b : label   (also -->, <-, <->, --)');
      }
      for (let i = 0; i < parts.length; i += 2) ensure(parts[i], ln);
      for (let i = 1; i < parts.length; i += 2) {
        const op = parts[i], a = parts[i - 1], b = parts[i + 1];
        model.edges.push({
          a, b, op, label: label ? label.replace(/\\n/g, '\n') : '',
          tags: tags.slice(),
          dashed: op === '-->' || op === '<--' || tags.includes('dashed'),
          start: op.startsWith('<'), end: op.endsWith('>'),
          line: ln,
        });
      }
      return;
    }

    // node declaration
    let { rest, tags } = takeTags(lhs.trim(), NODE_TAG_SET, 'a node');
    if (label) { const lt = labelTags(label, NODE_TAG_SET); label = lt.label; tags = tags.concat(lt.tags); }
    let icon = null, iconTop = false;
    tags = tags.filter(t => { if (t === 'top') { iconTop = true; return false; } if (!NODE_TAGS.has(t)) { icon = t; return false; } return true; });
    const words = rest.split(/\s+/).filter(Boolean);
    let kind = null, id;
    if (words.length === 2 && KINDS.has(words[0])) { kind = words[0]; id = words[1]; }
    else if (words.length === 1) id = words[0];
    else throw new TraceError(`Can't read "${line}". A node reads: [kind] name [tags] : Label | note`);
    if (!ID_RE.test(id)) throw new TraceError(`"${id}" is not a valid name: use letters, digits and _ . -`);
    if (model.frames.has(id) || model.rails.has(id)) throw new TraceError(`"${id}" is already a frame or rail`);
    let n = model.nodes.get(id);
    if (!n) {
      n = { type: 'node', id, kind: 'box', name: id, note: '', tags: [], parent: null, line: ln };
      model.nodes.set(id, n);
    }
    if (kind) n.kind = kind === 'end' ? 'final' : kind;
    if (label !== null) Object.assign(n, splitLabel(label));
    n.tags = [...new Set(n.tags.concat(tags))];
    if (icon) n.icon = icon;
    if (iconTop) { if (!n.icon) throw new TraceError('"top" places an icon above the text, so give the node an icon: db [database top]: Orders'); n.iconTop = true; }
    if (n.implicit || n.parent !== cur()) placeNode(n, cur());
    n.implicit = false;
    n.line = ln;
  }

  const lines = src.split('\n');
  lines.forEach((raw, i) => {
    const line = stripComment(raw).trim();
    if (!line) return;
    try { handle(line, i + 1); }
    catch (e) {
      if (e instanceof TraceError) model.errors.push({ line: i + 1, msg: e.message });
      else throw e;
    }
  });
  if (stack.length > 1) {
    const open = stack[stack.length - 1];
    model.errors.push({ line: open.line, msg: `This ${open.type === 'frame' ? 'frame' : open.axis === 'v' ? 'column' : 'row'} is never closed with }` });
  }
  for (const al of model.aligns) {
    const missing = [al.a, al.b].find(id => !model.nodes.has(id));
    if (missing) { model.errors.push({ line: al.line, msg: `align: there is no node called "${missing}"` }); continue; }
    const linked = model.edges.some(e => (e.a === al.a && e.b === al.b) || (e.a === al.b && e.b === al.a));
    if (!linked) model.errors.push({ line: al.line, msg: `align ${al.a} ${al.b} keeps the link between them straight, so they need one: write ${al.a} -> ${al.b}` });
  }
  return model;
}

// ---------------------------------------------------------------- measuring

const FONT_NAME = '600 13px Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
const FONT_NOTE = '400 11px Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
const FONT_TITLE = '600 11.5px Inter, system-ui, -apple-system, "Segoe UI", sans-serif';

function wrap(text, font, maxW, measure) {
  const out = [];
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean);
    if (!words.length) { out.push(''); continue; }
    let line = words[0];
    for (let i = 1; i < words.length; i++) {
      const t = line + ' ' + words[i];
      if (measure(t, font) <= maxW) line = t;
      else { out.push(line); line = words[i]; }
    }
    out.push(line);
  }
  return out;
}

const even = v => Math.ceil(v / 2) * 2;

function sizeNode(n, measure) {
  if (n.kind === 'start') { n.w = 18; n.h = 18; n.nameLines = []; n.noteLines = []; return; }
  n.nameLines = n.name ? wrap(n.name, FONT_NAME, 210, measure) : [];
  n.noteLines = n.note ? wrap(n.note, FONT_NOTE, 230, measure) : [];
  const tw = Math.max(0, ...n.nameLines.map(l => measure(l, FONT_NAME)), ...n.noteLines.map(l => measure(l, FONT_NOTE)));
  n.textH = n.nameLines.length * 16 + n.noteLines.length * 14;
  const padX = (n.kind === 'ask' || n.kind === 'pill') ? 24 : 15;
  n.padX = padX;
  n.iconMarkup = n.icon ? iconSvg(n.icon) : null;
  const slot = n.iconMarkup && !n.iconTop ? ICON_SIZE + 8 : 0;
  n.w = even(Math.max(72, tw + 2 * padX + slot));
  n.h = even(Math.max(36, n.textH + 16 + (n.iconMarkup && n.iconTop ? ICON_SIZE + 4 : 0)));
  if (n.kind === 'final') { n.w += 8; n.h += 8; }
}

function sizeLabel(text, measure) {
  if (!text) return null;
  const lines = wrap(text, FONT_NOTE, 150, measure);
  return { lines, w: Math.ceil(Math.max(...lines.map(l => measure(l, FONT_NOTE)))) + 6, h: lines.length * 13 + 2 };
}

// ---------------------------------------------------------------- layout

// The tidy-up runs on the layout that was chosen, after the choice: it changes the number of points in a
// link without changing how it looks, and the choice is made on those counts.
async function layout(model, measure, ELK) {
  const rm = await chooseLayout(model, measure, ELK);
  alignJogs(rm);
  return rm;
}

async function chooseLayout(model, measure, ELK) {
  // Three ways to place frames, best valid one wins (fewest link bends, then the earlier one):
  //  1. per frame: each frame laid out by its own ELK run, then composed (null if it cannot)
  //  2. flat: only members are laid out, frames are drawn around them afterwards
  //  3. compound: frames are ELK compound nodes (always valid, the fallback)
  // A candidate is valid when no frame covers a node that is not its own and no two unrelated
  // frames overlap. TRACE_LAYOUT=hier|flat|compound forces one.
  const env = (typeof process !== 'undefined' && process.env) || {};
  const owns = (fr, n) => { for (let p = n.parent; p; p = p.parent) if (p === fr) return true; return false; };
  const ov = (a, b) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1;
  const within = (a, b) => { for (let p = a; p; p = p.parent) if (p === b) return true; return false; };
  // every link must start at its source and end at its target (ELK's wrapping can cut a link short)
  const near = (p, n) => p.x >= n.x - 4 && p.x <= n.x + n.w + 4 && p.y >= n.y - 4 && p.y <= n.y + n.h + 4;
  const linked = rm => rm.edges.every(({ e, pts }) => {
    const A = model.nodes.get(e.a), B = model.nodes.get(e.b);
    return !A || !B || !pts.length || (near(pts[0], A) && near(pts[pts.length - 1], B));
  });
  const valid = rm => linked(rm) && !(rm.frames.some(fr => rm.nodes.some(n => !owns(fr.f, n) && !n.tags.includes('bridge') && ov(fr, n))) ||
    rm.frames.some(a => rm.frames.some(b => a.f.id < b.f.id && !within(a.f, b.f) && !within(b.f, a.f) &&
      Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 2 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 2)));
  const modes = { hier: [false, true], hierwrap: [false, true, true], flat: [true, false], compound: [false, false] };
  // rows and columns that hold frames (lanes) only exist in the per-frame mode; if that cannot place
  // the diagram, the others draw it without the lanes
  // cost: link bends, plus how small the text gets when the drawing is fitted to a page 1100px wide
  const cost = (rm, bends) => bends + 160 * (1 - Math.min(1, 1100 / rm.width));
  const bendsOf = rm => rm.edges.reduce((t, e) => t + Math.max(0, e.pts.length - 2), 0);
  const hasLane = (function f(c) { return c.items.some(i => i.type === 'lane' || (i.items && f(i))); })(model.root);
  if (hasLane && !env.TRACE_LAYOUT) {
    // A block is a grid, so its children are placed simply (no sliding to straighten links). When the
    // children are linked, ELK's normal placement can draw those links straighter; try both and keep the
    // better one, preferring the simple one unless the other wins by a margin.
    const cands = [];
    for (const lp of ['SIMPLE', 'NETWORK_SIMPLEX']) {
      const h = await layoutOnce(model, measure, ELK, false, true, false, undefined, lp);
      if (!h) break;
      cands.push({ lp, rm: h, cost: cost(h, bendsOf(h)) });
    }
    if (cands.length) {
      let best = cands[0];
      for (const c of cands.slice(1)) if (c.cost < best.cost * 0.97) best = c;
      return best === cands[cands.length - 1] ? best.rm : layoutOnce(model, measure, ELK, false, true, false, undefined, best.lp);
    }
    const rm = await layoutOnce(model, measure, ELK, false, false);
    rm.notes = ['This diagram could not be placed in the rows and columns you wrote, so they were ignored.'];
    return rm;
  }
  const forced = modes[env.TRACE_LAYOUT];
  if (forced) return (await layoutOnce(model, measure, ELK, forced[0], forced[1])) || layoutOnce(model, measure, ELK, false, false);
  const tried = [];
  let last = null;
  // A link written against the order of the nodes (a -> b, with b above a) makes a cycle. ELK can break
  // cycles by declaration order, which is what `<-` asks for by hand: when such a link exists, every
  // layout is also tried that way (it has to win by a margin, so a fine diagram keeps its layout).
  const order = [...model.nodes.keys()];
  const hasBack = model.edges.some(e => e.a !== e.b && order.indexOf(e.a) > order.indexOf(e.b));
  const cycles = hasBack && !env.TRACE_NOCYCLE ? [undefined, 'MODEL_ORDER'] : [undefined];
  // without frames the three ways are the same layout, so only the plain one is tried
  for (const m of model.frames.size ? ['hier', 'hierwrap', 'flat', 'compound'] : ['compound', 'hierwrap']) {
    // folding into rows is only tried for a strip much wider than it is tall
    if (m === 'hierwrap' && !(tried.length && tried[0].rm.width / tried[0].rm.height > 4 && !env.TRACE_NOWRAP)) continue;
    for (const cyc of cycles) {
      const rm = await layoutOnce(model, measure, ELK, modes[m][0], modes[m][1], modes[m][2], cyc);
      last = m + '|' + (cyc || '');
      if (!rm) continue;
      if (m !== 'compound' && !valid(rm)) { if (env.TRACE_DEBUG) console.error(m, cyc || '', 'INVALID'); continue; }
      const bends = rm.edges.reduce((t, e) => t + Math.max(0, e.pts.length - 2), 0);
      tried.push({ m, cyc, id: m + '|' + (cyc || ''), rm, bends, cost: cost(rm, bends) });
      if (env.TRACE_DEBUG) console.error(m, cyc || '', Math.round(rm.width) + 'x' + Math.round(rm.height), 'bends', bends, 'cost', cost(rm, bends).toFixed(1));
    }
  }
  let best = tried[0];
  // a later candidate has to win by a margin (3%, 8% for folding: its long return links are a real cost),
  // so a near tie keeps the earlier, simpler layout
  for (const c of tried.slice(1)) if (c.cost < best.cost * (c.m === 'hierwrap' ? 0.92 : 0.97)) best = c;
  // the model carries the state of the last run, so run the winner again if it was not last
  return best.id === last ? best.rm : layoutOnce(model, measure, ELK, modes[best.m][0], modes[best.m][1], modes[best.m][2], best.cyc);
}

async function layoutOnce(model, measure, ELK, FLAT, HIER, WRAP, CYC, LANEP) {
  const S = model.spacing;
  if (HIER && (model.edges.some(e => model.frames.has(e.a) || model.frames.has(e.b)))) return null;
  const flowH = model.direction === 'RIGHT';
  // inside a lane (per-frame layout only) the flow runs along the lane: a row left to right, a column downwards
  const fhOf = it => HIER && it.parent && it.parent.type === 'lane' ? it.parent.axis === 'h' : flowH;
  const sidesFor = fh => ({ IN: fh ? 'WEST' : 'NORTH', OUT: fh ? 'EAST' : 'SOUTH', PIN: fh ? 'NORTH' : 'WEST', POUT: fh ? 'SOUTH' : 'EAST' });
  for (const n of model.nodes.values()) sizeNode(n, measure);
  for (const f of model.frames.values()) f.titleW = f.title ? measure(f.title, FONT_TITLE) : 0;

  const groupOf = id => {
    const n = model.nodes.get(id);
    return n && n.parent && n.parent.type === 'group' ? n.parent : null;
  };
  const firstLeaf = fr => { for (const it of fr.items) { if (it.type === 'node') return it.id; if (it.type === 'group' && it.items.length) return 'G:' + it.id; if (it.type === 'frame' || it.type === 'lane') { const r = firstLeaf(it); if (r) return r; } } return null; };
  const elkId = id => model.frames.has(id) ? (FLAT ? firstLeaf(model.frames.get(id)) : 'F:' + id) : id;

  model.edges.forEach((e, i) => {
    e.i = i;
    e.stub = undefined;
    e.align = model.aligns.some(al => (al.a === e.a && al.b === e.b) || (al.a === e.b && al.b === e.a));
    e.lab = sizeLabel(e.label, measure);
    const railOf = id => model.rails.get(id) || (model.nodes.get(id) && model.nodes.get(id).parent && model.nodes.get(id).parent.type === 'rail' ? model.nodes.get(id).parent : null);
    e.rail = railOf(e.a) || railOf(e.b) || null;
    e.railFrom = !!e.rail && railOf(e.a) === e.rail;
    const ga = groupOf(e.a), gb = groupOf(e.b);
    e.intra = !!(ga && ga === gb);
    e.ga = ga; e.gb = gb;
  });

  // nodes stacked across the flow share one width (or height), like a table column
  for (const g of model.groups) {
    const fh = fhOf(g);
    if ((g.axis === 'v') !== fh || !g.items.length) continue;
    const real = g.items.filter(n => n.kind !== 'start');
    if (fh) { const w = Math.max(...real.map(n => n.w)); real.forEach(n => { n.w = w; }); }
    else { const h = Math.max(...real.map(n => n.h)); real.forEach(n => { n.h = h; }); }
  }

  // sibling columns (or rows) of the same length share slot sizes, so their members line up
  const slotMap = new Map();
  for (const g of model.groups) {
    const k = model.groups.indexOf(g.parent) + '|' + (g.parent.id || 'root') + '|' + g.axis + '|' + g.items.length;
    const along = n => g.axis === 'v' ? n.h : n.w;
    const cur = slotMap.get(k) || g.items.map(() => 0);
    g.items.forEach((n, i) => { cur[i] = Math.max(cur[i], along(n)); });
    slotMap.set(k, cur);
    g.slotKey = k;
  }

  // ---- stack each column/row by hand
  for (const g of model.groups) {
    const mem = g.items;
    const idx = new Map(mem.map((n, i) => [n.id, i]));
    g.idx = idx;
    const intra = model.edges.filter(e => e.intra && e.ga === g);
    g.intra = intra;
    const gaps = mem.slice(1).map(() => ({ lab: null, n: 0 }));
    let far = false, loops = new Set();
    for (const e of intra) {
      const i = idx.get(e.a), j = idx.get(e.b);
      if (i === j) { loops.add(i); continue; }
      if (Math.abs(i - j) === 1) {
        const k = Math.min(i, j), gp = gaps[k];
        gp.n++;
        if (e.lab && (!gp.lab || e.lab.w * e.lab.h > gp.lab.w * gp.lab.h)) gp.lab = e.lab;
      } else far = true;
    }
    g.far = far; g.loops = loops;
    const vert = g.axis === 'v';
    const along = n => vert ? n.h : n.w, across = n => vert ? n.w : n.h;
    const maxAcross = Math.max(...mem.map(across));
    let cross = maxAcross;
    for (const gp of gaps) {
      if (!gp.lab) continue;
      cross = Math.max(cross, vert ? 2 * (12 + gp.lab.w) : 2 * (gp.lab.h + 8));
    }
    if (loops.size) cross = Math.max(cross, maxAcross + 70);
    if (far) cross += 52;
    const slots = slotMap.get(g.slotKey);
    let pos = 0;
    mem.forEach((n, i) => {
      if (i > 0) {
        const gp = gaps[i - 1];
        const need = gp.lab ? (vert ? gp.lab.h + 18 : gp.lab.w + 26) : 0;
        pos += Math.max((vert ? 26 : 40) * S, need);
      }
      const c = (far ? 26 : 0) + (cross - (far ? 52 : 0)) / 2;
      const inset = (slots[i] - along(n)) / 2;
      if (vert) { n.rx = c - n.w / 2; n.ry = pos + inset; }
      else { n.rx = pos + inset; n.ry = c - n.h / 2; }
      pos += slots[i];
    });
    g.w = vert ? cross : pos;
    g.h = vert ? pos : cross;
    g.head = 0;
    if (g.title) {
      g.titleW = measure(g.title, FONT_NOTE);
      g.head = 22;
      for (const n of mem) n.ry += g.head;
      g.h += g.head;
      if (g.titleW + 8 > g.w) {
        const dx = (g.titleW + 8 - g.w) / 2;
        for (const n of mem) n.rx += dx;
        g.w = g.titleW + 8;
      }
    }
    g.ports = [];
  }

  // ---- align a b: pad one stack so the two members sit at the same offset from the top (or left) of
  // their stacks; with the link between them straightened, the stacks line up on that link
  model.alignNotes = [];
  model.alignPairs = [];
  const padded = new Set();
  for (const al of model.aligns) {
    const A = model.nodes.get(al.a), B = model.nodes.get(al.b);
    const ga = A && A.parent && A.parent.type === 'group' ? A.parent : null;
    const gb = B && B.parent && B.parent.type === 'group' ? B.parent : null;
    if (!ga || !gb) { model.alignNotes.push(`align ${al.a} ${al.b}: only nodes in a row or column can be aligned this way (the layout tries to keep the link straight)`); continue; }
    if (ga === gb) { model.alignNotes.push(`align ${al.a} ${al.b}: both are in the same ${ga.axis === 'v' ? 'column' : 'row'}, so they are already in line`); continue; }
    if ((ga.axis === 'v') !== (gb.axis === 'v')) { model.alignNotes.push(`align ${al.a} ${al.b}: one is in a row and the other in a column`); continue; }
    if (padded.has(ga) || padded.has(gb)) { model.alignNotes.push(`align ${al.a} ${al.b}: one of these stacks is already lined up with another; only one pair per two stacks can be level`); continue; }
    const vert = ga.axis === 'v';
    const mid = n => vert ? n.ry + n.h / 2 : n.rx + n.w / 2;
    const d = mid(A) - mid(B);
    const [g, delta] = d > 0 ? [gb, d] : [ga, -d];
    for (const n of g.items) { if (vert) n.ry += delta; else n.rx += delta; }
    if (vert) g.h += delta; else g.w += delta;
    padded.add(ga); padded.add(gb);
    model.alignPairs.push({ A, B, ga, gb, vert });
  }

  // ---- [span] nodes grow to the height (or width) of the column (or row) they feed
  for (const n of model.nodes.values()) {
    if (!n.tags.includes('span') || (n.parent && n.parent.type === 'group')) continue;
    let best = null;
    const fh = fhOf(n);
    for (const e of model.edges) {
      const other = e.a === n.id ? e.b : e.b === n.id ? e.a : null;
      if (!other) continue;
      const g = groupOf(other);
      if (!g || (g.axis === 'v') !== fh) continue;
      const first = g.items[0], last = g.items[g.items.length - 1];
      const ext = fh ? (last.ry + last.h) - first.ry : (last.rx + last.w) - first.rx;
      // size to the stack this node feeds (links that leave it) when there is one, so those links run
      // straight; a stack that feeds it only counts when nothing is downstream
      const out = e.a === n.id;
      if (!best || (out && !best.out) || (out === best.out && ext > best.ext)) best = { g, ext, start: fh ? first.ry : first.rx, out };
    }
    if (!best) continue;
    if (fh) n.h = Math.max(n.h, Math.round(best.ext));
    else n.w = Math.max(n.w, Math.round(best.ext));
    n.span = best;
    n.ports = [];
  }

  // ---- ports where links leave a group
  const { IN, OUT } = sidesFor(flowH);
  const portBuckets = new Map();
  function addPort(e, end) {
    const id = end === 's' ? e.a : e.b;
    const g = groupOf(id);
    const sn = model.nodes.get(id);
    if (!g && sn && sn.span) {
      const fh = fhOf(sn), { IN, OUT } = sidesFor(fh);
      const otherId = end === 's' ? e.b : e.a;
      const om = model.nodes.get(otherId);
      const og = groupOf(otherId);
      const side = end === 's' ? OUT : IN;
      let along = (fh ? sn.h : sn.w) / 2;
      if (og && om && og === sn.span.g) {
        along = fh ? om.ry + om.h / 2 - sn.span.start : om.rx + om.w / 2 - sn.span.start;
      } else if (og && om && (og.axis === 'v') === fh && og.items.length > 1) {
        // another stack on the other side: spread its links in proportion, so they meet it nearly level
        const f = og.items[0], l = og.items[og.items.length - 1];
        const s0 = fh ? f.ry : f.rx, ext = fh ? l.ry + l.h - f.ry : l.rx + l.w - f.rx;
        const c = fh ? om.ry + om.h / 2 : om.rx + om.w / 2;
        along = (c - s0) / ext * (fh ? sn.h : sn.w);
      }
      const pid = `P${e.i}${end}`;
      const p = { id: pid, width: 0, height: 0, layoutOptions: { 'elk.port.side': side } };
      if (side === 'WEST') { p.x = 0; p.y = along; }
      if (side === 'EAST') { p.x = sn.w; p.y = along; }
      if (side === 'NORTH') { p.x = along; p.y = 0; }
      if (side === 'SOUTH') { p.x = along; p.y = sn.h; }
      sn.ports.push(p);
      return pid;
    }
    if (!g) return elkId(id);
    const n = model.nodes.get(id), i = g.idx.get(id), last = g.items.length - 1;
    const fh = fhOf(g), { IN, OUT, PIN, POUT } = sidesFor(fh);
    const rank = (g.axis === 'v') === fh; // stacked across the flow
    let side;
    if (rank) side = end === 's' ? OUT : IN;
    else if (end === 't') side = i === 0 ? IN : PIN;
    else side = i === last ? OUT : POUT;
    const pid = `P${e.i}${end}`;
    const key = id + '|' + side;
    if (!portBuckets.has(key)) portBuckets.set(key, { g, n, side, ports: [] });
    portBuckets.get(key).ports.push(pid);
    e.stub = e.stub || {};
    e.stub[end] = { node: n, side };
    return pid;
  }
  const elkEdges = [];
  for (const e of model.edges) {
    if (e.intra || e.rail) continue;
    const src = addPort(e, 's'), tgt = addPort(e, 't');
    e.srcBase = src; e.tgtBase = tgt;
    const ee = { id: 'E' + e.i, sources: [src], targets: [tgt] };
    if (e.align) ee.layoutOptions = { 'elk.layered.priority.straightness': '100' };
    if (e.lab) {
      const L = { id: 'L' + e.i, text: e.label.replace(/\n/g, ' '), width: e.lab.w, height: e.lab.h };
      ee.labels = [L];
    }
    elkEdges.push(ee);
  }
  for (const b of portBuckets.values()) {
    const { g, n, side, ports } = b;
    const horizSide = side === 'NORTH' || side === 'SOUTH';
    const extent = horizSide ? n.w : n.h;
    const center = horizSide ? n.rx + n.w / 2 : n.ry + n.h / 2;
    const step = Math.min(14, (extent - 12) / Math.max(1, ports.length - 1));
    ports.forEach((pid, k) => {
      const off = (k - (ports.length - 1) / 2) * step;
      const along = center + off;
      const p = { id: pid, width: 0, height: 0, layoutOptions: { 'elk.port.side': side } };
      if (side === 'WEST') { p.x = 0; p.y = along; }
      if (side === 'EAST') { p.x = g.w; p.y = along; }
      if (side === 'NORTH') { p.x = along; p.y = 0; }
      if (side === 'SOUTH') { p.x = along; p.y = g.h; }
      g.ports.push(p);
    });
  }

  // ---- ELK graph
  function build(container) {
    const out = [];
    for (const it of container.items) {
      if (it.type === 'node') {
        const en = { id: it.id, width: it.w, height: it.h };
        if (it.span) { en.ports = it.ports; en.layoutOptions = { 'elk.portConstraints': 'FIXED_POS' }; }
        out.push(en);
      }
      else if ((it.type === 'frame' && FLAT) || it.type === 'lane') { out.push(...build(it)); }
      else if (it.type === 'frame') {
        out.push({
          id: 'F:' + it.id,
          layoutOptions: {
            'elk.padding': `[top=${it.title ? 34 : 18},left=18,bottom=18,right=18]`,
            'elk.nodeSize.constraints': 'MINIMUM_SIZE',
            'elk.nodeSize.minimum': `(${Math.ceil(it.titleW + 36)}, 60)`,
          },
          children: build(it),
        });
      } else if (it.type === 'group') {
        if (!it.items.length) continue;
        out.push({ id: 'G:' + it.id, width: it.w, height: it.h, ports: it.ports,
          layoutOptions: { 'elk.portConstraints': 'FIXED_POS' } });
      }
    }
    return out;
  }
  const sp = v => String(Math.round(v * S));
  const graph = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': model.direction,
      'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.padding': '[top=16,left=16,bottom=16,right=16]',
      'elk.spacing.nodeNode': sp(30),
      'elk.layered.spacing.nodeNodeBetweenLayers': sp(44),
      'elk.spacing.edgeNode': sp(18),
      'elk.spacing.edgeEdge': sp(14),
      'elk.layered.spacing.edgeNodeBetweenLayers': sp(14),
      'elk.layered.spacing.edgeEdgeBetweenLayers': sp(12),
      'elk.spacing.edgeLabel': '4',
      'elk.layered.edgeLabels.sideSelection': 'ALWAYS_UP',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      ...(CYC ? { 'elk.layered.cycleBreaking.strategy': CYC } : {}),
      'elk.layered.thoroughness': '30',
      'elk.layered.unnecessaryBendpoints': 'true',
    },
    children: build(model.root),
    edges: elkEdges,
  };
  const elk = new ELK();
  const res = HIER ? await hierLayout() : await elk.layout(graph);
  if (!res) return null;

  // ---- read positions back
  const rm = { nodes: [], frames: [], edges: [], width: res.width, height: res.height, model };
  const abs = new Map();
  (function walk(list, ox, oy, depth) {
    for (const c of list || []) {
      const x = ox + c.x, y = oy + c.y;
      abs.set(c.id, { x, y, w: c.width, h: c.height });
      if (c.id.startsWith('F:')) rm.frames.push({ f: model.frames.get(c.id.slice(2)), x, y, w: c.width, h: c.height, depth });
      walk(c.children, x, y, depth + 1);
    }
  })(res.children, 0, 0, 0);
  for (const n of model.nodes.values()) {
    const g = n.parent.type === 'group' ? n.parent : null;
    if (g) {
      const ga = abs.get('G:' + g.id);
      if (!ga) continue;
      n.x = ga.x + n.rx; n.y = ga.y + n.ry;
    } else {
      const a = abs.get(n.id);
      if (!a) continue;
      n.x = a.x; n.y = a.y;
    }
    rm.nodes.push(n);
  }
  for (const g of model.groups) {
    const ga = abs.get('G:' + g.id);
    if (ga) { g.x = ga.x; g.y = ga.y; }
  }
  if (FLAT) (function fl(c, depth) { for (const it of c.items) if (it.type === 'frame') { rm.frames.push({ f: it, x: 0, y: 0, w: 0, h: 0, depth }); fl(it, depth + 1); } })(model.root, 0);
  rm.frames.sort((a, b) => a.depth - b.depth);

  const byId = new Map((res.edges || []).map(e => [e.id, e]));
  for (const e of model.edges) {
    let pts, lab = null;
    if (e.intra) {
      ({ pts, lab } = intraRoute(e));
    } else {
      const r = byId.get('E' + e.i);
      if (!r || !r.sections || !r.sections.length) continue;
      const co = r.container && r.container !== 'root' ? abs.get(r.container) : { x: 0, y: 0 };
      const mv = p => ({ x: p.x + co.x, y: p.y + co.y });
      pts = [];
      for (const s of r.sections) {
        if (!pts.length) pts.push(mv(s.startPoint));
        pts.push(...(s.bendPoints || []).map(mv), mv(s.endPoint));
      }
      const viaPts = st => { const O = abs.get('F:' + st.T.id); return [{ x: O.x + st.via.corner.x, y: O.y + st.via.corner.y }, { x: O.x + st.via.border.x, y: O.y + st.via.border.y }]; };
      if (e.stub && e.stub.s) pts.unshift(...(e.stub.s.via ? viaPts(e.stub.s).reverse() : [stubPoint(e.stub.s, pts[0])]));
      if (e.stub && e.stub.t) pts.push(...(e.stub.t.via ? viaPts(e.stub.t) : [stubPoint(e.stub.t, pts[pts.length - 1])]));
      if (e.lab && r.labels && r.labels[0]) {
        const L = r.labels[0];
        lab = { x: co.x + L.x + L.width / 2, y: co.y + L.y, anchor: 'middle' };
      }
      const self = e.a === e.b && model.nodes.get(e.a);
      if (self && !e.stub) {
        // ELK's self-loops hug the box; draw a roomier loop on the side ELK chose
        const n = self, mx = pts.reduce((t, p) => t + p.x, 0) / pts.length, my = pts.reduce((t, p) => t + p.y, 0) / pts.length;
        const cx = n.x + n.w / 2, cy = n.y + n.h / 2, R = 30, half = Math.min(10, n.h / 3);
        const side = mx < n.x ? 'W' : mx > n.x + n.w ? 'E' : my < n.y ? 'N' : 'S';
        if (side === 'W') { pts = [{ x: n.x, y: cy - half }, { x: n.x - R, y: cy - half }, { x: n.x - R, y: cy + half }, { x: n.x, y: cy + half }]; if (e.lab) lab = { x: n.x - R - 6, y: cy - e.lab.h / 2, anchor: 'end' }; }
        if (side === 'E') { pts = [{ x: n.x + n.w, y: cy - half }, { x: n.x + n.w + R, y: cy - half }, { x: n.x + n.w + R, y: cy + half }, { x: n.x + n.w, y: cy + half }]; if (e.lab) lab = { x: n.x + n.w + R + 6, y: cy - e.lab.h / 2, anchor: 'start' }; }
        if (side === 'N') { pts = [{ x: cx - 12, y: n.y }, { x: cx - 12, y: n.y - R }, { x: cx + 12, y: n.y - R }, { x: cx + 12, y: n.y }]; if (e.lab) lab = { x: cx, y: n.y - R - 4 - e.lab.h, anchor: 'middle' }; }
        if (side === 'S') { pts = [{ x: cx - 12, y: n.y + n.h }, { x: cx - 12, y: n.y + n.h + R }, { x: cx + 12, y: n.y + n.h + R }, { x: cx + 12, y: n.y + n.h }]; if (e.lab) lab = { x: cx, y: n.y + n.h + R + 4, anchor: 'middle' }; }
      }
    }
    rm.edges.push({ e, pts, lab });
  }
  compactBridges(rm, model, flowH);
  if (!HIER) straightenSpans(rm, model, flowH);
  alignRows(rm, model);
  fitFrames(rm, model, flowH);
  placeRails(rm, model, flowH);
  return rm;

  // ---- per-frame layout (see docs/roadmap.md, item 2). Frames are laid out bottom-up, each by
  // its own ELK run; a finished frame is an opaque node with fixed ports in its parent's run.
  // The result is returned in the shape of one hierarchical ELK result, so the read-back above
  // is shared. Returns null when a link cannot reach its member in a straight line.
  async function hierLayout() {
    // a [bridge] stays inside its frame's run; fitFrames later moves the frame border to its centre
    const lifted = () => false;
    const effPar = c => c.parent;
    // containers: frames, and lanes (a row or column holding frames), which draw nothing
    const isBox = p => p.type === 'frame' || p.type === 'lane';
    const prefix = c => c.type === 'lane' ? 'L:' : 'F:';
    const chainOf = n => { const a = []; for (let p = effPar(n); p; p = p.parent) if (isBox(p)) a.unshift(p); return a; };
    const frames = [];
    (function coll(c) { for (const it of c.items) if (isBox(it)) { coll(it); frames.push(it); } })(model.root);
    const frameById = new Map(frames.map(f => [prefix(f) + f.id, f]));
    const dirOf = Fr => Fr && Fr.type === 'lane' ? Fr.axis === 'h' : flowH;
    const chains = new Map([...model.nodes.values()].map(n => [n, chainOf(n)]));
    const lay = new Map();
    const byL = new Map();
    for (const e of model.edges) {
      if (e.intra || e.rail) continue;
      const ca = chains.get(model.nodes.get(e.a)), cb = chains.get(model.nodes.get(e.b));
      let k = 0;
      while (k < ca.length && k < cb.length && ca[k] === cb[k]) k++;
      e.h = { sa: ca[k] || null, sb: cb[k] || null };
      const key = k ? ca[k - 1] : null;
      if (!byL.has(key)) byL.set(key, []);
      byL.get(key).push(e);
    }
    const idOf = c => c.type === 'node' ? c.id : c.type === 'group' ? 'G:' + c.id : prefix(c) + c.id;
    function relPos(Fr, n) {
      let c = n;
      while (effPar(c) !== Fr) c = effPar(c);
      const q = lay.get(Fr).pos.get(idOf(c));
      if (c.type === 'node') return { x: q.x, y: q.y };
      if (c.type === 'group') return { x: q.x + n.rx, y: q.y + n.ry };
      const r = relPos(c, n);
      return { x: q.x + r.x, y: q.y + r.y };
    }
    const sp2 = v => String(Math.round(v * S));
    const baseOpts = (pad, dirH) => ({
      'elk.algorithm': 'layered', 'elk.direction': dirH ? 'RIGHT' : 'DOWN', 'elk.edgeRouting': 'ORTHOGONAL',
      'elk.padding': pad,
      'elk.spacing.nodeNode': sp2(30), 'elk.layered.spacing.nodeNodeBetweenLayers': sp2(44),
      'elk.spacing.edgeNode': sp2(18), 'elk.spacing.edgeEdge': sp2(14),
      'elk.layered.spacing.edgeNodeBetweenLayers': sp2(14), 'elk.layered.spacing.edgeEdgeBetweenLayers': sp2(12),
      'elk.spacing.edgeLabel': '4', 'elk.layered.edgeLabels.sideSelection': 'ALWAYS_UP',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
      ...(CYC ? { 'elk.layered.cycleBreaking.strategy': CYC } : {}),
      'elk.layered.thoroughness': '30', 'elk.layered.unnecessaryBendpoints': 'true',
    });
    // a port on frame T where link e reaches member m: a straight, unobstructed line to m
    function portFor(T, e, end, m, reqs, dirH) {
      const { IN: IN_, OUT: OUT_ } = sidesFor(dirH);
      const rects = [];
      for (const [n, ch] of chains) if (n !== m && ch.includes(T)) { const r = relPos(T, n); rects.push({ x: r.x, y: r.y, w: n.w, h: n.h }); }
      const mp = relPos(T, m), cx = mp.x + m.w / 2, cy = mp.y + m.h / 2, W = lay.get(T).w;
      const cross = dirH ? ['NORTH', 'SOUTH'] : ['WEST', 'EAST'];
      if ((dirH ? cy : cx) > (dirH ? lay.get(T).h : W) / 2) cross.reverse();
      const sides = [end === 's' ? OUT_ : IN_, ...cross];
      const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      for (const side of sides) {
        let ray;
        if (side === 'WEST') ray = { x: 0, y: cy - 8, w: mp.x, h: 16 };
        else if (side === 'EAST') ray = { x: mp.x + m.w, y: cy - 8, w: W, h: 16 };
        else if (side === 'NORTH') ray = { x: cx - 8, y: 0, w: 16, h: mp.y };
        else ray = { x: cx - 8, y: mp.y + m.h, w: 16, h: lay.get(T).h };
        if (rects.some(r => hit(ray, r))) continue;
        const rq = { T, e, end, m, side, mp };
        reqs.push(rq);
        return rq;
      }
      // blocked: run along the frame's inner margin instead, then turn into the member's side
      const Lt = lay.get(T);
      const Wa = dirH ? Lt.w : Lt.h, Ca = dirH ? Lt.h : Lt.w;
      const pt = (a, c) => dirH ? { x: a, y: c } : { x: c, y: a };
      const ma0 = dirH ? mp.x : mp.y, ma1 = ma0 + (dirH ? m.w : m.h), c0 = dirH ? cy : cx;
      const margins = end === 's' ? ['far', 'near'] : ['near', 'far'];
      for (const margin of margins) {
        const a = margin === 'near' ? 9 : Wa - 9;
        if (a > ma0 - 6 && a < ma1 + 6) continue;
        for (const side of cross) {
          const first = side === 'NORTH' || side === 'WEST';
          const cb = first ? 0 : Ca;
          const seg1 = dirH ? { x: a - 5, y: Math.min(cb, c0), w: 10, h: Math.abs(c0 - cb) } : { x: Math.min(cb, c0), y: a - 5, w: Math.abs(c0 - cb), h: 10 };
          const f0 = Math.min(a, margin === 'near' ? ma0 : ma1), f1 = Math.max(a, margin === 'near' ? ma0 : ma1);
          const seg2 = dirH ? { x: f0, y: c0 - 8, w: f1 - f0, h: 16 } : { x: c0 - 8, y: f0, w: 16, h: f1 - f0 };
          if (rects.some(r => hit(seg1, r) || hit(seg2, r))) continue;
          const rq = { T, e, end, m, side, mp, fixed: pt(a, cb), via: { corner: pt(a, c0), border: pt(margin === 'near' ? ma0 : ma1, c0) } };
          reqs.push(rq);
          return rq;
        }
      }
      return null;
    }
    async function layoutFrame(Fr) {
      const items = Fr ? Fr.items : model.root.items;
      const dirH = dirOf(Fr);
      const reqs = [];
      const edgeEnds = [];
      for (const e of byL.get(Fr || null) || []) {
        const ends = {};
        for (const end of ['s', 't']) {
          const T = end === 's' ? e.h.sa : e.h.sb;
          const m = model.nodes.get(end === 's' ? e.a : e.b);
          if (!T) { ends[end] = end === 's' ? e.srcBase : e.tgtBase; continue; }
          const rq = portFor(T, e, end, m, reqs, dirH);
          if (!rq) return null;
          rq.pid = `P${e.i}${end}`;
          ends[end] = rq.pid;
          e.stub = e.stub || {};
          e.stub[end] = { node: m, side: rq.side, T: rq.via ? rq.T : null, via: rq.via };
        }
        edgeEnds.push([e, ends]);
      }
      // spread links that reach the same member from the same side
      const buckets = new Map();
      for (const rq of reqs) { const k = rq.T.id + '|' + rq.side + '|' + rq.m.id + (rq.via ? '|via' : ''); (buckets.get(k) || buckets.set(k, []).get(k)).push(rq); }
      const eports = new Map();
      for (const list of buckets.values()) {
        list.forEach((rq, i) => {
          const horiz = rq.side === 'NORTH' || rq.side === 'SOUTH';
          const ext = horiz ? rq.m.w : rq.m.h;
          const step = Math.min(12, (ext - 10) / Math.max(1, list.length - 1));
          const off = (i - (list.length - 1) / 2) * step;
          const T = rq.T, L = lay.get(T);
          const p = { id: rq.pid, width: 0, height: 0, layoutOptions: { 'elk.port.side': rq.side } };
          if (rq.fixed) { p.x = rq.fixed.x; p.y = rq.fixed.y; if (!eports.has(T)) eports.set(T, []); eports.get(T).push(p); return; }
          // a [span] node has its own attachment point for each link (level with the member of the stack
          // on the other end); the port on the frame lines up with it so the link runs straight
          const sp = rq.m.span && rq.m.ports && rq.m.ports.find(q => q.id === rq.pid);
          const alongX = sp ? rq.mp.x + sp.x : rq.mp.x + rq.m.w / 2 + off;
          const alongY = sp ? rq.mp.y + sp.y : rq.mp.y + rq.m.h / 2 + off;
          if (rq.side === 'WEST') { p.x = 0; p.y = alongY; }
          if (rq.side === 'EAST') { p.x = L.w; p.y = alongY; }
          if (rq.side === 'NORTH') { p.x = alongX; p.y = 0; }
          if (rq.side === 'SOUTH') { p.x = alongX; p.y = L.h; }
          if (!eports.has(T)) eports.set(T, []);
          eports.get(T).push(p);
        });
      }
      const children = [];
      const here = items.filter(it => !lifted(it));
      for (const it of items) if (it.type === 'frame') for (const b of it.items) if (lifted(b)) here.push(b);
      const isLane = Fr && Fr.type === 'lane';
      for (const it of here) {
        const part = isLane ? { 'elk.partitioning.partition': String(items.indexOf(it)) } : {};
        if (it.type === 'node') {
          const en = { id: it.id, width: it.w, height: it.h };
          en.layoutOptions = { ...part, ...(it.span ? { 'elk.portConstraints': 'FIXED_POS' } : {}) };
          if (it.span) en.ports = it.ports;
          children.push(en);
        } else if (it.type === 'group') {
          if (it.items.length) children.push({ id: 'G:' + it.id, width: it.w, height: it.h, ports: it.ports, layoutOptions: { ...part, 'elk.portConstraints': 'FIXED_POS' } });
        } else if (isBox(it)) {
          const L = lay.get(it);
          children.push({ id: prefix(it) + it.id, width: L.w, height: L.h, ports: eports.get(it) || [], layoutOptions: { ...part, 'elk.portConstraints': 'FIXED_POS' } });
        }
      }
      const edges = edgeEnds.map(([e, ends]) => {
        const ee = { id: 'E' + e.i, sources: [ends.s], targets: [ends.t] };
        if (e.align) ee.layoutOptions = { 'elk.layered.priority.straightness': '100' };
        if (e.lab) ee.labels = [{ id: 'L' + e.i, text: e.label.replace(/\n/g, ' '), width: e.lab.w, height: e.lab.h }];
        return ee;
      });
      const pad = isLane ? '[top=0,left=0,bottom=0,right=0]' : Fr ? `[top=${Fr.title ? 34 : 18},left=18,bottom=18,right=18]` : '[top=16,left=16,bottom=16,right=16]';
      const opts = baseOpts(pad, dirH);
      if (!Fr && WRAP) {
        // fold a long chain of layers into rows; the long return links are the price
        opts['elk.layered.wrapping.strategy'] = 'MULTI_EDGE';
        opts['elk.aspectRatio'] = '2';
      }
      if (isLane) {
        opts['elk.partitioning.activate'] = 'true';
        // a lane is a grid, not a flow diagram: line its children up instead of sliding them to straighten links
        opts['elk.layered.nodePlacement.strategy'] = LANEP || 'SIMPLE';
        opts['elk.separateConnectedComponents'] = 'false'; // unlinked children still follow the lane's order
      }
      const r = await elk.layout({ id: Fr ? prefix(Fr) + Fr.id : 'root', layoutOptions: opts, children, edges });
      const minW = Fr && !isLane ? Math.ceil(Fr.titleW + 36) : 0;
      const w = Math.max(r.width, minW), dx = (w - r.width) / 2;
      const pos = new Map(r.children.map(c => [c.id, { x: c.x + dx, y: c.y }]));
      lay.set(Fr || null, { res: r, w, h: r.height, dx, pos });
      return true;
    }
    for (const Fr of frames) if (!(await layoutFrame(Fr))) return null;
    if (!(await layoutFrame(null))) return null;
    const synth = [];
    function assemble(Fr, ox, oy) {
      const L = lay.get(Fr || null), r = L.res;
      const kids = r.children.map(c => {
        const o = { id: c.id, x: c.x + L.dx, y: c.y, width: c.width, height: c.height };
        if (c.id.startsWith('F:') || c.id.startsWith('L:')) o.children = assemble(frameById.get(c.id), ox + o.x, oy + o.y);
        return o;
      });
      const mv = p => ({ x: p.x + ox + L.dx, y: p.y + oy });
      for (const ed of r.edges || []) {
        synth.push({
          id: ed.id, container: 'root',
          sections: (ed.sections || []).map(sc => ({ startPoint: mv(sc.startPoint), endPoint: mv(sc.endPoint), bendPoints: (sc.bendPoints || []).map(mv) })),
          labels: (ed.labels || []).map(l => ({ ...l, x: l.x + ox + L.dx, y: l.y + oy })),
        });
      }
      return kids;
    }
    const kids = assemble(null, 0, 0);
    const R = lay.get(null).res;
    return { id: 'root', width: R.width, height: R.height, children: kids, edges: synth };
  }

  function stubPoint(st, p) {
    const n = st.node;
    if (st.side === 'WEST') return { x: n.x, y: p.y };
    if (st.side === 'EAST') return { x: n.x + n.w, y: p.y };
    if (st.side === 'NORTH') return { x: p.x, y: n.y };
    return { x: p.x, y: n.y + n.h };
  }

  function intraRoute(e) {
    const g = e.ga, A = model.nodes.get(e.a), B = model.nodes.get(e.b);
    const i = g.idx.get(e.a), j = g.idx.get(e.b);
    const vert = g.axis === 'v';
    const twins = g.intra.filter(o => o !== e && Math.min(g.idx.get(o.a), g.idx.get(o.b)) === Math.min(i, j) && Math.max(g.idx.get(o.a), g.idx.get(o.b)) === Math.max(i, j));
    let off = 0;
    if (twins.length) off = (g.intra.filter(o => twins.includes(o) || o === e).indexOf(e) - twins.length / 2) * 14;
    if (i === j) {
      if (vert) {
        const x = A.x + A.w, y = A.y + A.h / 2;
        return { pts: [{ x, y: y - 8 }, { x: x + 26, y: y - 8 }, { x: x + 26, y: y + 8 }, { x, y: y + 8 }], lab: e.lab && { x: x + 32, y: y - e.lab.h / 2, anchor: 'start' } };
      }
      const x = A.x + A.w / 2, y = A.y;
      return { pts: [{ x: x - 10, y }, { x: x - 10, y: y - 24 }, { x: x + 10, y: y - 24 }, { x: x + 10, y }], lab: e.lab && { x, y: y - 28 - e.lab.h, anchor: 'middle' } };
    }
    if (Math.abs(i - j) === 1) {
      if (vert) {
        const x = A.x + A.w / 2 + off;
        const down = j > i;
        const y1 = down ? A.y + A.h : A.y, y2 = down ? B.y : B.y + B.h;
        return { pts: [{ x, y: y1 }, { x, y: y2 }], lab: e.lab && { x: x + 8, y: (y1 + y2) / 2 - e.lab.h / 2, anchor: 'start' } };
      }
      const y = A.y + A.h / 2 + off;
      const right = j > i;
      const x1 = right ? A.x + A.w : A.x, x2 = right ? B.x : B.x + B.w;
      return { pts: [{ x: x1, y }, { x: x2, y }], lab: e.lab && { x: (x1 + x2) / 2, y: y - 6 - e.lab.h, anchor: 'middle' } };
    }
    if (vert) {
      const lx = g.x + 10;
      const ya = A.y + A.h / 2, yb = B.y + B.h / 2;
      return { pts: [{ x: A.x, y: ya }, { x: lx, y: ya }, { x: lx, y: yb }, { x: B.x, y: yb }], lab: e.lab && { x: lx + 6, y: (ya + yb) / 2 - e.lab.h / 2, anchor: 'start' } };
    }
    const ly = g.y + g.h - 10;
    const xa = A.x + A.w / 2, xb = B.x + B.w / 2;
    return { pts: [{ x: xa, y: A.y + A.h }, { x: xa, y: ly }, { x: xb, y: ly }, { x: xb, y: B.y + B.h }], lab: e.lab && { x: (xa + xb) / 2, y: ly - 4 - e.lab.h, anchor: 'middle' } };
  }
}

// Where a [bridge] node sits on a frame border, ELK has left room for two frame paddings
// and the gap between frames. Squeeze that empty strip so the bridge sits close to what feeds it.
function frameOfItem(it) { let p = it.parent; while (p && p.type !== 'frame') p = p.parent; return p || null; }
function bridgePartner(n, model, flowH) {
  const A = flowH ? 'x' : 'y';
  const F = frameOfItem(n);
  if (!F) return null;
  const within = (a, b) => { for (let p = a; p; p = p.parent) if (p === b) return true; return false; };
  for (const e of model.edges) {
    const other = e.a === n.id ? e.b : e.b === n.id ? e.a : null;
    if (!other) continue;
    const on = model.nodes.get(other);
    const Q = on ? frameOfItem(on) : model.frames.get(other) || null;
    if (!Q || within(Q, F) || within(F, Q)) continue;
    const end = contentEnd(Q, flowH);
    // the two frames must be level: a frame in another row or column of a lane shares no border
    const X = flowH ? 'y' : 'x', XS = flowH ? 'h' : 'w';
    const [q0, q1] = contentSpan(Q, X, XS);
    const level = q1 > n[X] && q0 < n[X] + n[XS];
    if (level && end !== -Infinity && end <= n[A]) return { F, Q, end };
  }
  return null;
}
function contentSpan(fr, A, SZ) {
  let lo = Infinity, hi = -Infinity;
  for (const it of leafItems(fr)) {
    if ((it.type === 'node' || it.type === 'group') && it[A] !== undefined) { lo = Math.min(lo, it[A]); hi = Math.max(hi, it[A] + it[SZ]); }
    else if (it.type === 'frame') { const [a, b] = contentSpan(it, A, SZ); lo = Math.min(lo, a); hi = Math.max(hi, b); }
  }
  return [lo, hi];
}
function* leafItems(c) { for (const it of c.items) { if (it.type === 'lane') yield* leafItems(it); else yield it; } }
function contentEnd(fr, flowH) {
  const A = flowH ? 'x' : 'y', SZ = flowH ? 'w' : 'h';
  let m = -Infinity;
  for (const it of leafItems(fr)) {
    if ((it.type === 'node' || it.type === 'group') && it[A] !== undefined) m = Math.max(m, it[A] + it[SZ]);
    else if (it.type === 'frame') m = Math.max(m, contentEnd(it, flowH));
  }
  return m;
}
function compactBridges(rm, model, flowH) {
  const A = flowH ? 'x' : 'y', SZ = flowH ? 'w' : 'h';
  const strips = [];
  for (const n of model.nodes.values()) {
    if (!n.tags.includes('bridge') || n[A] === undefined) continue;
    const bp = bridgePartner(n, model, flowH);
    if (bp) strips.push([bp.end, n[A]]);
  }
  if (!strips.length) return;
  // everything that occupies a stretch along the flow axis
  const occ = [];
  for (const n of rm.nodes) occ.push([n[A], n[A] + n[SZ]]);
  for (const g of model.groups) if (g[A] !== undefined) occ.push([g[A], g[A] + g[SZ]]);
  for (const { e, pts, lab } of rm.edges) {
    if (lab && e.lab) {
      if (flowH) { const x0 = lab.anchor === 'middle' ? lab.x - e.lab.w / 2 : lab.x; occ.push([x0, x0 + e.lab.w]); }
      else occ.push([lab.y, lab.y + e.lab.h]);
    }
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1], q = pts[i];
      if (Math.abs(p[A] - q[A]) < 0.5) occ.push([p[A], p[A]]);
    }
  }
  const cuts = [];
  for (const [lo, hi] of strips) {
    const inside = occ.filter(([a, b]) => b > lo + 0.5 && a < hi - 0.5).map(([a, b]) => [Math.max(a, lo), Math.min(b, hi)]).sort((u, v) => u[0] - v[0]);
    const T = inside.length ? 18 : 40;
    let cur = lo;
    const gaps = [];
    for (const [a, b] of inside) { if (a > cur) gaps.push([cur, a]); cur = Math.max(cur, b); }
    if (hi > cur) gaps.push([cur, hi]);
    for (const [a, b] of gaps) if (b - a > T) cuts.push({ from: a, at: b, d: b - a - T });
  }
  // apply from the far end so earlier cuts stay valid
  const uniq = [...new Map(cuts.map(c => [Math.round(c.at), c])).values()].sort((u, v) => v.at - u.at);
  for (const { from, at, d } of uniq) {
    const k = 1 - d / (at - from);
    const mv = o => {
      if (o[A] >= at - 0.5) o[A] -= d;
      else if (o[A] > from) o[A] = from + (o[A] - from) * k; // a bend inside the strip shrinks with it
    };
    for (const n of model.nodes.values()) if (n[A] !== undefined) mv(n);
    for (const g of model.groups) if (g[A] !== undefined) mv(g);
    for (const { pts, lab } of rm.edges) { pts.forEach(mv); if (lab) mv(lab); }
    for (const fr of rm.frames) mv(fr);
    if (flowH) rm.width -= d; else rm.height -= d;
  }
}

// align a b: the stacks were padded so the two nodes sit at the same offset, and the link between them
// was made straight, but ELK still leaves them a few pixels apart (long links put placeholder nodes in
// the layers). Slide one stack the last bit, re-route the links that touch it with a small step, and
// draw the link between the two nodes as a straight line. A pair that cannot be slid without touching
// a node or crossing a link is left as it is, and said so.
function alignRows(rm, model) {
  for (const al of model.alignPairs || []) {
    const { A, B, ga, gb, vert } = al;
    if (A.x === undefined || B.x === undefined) continue;
    const X = vert ? 'y' : 'x', Y = vert ? 'x' : 'y', W = vert ? 'h' : 'w';
    const mid = n => n[X] + n[W] / 2;
    const d = mid(A) - mid(B);
    if (Math.abs(d) >= 0.5) {
      let done = false;
      for (const [g, dd] of [[gb, d], [ga, -d]]) {
        const inRegion = it => it.parent === g;
        const box = { x: g.x, y: g.y, w: g.w, h: g.h };
        const moved = { ...box, [X]: box[X] + dd };
        const hits = [...model.nodes.values()].some(o => o.x !== undefined && !inRegion(o) &&
          o.x < moved.x + moved.w && moved.x < o.x + o.w && o.y < moved.y + moved.h && moved.y < o.y + o.h);
        if (hits) continue;
        const inside = p => p.x >= box.x - 0.5 && p.x <= box.x + box.w + 0.5 && p.y >= box.y - 0.5 && p.y <= box.y + box.h + 0.5;
        const cuts = rm.edges.some(r => {
          if (r.pts.some(inside)) return false;
          for (let i = 1; i < r.pts.length; i++) {
            const p = r.pts[i - 1], q = r.pts[i];
            const x1 = Math.min(p.x, q.x), x2 = Math.max(p.x, q.x), y1 = Math.min(p.y, q.y), y2 = Math.max(p.y, q.y);
            if (x1 < moved.x + moved.w && moved.x < x2 + 0.01 && y1 < moved.y + moved.h && moved.y < y2 + 0.01) return true;
          }
          return false;
        });
        if (cuts) continue;
        for (const o of model.nodes.values()) if (o.x !== undefined && inRegion(o)) o[X] += dd;
        g[X] += dd;
        for (const r of rm.edges) {
          const flags = r.pts.map(inside);
          if (!flags.some(Boolean)) continue;
          const out = [];
          r.pts.forEach((p, i) => {
            const q = { ...p };
            if (flags[i]) q[X] += dd;
            if (i > 0 && flags[i] !== flags[i - 1]) {
              const prev = out[out.length - 1];
              if (Math.abs(prev[X] - q[X]) > 0.5 && Math.abs(r.pts[i - 1][X] - p[X]) < 0.5) {
                const m = (prev[Y] + q[Y]) / 2;
                out.push({ [X]: prev[X], [Y]: m }, { [X]: q[X], [Y]: m });
              }
            }
            out.push(q);
          });
          r.pts = out;
          if (r.lab && inside({ x: r.lab.x, y: r.lab.y })) r.lab[X] += dd;
        }
        done = true;
        break;
      }
      if (!done) { (model.alignNotes = model.alignNotes || []).push(`align ${A.id} ${B.id}: they could not be brought level without touching another node or link, so they are left as laid out`); continue; }
    }
    // the link between them: a straight line from the near side of one to the near side of the other
    const r = rm.edges.find(o => (o.e.a === A.id && o.e.b === B.id) || (o.e.a === B.id && o.e.b === A.id));
    if (!r) continue;
    const lo = A[Y] + A[vert ? 'w' : 'h'] <= B[Y] ? [A, B] : B[Y] + B[vert ? 'w' : 'h'] <= A[Y] ? [B, A] : null;
    if (!lo) continue;
    const [first, second] = lo;
    const c = mid(A), a0 = first[Y] + first[vert ? 'w' : 'h'], a1 = second[Y];
    const seg = { [X]: c, [Y]: a0 };
    const line = [{ [X]: c, [Y]: a0 }, { [X]: c, [Y]: a1 }].map(q => ({ x: vert ? q[Y] : q[X], y: vert ? q[X] : q[Y] }));
    const blocked = [...model.nodes.values()].some(o => o !== A && o !== B && o.x !== undefined &&
      o[X] < c + 1 && c - 1 < o[X] + o[W] && o[Y] < a1 && a0 < o[Y] + o[vert ? 'w' : 'h']);
    if (blocked) continue;
    r.pts = r.e.a === first.id ? line : line.reverse();
    if (r.lab) { r.lab = { ...r.lab, [Y]: (a0 + a1) / 2, [X]: c - (r.e.lab ? r.e.lab.h + 6 : 0), anchor: vert ? 'middle' : 'middle' }; if (vert) { r.lab.x = (a0 + a1) / 2; r.lab.y = c - 6 - (r.e.lab ? r.e.lab.h : 0); } else { r.lab.x = (a0 + a1) / 2; r.lab.y = c - 6 - (r.e.lab ? r.e.lab.h : 0); } }
  }
}

// Rails: a band along one edge of the diagram with a bus line facing it. Links to the rail (or to a node
// in it) are kept out of the layout, and drawn here once everything else is placed: each one runs from
// its node straight to the bus, and the bus feeds the nodes in the rail with an arrow.
function placeRails(rm, model, flowH) {
  rm.rails = [];
  if (!model.rails.size) return;
  rm.notes = rm.notes || [];
  const GAP = 30, PAD = 12;
  const shiftAll = (dx, dy) => {
    for (const n of rm.nodes) { n.x += dx; n.y += dy; }
    for (const g of model.groups) if (g.x !== undefined) { g.x += dx; g.y += dy; }
    for (const f of rm.frames) { f.x += dx; f.y += dy; }
    for (const r of rm.rails) { r.x += dx; r.y += dy; r.bus.forEach(q => { q.x += dx; q.y += dy; }); }
    for (const r of rm.edges) { r.pts.forEach(q => { q.x += dx; q.y += dy; }); if (r.lab) { r.lab.x += dx; r.lab.y += dy; } }
    rm.width += dx; rm.height += dy;
  };
  for (const rail of model.rails.values()) {
    const side = rail.side || (flowH ? 'bottom' : 'right');
    const horiz = side === 'bottom' || side === 'top';
    const sinks = rail.items.filter(i => i.type === 'node');
    const links = model.edges.filter(e => e.rail === rail);
    if (!links.length && !sinks.length) continue;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    const add = (x, y, w, h) => { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x + w); y2 = Math.max(y2, y + h); };
    for (const n of rm.nodes) add(n.x, n.y, n.w, n.h);
    for (const f of rm.frames) add(f.x, f.y, f.w, f.h);
    for (const r of rm.rails) add(r.x, r.y, r.w, r.h);
    for (const r of rm.edges) for (const q of r.pts) add(q.x, q.y, 0, 0);
    if (x1 === Infinity) { x1 = y1 = 16; x2 = y2 = 16; }
    const sw = Math.max(0, ...sinks.map(n => n.w)), sh = Math.max(0, ...sinks.map(n => n.h));
    // thickness of the band: the bus, a stub, the nodes, padding
    const T = 22 + (sinks.length ? 18 + (horiz ? sh : sw) : 0) + PAD;
    // the band's other dimension: the whole diagram, and enough for the nodes in the rail
    const need = sinks.reduce((t, n) => t + (horiz ? n.w : n.h) + 16, 0) + 120;
    const L = Math.max(horiz ? x2 - x1 : y2 - y1, need);
    let band;
    if (side === 'bottom') band = { x: x1, y: y2 + GAP, w: L, h: T };
    else if (side === 'right') band = { x: x2 + GAP, y: y1, w: T, h: L };
    else if (side === 'top') { shiftAll(0, T + GAP); band = { x: x1, y: y1, w: L, h: T }; }
    else { shiftAll(T + GAP, 0); band = { x: x1, y: y1, w: T, h: L }; }
    const diagram = { x: horiz ? band.x : band.x, y: band.y };
    // the bus: along the side of the band that faces the diagram
    const busAt = side === 'bottom' ? band.y + 22 : side === 'top' ? band.y + band.h - 22 : side === 'right' ? band.x + 22 : band.x + band.w - 22;
    const R = { rail, side, horiz, x: band.x, y: band.y, w: band.w, h: band.h, bus: [] };
    // the nodes in the rail, along the bus; the title takes the start of the band
    const titleW = Math.min(band.w / 3, (rail.title.length * 6.6) + 24);
    let pos = horiz ? band.x + band.w - PAD : band.y + band.h - PAD;
    for (const n of sinks.slice().reverse()) {
      if (horiz) { pos -= n.w; n.x = pos; n.y = side === 'bottom' ? busAt + 18 : busAt - 18 - n.h; pos -= 16; }
      else { pos -= n.h; n.y = pos; n.x = side === 'right' ? busAt + 18 : busAt - 18 - n.w; pos -= 16; }
      rm.nodes.push(n);
    }
    const out = [];
    const sinkLinks = sinks.map(n => {
      const c = horiz ? n.x + n.w / 2 : n.y + n.h / 2;
      const inbound = links.some(e => e.b === n.id || (e.b === rail.id && !e.railFrom));
      const near = side === 'bottom' ? { x: c, y: busAt } : side === 'top' ? { x: c, y: busAt } : side === 'right' ? { x: busAt, y: c } : { x: busAt, y: c };
      const far = horiz ? { x: c, y: side === 'bottom' ? n.y : n.y + n.h } : { x: side === 'right' ? n.x : n.x + n.w, y: c };
      return { n, c, pts: [near, far], inbound };
    });
    // taps
    const taps = [];
    const blocked = new Set();
    for (const e of links) {
      const other = e.railFrom ? e.b : e.a;
      const o = model.nodes.get(other);
      if (!o || o.x === undefined || (o.parent && o.parent.type === 'rail')) continue;
      const used = taps.filter(t => t.o === o).length;
      const c = (horiz ? o.x + o.w / 2 : o.y + o.h / 2) + (used ? (used % 2 ? 1 : -1) * 8 * Math.ceil(used / 2) : 0);
      const edge = side === 'bottom' ? o.y + o.h : side === 'top' ? o.y : side === 'right' ? o.x + o.w : o.x;
      const nodePt = horiz ? { x: c, y: edge } : { x: edge, y: c };
      const busPt = horiz ? { x: c, y: busAt } : { x: busAt, y: c };
      // anything between the node and the band is crossed
      const lo = Math.min(edge, busAt), hi = Math.max(edge, busAt);
      for (const m of rm.nodes) {
        if (m === o || m.parent === rail) continue;
        const across = horiz ? (m.x < c && c < m.x + m.w && m.y < hi && lo < m.y + m.h) : (m.y < c && c < m.y + m.h && m.x < hi && lo < m.x + m.w);
        if (across) blocked.add(`${e.railFrom ? rail.id : o.id} -> ${e.railFrom ? o.id : rail.id}: crosses ${m.id}`);
      }
      taps.push({ e, o, c, pts: e.railFrom ? [busPt, nodePt] : [nodePt, busPt] });
    }
    for (const b of blocked) rm.notes.push(`rail ${rail.id}: the link ${b}; a rail suits nodes near the edge it runs along`);
    // the bus itself
    const cs = [...taps.map(t => t.c), ...sinkLinks.map(t => t.c)];
    if (cs.length) {
      const a = Math.min(...cs), b = Math.max(...cs);
      R.bus = horiz ? [{ x: a, y: busAt }, { x: b, y: busAt }] : [{ x: busAt, y: a }, { x: busAt, y: b }];
      const busEdge = { a: rail.id, b: rail.id, tags: ['muted'], dashed: false, start: false, end: false, label: '', lab: null, rail };
      out.push({ e: busEdge, pts: R.bus.map(q => ({ ...q })), lab: null });
    }
    for (const t of taps) {
      // the link's own look (dashes, colour, label), with the arrow where the link points
      const syn = { ...t.e, start: false, end: t.e.railFrom ? t.e.end : false };
      let lab = null;
      if (t.e.lab) lab = horiz ? { x: t.c + 6, y: (t.pts[0].y + t.pts[1].y) / 2 - t.e.lab.h / 2, anchor: 'start' } : { x: (t.pts[0].x + t.pts[1].x) / 2, y: t.c - 6 - t.e.lab.h, anchor: 'middle' };
      out.push({ e: syn, pts: t.pts, lab });
    }
    for (const t of sinkLinks) {
      const syn = { a: rail.id, b: t.n.id, tags: ['muted'], dashed: false, start: false, end: t.inbound, label: '', lab: null, rail };
      out.push({ e: syn, pts: t.pts, lab: null });
    }
    rm.edges.push(...out);
    rm.rails.push(R);
    if (side === 'bottom') rm.height = Math.max(rm.height, band.y + band.h + 16);
    if (side === 'right') rm.width = Math.max(rm.width, band.x + band.w + 16);
    rm.width = Math.max(rm.width, band.x + band.w + 16);
    rm.height = Math.max(rm.height, band.y + band.h + 16);
  }
}

// ELK sometimes leaves a [span] node offset from the stack it feeds, by the same amount on
// every link (it keeps frames centred on each other). Slide the span node's frame over when
// that is free, so the links drop straight; links crossing the slid frame's edge get a jog.
function straightenSpans(rm, model, flowH) {
  const X = flowH ? 'y' : 'x', Y = flowH ? 'x' : 'y', W = flowH ? 'h' : 'w';
  const within = (a, b) => { for (let p = a; p; p = p.parent) if (p === b) return true; return false; };
  for (const n of model.nodes.values()) {
    if (!n.span || n.x === undefined) continue;
    const g = n.span.g;
    const es = rm.edges.filter(r => !r.e.intra && ((r.e.a === n.id && g.idx.has(r.e.b)) || (r.e.b === n.id && g.idx.has(r.e.a))));
    if (!es.length) continue;
    const offs = es.map(r => {
      const p0 = r.e.a === n.id ? r.pts[0] : r.pts[r.pts.length - 1];
      const p1 = r.e.a === n.id ? r.pts[r.pts.length - 1] : r.pts[0];
      return p1[X] - p0[X];
    });
    const sorted = offs.slice().sort((u, v) => u - v);
    const d = sorted[Math.floor(sorted.length / 2)];
    if (Math.abs(d) < 1 || offs.some(o => Math.abs(o - d) > 16)) continue;
    const F = frameOfItem(n);
    const fbox = F && rm.frames.find(f => f.f === F);
    if (F && within(g, F)) continue;
    const inRegion = it => F ? within(it, F) : it === n;
    const box = fbox ? { x: fbox.x, y: fbox.y, w: fbox.w, h: fbox.h } : { x: n.x, y: n.y, w: n.w, h: n.h };
    const moved = { ...box, [X]: box[X] + d };
    const hits = [...model.nodes.values()].some(o => o.x !== undefined && !inRegion(o) &&
      o.x < moved.x + moved.w && moved.x < o.x + o.w && o.y < moved.y + moved.h && moved.y < o.y + o.h);
    if (hits) continue;
    const inside0 = p => p.x >= box.x - 0.5 && p.x <= box.x + box.w + 0.5 && p.y >= box.y - 0.5 && p.y <= box.y + box.h + 0.5;
    const cuts = rm.edges.some(r => {
      if (es.includes(r) || r.pts.some(inside0)) return false;
      for (let i = 1; i < r.pts.length; i++) {
        const p = r.pts[i - 1], q = r.pts[i];
        const x1 = Math.min(p.x, q.x), x2 = Math.max(p.x, q.x), y1 = Math.min(p.y, q.y), y2 = Math.max(p.y, q.y);
        if (x1 < moved.x + moved.w && moved.x < x2 + 0.01 && y1 < moved.y + moved.h && moved.y < y2 + 0.01) return true;
      }
      return false;
    });
    if (cuts) continue;
    const inside = p => p.x >= box.x - 0.5 && p.x <= box.x + box.w + 0.5 && p.y >= box.y - 0.5 && p.y <= box.y + box.h + 0.5;
    for (const o of model.nodes.values()) if (o.x !== undefined && inRegion(o)) o[X] += d;
    for (const gg of model.groups) if (gg.x !== undefined && gg.items.length && inRegion(gg.items[0])) gg[X] += d;
    if (fbox) fbox[X] += d;
    for (const r of rm.edges) {
      if (es.includes(r)) continue;
      const flags = r.pts.map(inside);
      if (!flags.some(Boolean)) continue;
      const out = [];
      r.pts.forEach((p, i) => {
        const q = { ...p };
        if (flags[i]) q[X] += d;
        if (i > 0 && flags[i] !== flags[i - 1]) {
          const prev = out[out.length - 1];
          if (Math.abs(prev[X] - q[X]) > 0.5 && Math.abs(r.pts[i - 1][X] - p[X]) < 0.5) {
            const mid = (prev[Y] + q[Y]) / 2;
            out.push({ [X]: prev[X], [Y]: mid }, { [X]: q[X], [Y]: mid });
          }
        }
        out.push(q);
      });
      r.pts = out;
      if (r.lab && inside({ x: r.lab.x, y: r.lab.y })) r.lab[X] += d;
    }
    for (const r of es) {
      const fromN = r.e.a === n.id;
      const a = fromN ? r.pts[0] : r.pts[r.pts.length - 1];
      const b = fromN ? r.pts[r.pts.length - 1] : r.pts[0];
      const a2 = { ...a, [X]: a[X] + d };
      let path = [a2, b];
      if (Math.abs(a2[X] - b[X]) > 0.5) {
        const mid = (a2[Y] + b[Y]) / 2;
        path = [a2, { [X]: a2[X], [Y]: mid }, { [X]: b[X], [Y]: mid }, b];
      }
      r.pts = fromN ? path : path.reverse();
      if (r.lab) r.lab[X] = (a2[X] + b[X]) / 2;
    }
  }
}

// A link with one step (down, across, down; or right, up/down, right) has its step wherever ELK's
// channel assignment put it: right under one source, near the target for another. Put the steps of the
// links that share a target (or a source) at one height, in the middle of the gap between them, so the
// bends line up. Skipped for a group when that would touch a node or run along another link.
function alignJogs(rm) {
  const simp = pts => {
    const o = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = o[o.length - 1], b = pts[i], c = pts[i + 1];
      if (Math.hypot(a.x - b.x, a.y - b.y) < 0.5) continue;
      if ((Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5)) continue;
      o.push(b);
    }
    o.push(pts[pts.length - 1]);
    return o;
  };
  const eq = (a, b) => Math.abs(a - b) < 0.5;
  // single-step links: kind 'v' (vertical, horizontal, vertical: the step has a y) or 'h' (the step has an x)
  const zs = [];
  for (const r of rm.edges) {
    if (!r.pts || r.pts.length < 2 || r.e.a === r.e.b) continue;
    const q = simp(r.pts);
    if (q.length !== 4) continue;
    if (eq(q[0].x, q[1].x) && eq(q[1].y, q[2].y) && eq(q[2].x, q[3].x) && q[0].y < q[3].y) zs.push({ r, q, kind: 'v', lo: q[0].y, hi: q[3].y });
    else if (eq(q[0].y, q[1].y) && eq(q[1].x, q[2].x) && eq(q[2].y, q[3].y) && q[0].x < q[3].x) zs.push({ r, q, kind: 'h', lo: q[0].x, hi: q[3].x });
  }
  const groups = new Map();
  const used = new Set();
  for (const key of ['b', 'a']) for (const z of zs) {
    if (used.has(z)) continue;
    const k = z.kind + '|' + key + '|' + z.r.e[key];
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(z);
  }
  for (const [, list] of groups) {
    const fresh = list.filter(z => !used.has(z));
    if (!fresh.length) continue;
    const kind = fresh[0].kind;
    // the gap every link in the group can put its step in
    const lo = Math.max(...fresh.map(z => z.lo)) + 10, hi = Math.min(...fresh.map(z => z.hi)) - 10;
    if (lo > hi) continue;
    const c = (lo + hi) / 2;
    // the new steps must clear every node and not run along another link
    const steps = fresh.map(z => kind === 'v'
      ? { x1: Math.min(z.q[0].x, z.q[3].x), x2: Math.max(z.q[0].x, z.q[3].x), y1: c, y2: c }
      : { x1: c, x2: c, y1: Math.min(z.q[0].y, z.q[3].y), y2: Math.max(z.q[0].y, z.q[3].y) });
    const hitsNode = steps.some(st => rm.nodes.some(n => n.x !== undefined && st.x1 < n.x + n.w && n.x < st.x2 && st.y1 < n.y + n.h && n.y < st.y2));
    if (hitsNode) continue;
    const along = steps.some(st => rm.edges.some(o => {
      if (fresh.some(z => z.r === o) || !o.pts) return false;
      for (let i = 1; i < o.pts.length; i++) {
        const a = o.pts[i - 1], b = o.pts[i];
        if (kind === 'v' && eq(a.y, b.y) && Math.abs(a.y - c) < 3 && Math.min(a.x, b.x) < st.x2 && st.x1 < Math.max(a.x, b.x)) return true;
        if (kind === 'h' && eq(a.x, b.x) && Math.abs(a.x - c) < 3 && Math.min(a.y, b.y) < st.y2 && st.y1 < Math.max(a.y, b.y)) return true;
      }
      return false;
    }));
    if (along) continue;
    for (const z of fresh) {
      const [p0, , , p3] = z.q;
      const old = z.q[1][kind === 'v' ? 'y' : 'x'];
      z.r.pts = kind === 'v' ? [p0, { x: p0.x, y: c }, { x: p3.x, y: c }, p3] : [p0, { x: c, y: p0.y }, { x: c, y: p3.y }, p3];
      // a label that sat on the old step moves with it
      const lab = z.r.lab;
      if (lab && Math.abs((kind === 'v' ? lab.y : lab.x) - old) < 24) lab[kind === 'v' ? 'y' : 'x'] += c - old;
      used.add(z);
    }
  }
}

// Frames hug their content (ELK leaves room for routing that reads as empty space),
// then [bridge] nodes are set on the border between their frame and the one linking in.
function fitFrames(rm, model, flowH) {
  const box = new Map(rm.frames.map(fr => [fr.f.id, fr]));
  const PAD = 18;
  for (const fr of [...rm.frames].sort((a, b) => b.depth - a.depth)) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    const add = (x, y, w, h) => { x1 = Math.min(x1, x); y1 = Math.min(y1, y); x2 = Math.max(x2, x + w); y2 = Math.max(y2, y + h); };
    for (const it of leafItems(fr.f)) {
      if ((it.type === 'node' || it.type === 'group') && it.x !== undefined) add(it.x, it.y, it.w, it.h);
      else if (it.type === 'frame' && box.has(it.id)) { const c = box.get(it.id); add(c.x, c.y, c.w, c.h); }
    }
    if (x1 === Infinity) continue;
    const top = fr.f.title ? 34 : PAD;
    let nx = x1 - PAD, nw = x2 - x1 + 2 * PAD;
    const minW = (fr.f.titleW || 0) + 36;
    fr.widen = null;
    if (nw < minW) { fr.widen = { cx1: nx, cx2: nx + nw, minW }; nx -= (minW - nw) / 2; nw = minW; }
    Object.assign(fr, { x: nx, y: y1 - top, w: nw, h: y2 - y1 + top + PAD });
  }
  // a frame widened to fit its title grows away from its neighbours
  const hit = (a, b) => a !== b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const nested = (a, b) => { for (let p = a.f.parent; p; p = p.parent) if (p === b.f) return true; return false; };
  for (const fr of rm.frames) {
    if (!fr.widen) continue;
    const { cx1, cx2, minW } = fr.widen;
    const tries = [fr.x, cx2 - minW, cx1];
    for (const x of tries) {
      const c = { ...fr, x };
      if (!rm.frames.some(o => o !== fr && !nested(fr, o) && !nested(o, fr) && hit(c, o))) { fr.x = x; break; }
    }
  }

  const frameOf = frameOfItem;
  const within = (a, b) => { for (let p = a; p; p = p.parent) if (p === b) return true; return false; };
  const plans = new Map();
  for (const n of model.nodes.values()) {
    if (!n.tags.includes('bridge') || n.x === undefined) continue;
    const F = frameOf(n);
    if (!F || !box.has(F.id)) continue;
    const fb = box.get(F.id);
    let best = null;
    for (const e of model.edges) {
      const other = e.a === n.id ? e.b : e.b === n.id ? e.a : null;
      if (!other) continue;
      const on = model.nodes.get(other);
      const Q = on ? frameOf(on) : model.frames.get(other) || null;
      if (!Q || !box.has(Q.id) || within(Q, F) || within(F, Q)) continue;
      const qb = box.get(Q.id);
      const level = flowH ? qb.y < n.y + n.h && n.y < qb.y + qb.h : qb.x < n.x + n.w && n.x < qb.x + qb.w;
      if (!level) continue;
      const before = flowH ? qb.x < fb.x : qb.y < fb.y;
      if (!best || (before && !best.before)) best = { Q, qb, before };
    }
    if (!best || !best.before) continue;
    const c = flowH ? n.x + n.w / 2 : n.y + n.h / 2;
    const p = plans.get(F.id) || { fb, cut: Infinity, nodes: [], others: new Map() };
    p.cut = Math.min(p.cut, c);
    p.nodes.push(n);
    p.others.set(best.Q.id, best.qb);
    plans.set(F.id, p);
  }
  // growing a frame must not swallow a node or frame that belongs elsewhere
  const owns = (fr, n) => { for (let p = n.parent; p; p = p.parent) if (p === fr.f) return true; return false; };
  const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const related = (a, b) => within(a.f, b.f) || within(b.f, a.f);
  const clean = (fr, cand) => {
    for (const n of model.nodes.values()) if (n.x !== undefined && !n.tags.includes('bridge') && !owns(fr, n) && overlaps(cand, n)) return false;
    for (const o of rm.frames) if (o !== fr && !related(o, fr) && overlaps(cand, o)) return false;
    return true;
  };
  for (const p of plans.values()) {
    const { fb } = p;
    const grow = (b, n) => {
      if (flowH) { const y1 = Math.min(b.y, n.y - 14), y2 = Math.max(b.y + b.h, n.y + n.h + 14); b.y = y1; b.h = y2 - y1; }
      else { const x1 = Math.min(b.x, n.x - 14), x2 = Math.max(b.x + b.w, n.x + n.w + 14); b.x = x1; b.w = x2 - x1; }
    };
    if (flowH) { const r = fb.x + fb.w; fb.x = p.cut; fb.w = r - p.cut; }
    else {
      const b = fb.y + fb.h; fb.y = p.cut; fb.h = b - p.cut + (fb.f.title ? 16 : 0);
      fb.titleBottom = true;
    }
    const qbKey = (pl, q) => [...pl.others.entries()].find(([, v]) => v === q)[0];
    for (const qb of [...p.others.values()]) {
      const ext = { ...qb };
      if (flowH) { if (ext.x + ext.w < p.cut) ext.w = p.cut - ext.x; }
      else if (ext.y + ext.h < p.cut) ext.h = p.cut - ext.y;
      if (clean(qb, ext)) Object.assign(qb, { w: ext.w, h: ext.h });
      else { p.others.delete(qbKey(p, qb)); continue; }
      for (const n of p.nodes) {
        const c = { ...qb }; grow(c, n);
        if (clean(qb, c)) Object.assign(qb, { x: c.x, y: c.y, w: c.w, h: c.h });
        grow(fb, n);
      }
    }
  }
  // a bridged frame and the frame it touches share one span across the flow, like bands
  for (let pass = 0; pass < 4; pass++) for (const p of plans.values()) {
    for (const qb of p.others.values()) {
      const fb = p.fb;
      let cf, cq;
      if (flowH) { const y1 = Math.min(fb.y, qb.y), y2 = Math.max(fb.y + fb.h, qb.y + qb.h); cf = { ...fb, y: y1, h: y2 - y1 }; cq = { ...qb, y: y1, h: y2 - y1 }; }
      else { const x1 = Math.min(fb.x, qb.x), x2 = Math.max(fb.x + fb.w, qb.x + qb.w); cf = { ...fb, x: x1, w: x2 - x1 }; cq = { ...qb, x: x1, w: x2 - x1 }; }
      const others = rm.frames.filter(o => o !== fb && o !== qb);
      const save = rm.frames; rm.frames = others.concat([fb, qb]);
      if (clean(fb, cf)) Object.assign(fb, { x: cf.x, y: cf.y, w: cf.w, h: cf.h });
      if (clean(qb, cq)) Object.assign(qb, { x: cq.x, y: cq.y, w: cq.w, h: cq.h });
      rm.frames = save;
    }
  }
  // frames may now reach past ELK's canvas
  const labX = rm.edges.filter(r => r.lab && r.e.lab).map(r => r.lab.anchor === 'end' ? r.lab.x - r.e.lab.w : r.lab.anchor === 'middle' ? r.lab.x - r.e.lab.w / 2 : r.lab.x);
  const labY = rm.edges.filter(r => r.lab && r.e.lab).map(r => r.lab.y);
  const minX = Math.min(16, ...rm.frames.map(f => f.x), ...labX.map(x => x + 8)), minY = Math.min(16, ...rm.frames.map(f => f.y), ...labY.map(y => y + 8));
  const dx = 16 - minX, dy = 16 - minY;
  if (dx > 0 || dy > 0) {
    const mv = o => { o.x += dx; o.y += dy; };
    for (const n of model.nodes.values()) if (n.x !== undefined) mv(n);
    for (const g of model.groups) if (g.x !== undefined) mv(g);
    for (const { pts, lab } of rm.edges) { pts.forEach(mv); if (lab) mv(lab); }
    for (const fr of rm.frames) mv(fr);
    rm.width += dx; rm.height += dy;
  }
  for (const r of rm.edges) {
    if (!r.lab || !r.e.lab) continue;
    const x2 = r.lab.anchor === 'end' ? r.lab.x : r.lab.anchor === 'middle' ? r.lab.x + r.e.lab.w / 2 : r.lab.x + r.e.lab.w;
    rm.width = Math.max(rm.width, x2 + 8);
    rm.height = Math.max(rm.height, r.lab.y + r.e.lab.h + 8);
  }
  for (const fr of rm.frames) {
    rm.width = Math.max(rm.width, fr.x + fr.w + 16);
    rm.height = Math.max(rm.height, fr.y + fr.h + 16);
  }
}

// ---------------------------------------------------------------- rendering

const PALETTE = {
  light: {
    fg: '#1d2330', muted: '#5d6677', panel: '#ffffff', box: '#ffffff', line: '#1d2330', engine: '#f2f3f5',
    storeFill: '#fff8db', storeLine: '#9a6700', ok: '#1a7f37', bad: '#c62a2f', soft: '#9aa1ad',
    zones: { green: ['#eef7f1', '#7fb38f'], blue: ['#eef2f8', '#8aa0c2'], orange: ['#fbf1e6', '#d0a06a'], purple: ['#f3effb', '#a78fd6'], grey: ['#f4f5f7', '#b5bac4'] },
  },
  dark: {
    fg: '#e3e6ec', muted: '#9aa3b2', panel: '#181b21', box: '#1b1e25', line: '#c9ced8', engine: '#23262d',
    storeFill: '#33290f', storeLine: '#e5b94e', ok: '#5cc97a', bad: '#ff7b7b', soft: '#6b7385',
    zones: { green: ['#15241b', '#4f8a62'], blue: ['#18202d', '#4f6a94'], orange: ['#2a1f14', '#a3743d'], purple: ['#211a33', '#7d62b8'], grey: ['#1d2027', '#4a505c'] },
  },
};

function diagramCSS(p, scope) {
  const s = scope ? scope + ' ' : '';
  const z = Object.entries(p.zones).map(([k, [f, st]]) => `${s}.zone-${k}{fill:${f};stroke:${st}}`).join('');
  return `${s}text{font:12px Inter,system-ui,-apple-system,"Segoe UI",sans-serif}` +
    `${s}.fg{fill:${p.fg}}${s}.muted{fill:${p.muted}}` +
    `${s}.name{font-size:13px;font-weight:600}${s}.note{font-size:11px;font-weight:400}${s}.ztitle{font-size:11.5px;font-weight:600}` +
    `${s}.halo{paint-order:stroke;stroke:${p.panel};stroke-width:4px;stroke-linejoin:round}` +
    `${s}.box{fill:${p.box};stroke:${p.line};stroke-width:1.2}` +
    `${s}.box.engine{fill:${p.engine}}${s}.box.store{fill:${p.storeFill};stroke:${p.storeLine};stroke-width:1.4}` +
    `${s}.box.ok{stroke:${p.ok};stroke-width:1.6}${s}.box.bad{stroke:${p.bad};stroke-width:1.6}` +
    `${s}.box.muted{stroke:${p.soft}}${s}.dashed{stroke-dasharray:4 3}` +
    `${s}.dot{fill:${p.line}}` +
    `${s}.ico{fill:none;stroke:${p.line};stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}` +
    `${s}.zone{stroke-width:1}${z}` +
    `${s}.arrow{fill:none;stroke:${p.line};stroke-width:1.2}${s}.arrow.ok{stroke:${p.ok}}${s}.arrow.bad{stroke:${p.bad}}${s}.arrow.muted{stroke:${p.soft}}` +
    `${s}.head{fill:${p.line}}${s}.head-ok{fill:${p.ok}}${s}.head-bad{fill:${p.bad}}${s}.head-muted{fill:${p.soft}}`;
}

function standaloneCSS() {
  return diagramCSS(PALETTE.light, '') + `@media (prefers-color-scheme: dark){${diagramCSS(PALETTE.dark, '')}}`;
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = v => Math.round(v * 10) / 10;

function roundPath(pts, r = 7) {
  const p = [];
  for (const q of pts) {
    const l = p[p.length - 1];
    if (!l || Math.abs(l.x - q.x) > 0.1 || Math.abs(l.y - q.y) > 0.1) p.push({ x: q.x, y: q.y });
  }
  if (p.length < 2) return '';
  let d = `M${r1(p[0].x)} ${r1(p[0].y)}`;
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i - 1], b = p[i], c = p[i + 1];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const p1 = { x: b.x - (b.x - a.x) / l1 * rr, y: b.y - (b.y - a.y) / l1 * rr };
    const p2 = { x: b.x + (c.x - b.x) / l2 * rr, y: b.y + (c.y - b.y) / l2 * rr };
    d += ` L${r1(p1.x)} ${r1(p1.y)} Q${r1(b.x)} ${r1(b.y)} ${r1(p2.x)} ${r1(p2.y)}`;
  }
  const z = p[p.length - 1];
  return d + ` L${r1(z.x)} ${r1(z.y)}`;
}

function shorten(pts, atStart, atEnd, by = 1.5) {
  const p = pts.map(q => ({ ...q }));
  const cut = (i, j) => {
    const a = p[i], b = p[j], l = Math.hypot(a.x - b.x, a.y - b.y);
    if (l > by * 2) { a.x += (b.x - a.x) / l * by; a.y += (b.y - a.y) / l * by; }
  };
  if (atEnd && p.length > 1) cut(p.length - 1, p.length - 2);
  if (atStart && p.length > 1) cut(0, 1);
  return p;
}

function nodeSVG(n) {
  const out = [];
  const cls = ['box'];
  if (n.kind === 'store') cls.push('store');
  if (n.kind === 'engine') cls.push('engine');
  for (const t of n.tags) cls.push(t);
  const c = cls.join(' ');
  if (n.kind === 'start') {
    out.push(`<circle class="dot" cx="${r1(n.x + 9)}" cy="${r1(n.y + 9)}" r="8"/>`);
    return out.join('');
  }
  let x = n.x, y = n.y, w = n.w, h = n.h;
  if (n.kind === 'final') {
    out.push(`<rect class="${c}" x="${r1(x)}" y="${r1(y)}" width="${w}" height="${h}" rx="10"/>`);
    x += 4; y += 4; w -= 8; h -= 8;
    out.push(`<rect class="${c}" x="${r1(x)}" y="${r1(y)}" width="${w}" height="${h}" rx="7"/>`);
  } else {
    const rx = { store: 8, state: 12, pill: h / 2, ask: h / 2 }[n.kind] ?? 6;
    out.push(`<rect class="${c}" x="${r1(x)}" y="${r1(y)}" width="${w}" height="${h}" rx="${r1(rx)}"/>`);
  }
  let cx = r1(x + w / 2);
  let top = y + (h - n.textH) / 2;
  if (n.iconMarkup) {
    let ix, iy;
    if (n.iconTop) { iy = y + (h - n.textH - ICON_SIZE - 4) / 2; ix = x + w / 2 - ICON_SIZE / 2; top = iy + ICON_SIZE + 4; }
    else { ix = x + n.padX; iy = y + (h - ICON_SIZE) / 2; cx = r1(x + n.padX + ICON_SIZE + 8 + (w - 2 * n.padX - ICON_SIZE - 8) / 2); }
    out.push(`<g class="ico" transform="translate(${r1(ix)} ${r1(iy)}) scale(${r1(ICON_SIZE / 24 * 1000) / 1000})">${n.iconMarkup}</g>`);
  }
  for (const l of n.nameLines) { out.push(`<text class="name fg" x="${cx}" y="${r1(top + 12.5)}" text-anchor="middle">${esc(l)}</text>`); top += 16; }
  for (const l of n.noteLines) { out.push(`<text class="note muted" x="${cx}" y="${r1(top + 10.5)}" text-anchor="middle">${esc(l)}</text>`); top += 14; }
  return out.join('');
}

function headId(e, pfx) {
  if (e.tags.includes('bad')) return pfx + 'bad';
  if (e.tags.includes('ok')) return pfx + 'ok';
  if (e.tags.includes('muted')) return pfx + 'mu';
  return pfx + 'a';
}

function render(rm, { standalone = false, idPrefix = 'tr' } = {}) {
  const pfx = idPrefix + '-';
  const model = rm.model;
  let W = Math.ceil(rm.width), H = Math.ceil(rm.height);
  const body = [];

  for (const fr of rm.frames) {
    const t = fr.f.tags;
    const color = (t.find(x => PALETTE.light.zones[x === 'gray' ? 'grey' : x]) || 'green').replace('gray', 'grey');
    body.push(`<rect class="zone zone-${color}${t.includes('dashed') ? ' dashed' : ''}" x="${r1(fr.x)}" y="${r1(fr.y)}" width="${r1(fr.w)}" height="${r1(fr.h)}" rx="10"/>`);
    if (fr.f.title) {
      // first corner where the title clears every node
      const tw = fr.f.titleW || fr.f.title.length * 6.5;
      const spots = [
        { x: fr.x + fr.w - 12, y: fr.y + 20, a: 'end' }, { x: fr.x + 12, y: fr.y + 20, a: 'start' },
        { x: fr.x + fr.w - 12, y: fr.y + fr.h - 10, a: 'end' }, { x: fr.x + 12, y: fr.y + fr.h - 10, a: 'start' },
      ];
      if (fr.titleBottom) spots.push(...spots.splice(0, 2));
      const clear = sp => {
        const x0 = sp.a === 'end' ? sp.x - tw : sp.x, y0 = sp.y - 11;
        return !rm.nodes.some(n => n.x < x0 + tw + 4 && x0 - 4 < n.x + n.w && n.y < y0 + 14 && y0 < n.y + n.h);
      };
      const sp = spots.find(clear) || spots[0];
      body.push(`<text class="ztitle muted" x="${r1(sp.x)}" y="${r1(sp.y)}" text-anchor="${sp.a}">${esc(fr.f.title)}</text>`);
    }
  }
  for (const rl of rm.rails || []) {
    const t = rl.rail.tags;
    const color = (t.find(x => PALETTE.light.zones[x === 'gray' ? 'grey' : x]) || 'grey').replace('gray', 'grey');
    body.push(`<rect class="zone zone-${color}${t.includes('dashed') ? ' dashed' : ''}" x="${r1(rl.x)}" y="${r1(rl.y)}" width="${r1(rl.w)}" height="${r1(rl.h)}" rx="10"/>`);
    if (rl.rail.title) {
      const tx = rl.horiz ? rl.x + 12 : rl.x + 12, ty = rl.horiz ? (rl.side === 'bottom' ? rl.y + rl.h - 10 : rl.y + 20) : rl.y + 20;
      body.push(`<text class="ztitle muted" x="${r1(tx)}" y="${r1(ty)}" text-anchor="start">${esc(rl.rail.title)}</text>`);
    }
  }
  for (const g of model.groups) {
    if (!g.title || g.x === undefined) continue;
    body.push(`<text class="note muted" x="${r1(g.x + g.w / 2)}" y="${r1(g.y + 13)}" text-anchor="middle">${esc(g.title)}</text>`);
  }
  const labels = [];
  for (const { e, pts, lab } of rm.edges) {
    const cls = ['arrow'];
    for (const t of ['ok', 'bad', 'muted']) if (e.tags.includes(t)) cls.push(t);
    if (e.dashed) cls.push('dashed');
    const hp = shorten(pts, e.start, e.end);
    const mk = (e.end ? ` marker-end="url(#${headId(e, pfx)})"` : '') + (e.start ? ` marker-start="url(#${headId(e, pfx)})"` : '');
    body.push(`<path class="${cls.join(' ')}" d="${roundPath(hp)}"${mk}/>`);
    if (lab && e.lab) {
      let y = lab.y + 11;
      for (const l of e.lab.lines) {
        labels.push(`<text class="note muted halo" x="${r1(lab.x)}" y="${r1(y)}" text-anchor="${lab.anchor}">${esc(l)}</text>`);
        y += 13;
      }
    }
  }
  for (const n of rm.nodes) body.push(nodeSVG(n));
  body.push(...labels);

  // legend
  if (model.keys.length) {
    let x = 16, y = H + 2;
    const rowH = 26, maxX = Math.max(W, 420) - 16;
    const items = [];
    for (const k of model.keys) {
      const tw = (k._tw || k.text.length * 6.2);
      const iw = 34 + 8 + tw + 22;
      if (x + iw > maxX && x > 16) { x = 16; y += rowH; }
      items.push(keySVG(k, x, y, pfx));
      x += iw;
    }
    body.push(...items);
    H = y + rowH + 10;
  }

  const defs = ['a:head', 'ok:head-ok', 'bad:head-bad', 'mu:head-muted'].map(s => {
    const [id, c] = s.split(':');
    return `<marker id="${pfx}${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" class="${c}"/></marker>`;
  }).join('');
  const aria = esc(model.title || describe(model));
  const style = standalone ? `<style>${standaloneCSS()}</style>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" class="dg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${aria}">${style}<defs>${defs}</defs>${body.join('')}</svg>`;
}

function keySVG(k, x, y, pfx) {
  const out = [];
  const t = k.tags;
  if (k.shape === '->' || k.shape === '-->' || k.shape === '--') {
    const cls = ['arrow', ...t.filter(v => ['ok', 'bad', 'muted'].includes(v))];
    if (k.shape === '-->' || t.includes('dashed')) cls.push('dashed');
    const e = { tags: t };
    out.push(`<path class="${cls.join(' ')}" d="M${x} ${y + 10} L${x + 32} ${y + 10}"${k.shape === '--' ? '' : ` marker-end="url(#${headId(e, pfx)})"`}/>`);
  } else if (k.shape === 'frame') {
    const color = t.find(v => PALETTE.light.zones[v]) || 'green';
    out.push(`<rect class="zone zone-${color}${t.includes('dashed') ? ' dashed' : ''}" x="${x}" y="${y + 1}" width="34" height="18" rx="5"/>`);
  } else if (k.shape === 'start') {
    out.push(`<circle class="dot" cx="${x + 17}" cy="${y + 10}" r="7"/>`);
  } else {
    const cls = ['box'];
    if (k.shape === 'store') cls.push('store');
    if (k.shape === 'engine') cls.push('engine');
    for (const v of t) if (NODE_TAGS.has(v)) cls.push(v);
    const rx = { store: 5, state: 7, pill: 9, ask: 9, final: 5 }[k.shape] ?? 4;
    out.push(`<rect class="${cls.join(' ')}" x="${x}" y="${y + 1}" width="34" height="18" rx="${rx}"/>`);
    if (k.shape === 'final' || k.shape === 'end') out.push(`<rect class="${cls.join(' ')}" x="${x + 3}" y="${y + 4}" width="28" height="12" rx="3"/>`);
  }
  out.push(`<text class="note muted" x="${x + 42}" y="${y + 14}">${esc(k.text)}</text>`);
  return out.join('');
}

function describe(model) {
  const names = [...model.nodes.values()].filter(n => n.kind !== 'start').map(n => n.name.replace(/\n/g, ' '));
  return `Diagram of ${names.length} parts: ${names.slice(0, 12).join(', ')}${names.length > 12 ? ', and more' : ''}.`;
}

async function compile(src, measure, ELK, opts) {
  const model = parse(src);
  if (model.errors.length) return { model, errors: model.errors };
  if (!model.nodes.size) return { model, errors: [], empty: true };
  for (const k of model.keys) k._tw = measure(k.text, FONT_NOTE);
  const iconsFailed = await loadIcons(model, opts && opts.loadIcon);
  const rm = await layout(model, measure, ELK);
  return { model, rm, errors: [], warnings: [...iconsFailed.map(n => `Could not load the icon "${n}" (offline?), drawn without it.`), ...(rm.notes || []), ...(model.alignNotes || [])], svg: render(rm, opts), standalone: () => render(rm, { ...opts, standalone: true }) };
}

if (typeof module !== 'undefined') module.exports = { parse, layout, render, compile, diagramCSS, standaloneCSS, PALETTE, FONT_NAME, FONT_NOTE, withIcon };
