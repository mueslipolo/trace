// Trace — a small diagram language that draws in the "redrawn docs" style.
// Parser → model → ELK layout (with hand-stacked column/row groups) → SVG.

const KINDS = new Set(['box', 'store', 'engine', 'state', 'pill', 'ask', 'start', 'final', 'end']);
const NODE_TAGS = new Set(['ok', 'bad', 'dashed', 'muted', 'span', 'bridge', 'join']);
const EDGE_TAGS = new Set(['ok', 'bad', 'dashed', 'muted']);
const CARD_RE = /^(1|n|01|0n)-(1|n|01|0n)$/;
// the tags a link accepts: the fixed ones, and a cardinality for its two ends (n-1, 1-1, 0n-1, n-01 ...)
const EDGE_TAG_SET = {
  has: t => EDGE_TAGS.has(t) || CARD_RE.test(t),
  hint: t => `Unknown tag "${t}" on a link. Use ${[...EDGE_TAGS].join(', ')}, or the two ends' cardinality as in n-1, 1-1, 0n-1, n-01 (1 one, n many, 01 zero or one, 0n zero or many; source end first).`,
};
const FRAME_TAGS = new Set(['green', 'blue', 'orange', 'purple', 'grey', 'gray', 'dashed']);
const RAIL_SIDES = new Set(['top', 'bottom', 'left', 'right']);
// a frame may also be a side zone: [side], [side left], [right span] ...
const SIDE_FRAME_TAGS = new Set([...FRAME_TAGS, 'side', 'span', ...RAIL_SIDES]);
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
const MARK_SIZE = 12;                 // the icon a mark draws on a node, after its name
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
  if (c < 0 || ARROWS.test(line.slice(0, c)) || /^\s*(frame|column|row|key|title|caption|cartouche|direction|spacing)\b/.test(line)) return null;
  const lhs = line.slice(0, c), rest = line.slice(c);
  const m = lhs.match(/^(.*?)\s*\[([^\]]*)\]\s*$/);
  if (!m) return lhs.trimEnd() + ` [${name}]` + rest;
  const keep = m[2].trim().split(/[\s,]+/).filter(t => t && (NODE_TAGS.has(t) || t === 'top'));
  return m[1] + ` [${[...keep, name].join(' ')}]` + rest;
}
async function loadIcons(model, loader) {
  const need = [...new Set([...[...model.nodes.values()].map(n => n.icon), ...(model.marks || []).map(k => k.icon)].filter(i => i && !iconSvg(i)).map(lucideName))];
  const logos = [...new Set([...[...model.nodes.values()].map(n => n.logo), ...[...model.frames.values()].map(f => f.logo)].filter(i => i && !logoData(i)).map(logoName))];
  const failed = [];
  await Promise.all([...need.map(async name => {
    try { if (!(await loadIcon(name, loader))) throw new Error('no drawing'); } catch (e) { failed.push(name); }
  }), ...logos.map(async name => {
    try { if (!(await loadLogo(name))) throw new Error('no drawing'); } catch (e) { failed.push(name); }
  })]);
  return failed;
}
async function defaultIconLoader(name) {
  if (IN_NODE) { const all = require('./lucide.js'); return all[name] ? `<svg>${all[name]}</svg>` : null; }
  const r = await fetch(ICON_CDN + name + '.svg');
  return r.ok ? r.text() : null;
}
// Technology logos (Simple Icons, CC0; trademarks of their owners), written like icons: [postgresql].
// A name that is also a Lucide icon or a Trace tag keeps that meaning; `logo/name` always means the logo.
// The common ones ship with the engine; any other is taken from simple-icons in Node, fetched in a page.
const LOGO_CORE = IN_NODE ? require('./logo-core.js') : LOGO_CORE_DATA;
const LOGO_NAMES = new Set(IN_NODE ? require('./logo-names.js') : LOGO_NAME_LIST);
const LOGO_LOADED = new Map();
const LOGO_ALIASES = {
  kafka: 'apachekafka', postgres: 'postgresql', k8s: 'kubernetes', node: 'nodedotjs', nodejs: 'nodedotjs', vue: 'vuedotjs',
  mongo: 'mongodb', elastic: 'elasticsearch', gcp: 'googlecloud', otel: 'opentelemetry', golang: 'go', ts: 'typescript',
  js: 'javascript', 'hashicorp-vault': 'vault', traefik: 'traefikproxy', argocd: 'argo',
  // Java's own logo is not available (its owner had it removed): OpenJDK's stands in, and says so in the note
  java: 'openjdk', httpd: 'apache',
};
const LOGO_CDN = 'https://cdn.jsdelivr.net/npm/simple-icons@16.37.0/icons/';
const LOGO_SMALL = 11;               // a logo beside the technology's name, in the note line
function logoName(name) { const n = name.startsWith('logo/') ? name.slice(5) : name; return LOGO_ALIASES[n] || n; }
function logoKnown(name) { return LOGO_NAMES.has(logoName(name)); }
// a tag is a logo when it says so, or when it is no icon (nor tag) and is a logo's name
function isLogoTag(t) { return t.startsWith('logo/') ? logoKnown(t) : !iconKnown(t) && logoKnown(t); }
function logoData(name) { const l = logoName(name); return LOGO_CORE[l] || LOGO_LOADED.get(l) || null; }
async function loadLogo(name) {
  const l = logoName(name);
  if (LOGO_CORE[l] || LOGO_LOADED.has(l)) return logoData(name);
  let t = null, d = null;
  if (IN_NODE) {
    try { const x = Object.values(require('simple-icons')).find(i => i && i.slug === l); if (x) { t = x.title; d = x.path; } } catch (e) { /* not installed */ }
  } else {
    const r = await fetch(LOGO_CDN + l + '.svg');
    if (r.ok) { const svg = await r.text(); t = (/<title>([^<]*)<\/title>/.exec(svg) || [])[1] || l; d = (/<path[^>]* d="([^"]+)"/.exec(svg) || [])[1]; }
  }
  if (!d) return null;
  LOGO_LOADED.set(l, { t, d });
  return LOGO_LOADED.get(l);
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
  has: t => NODE_TAGS.has(t) || t === 'top' || iconKnown(t) || isLogoTag(t),
  hint: t => `Unknown tag "${t}" on a node. Use ${[...NODE_TAGS, 'top'].join(', ')}, an icon name such as database, server, user, firewall, or a technology such as postgresql, kafka, kubernetes.${iconHint(t)}`,
};
// a frame takes its colour and side tags, and a technology's logo (shown before its title)
const FRAME_TAG_SET = {
  has: t => SIDE_FRAME_TAGS.has(t) || isLogoTag(t),
  hint: t => `Unknown tag "${t}" on a frame. Use ${[...SIDE_FRAME_TAGS].join(', ')}, or a technology such as kubernetes, googlecloud.`,
};

const COL_MARKS = new Set(['pk', 'fk', 'unique', 'null']);

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

// a name or note written whole in quotes loses them: the way to write a # (which starts a comment after a space)
// or a | in a label, "Flex Mini #1"
function splitLabel(text) {
  const t = text.replace(/\\n/g, '\n');
  const uq = v => /^"[^"]*"$/.test(v) ? v.slice(1, -1) : v;
  const whole = t.trim();
  if (/^"[^"]*"$/.test(whole)) return { name: whole.slice(1, -1), note: '' };
  const i = t.indexOf('|');
  if (i < 0) return { name: uq(t.trim()), note: '' };
  return { name: uq(t.slice(0, i).trim()), note: uq(t.slice(i + 1).trim()) };
}

function parse(src) {
  const model = {
    direction: 'RIGHT', spacing: 1, title: '', caption: [], cartouche: [], marks: [],
    nodes: new Map(), frames: new Map(), rails: new Map(), groups: [], edges: [], keys: [], aligns: [], sameSize: [], events: [], mode: 'flow', errors: [],
  };
  const root = { type: 'root', id: '', items: [], parent: null };
  model.root = root;
  const stack = [root];
  let fcount = 0, gcount = 0;
  const cur = () => stack[stack.length - 1];

  function placeNode(n, container) {
    while (container.type === 'seqblock') container = container.parent;
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

  let inCartouche = false;
  function handle(line, ln) {
    if (inCartouche) {
      // cartouche { author: Yves ... }: free key: value lines, drawn as a small table at the bottom right
      if (line === '}') { inCartouche = false; return; }
      const c = line.indexOf(':');
      if (c <= 0) throw new TraceError('A cartouche line reads  key: value  (author: Yves, date: 2026-11-25, version: 1.2)');
      model.cartouche.push({ key: line.slice(0, c).trim(), value: unquote(line.slice(c + 1).trim()) });
      return;
    }
    if (/^cartouche\s*\{$/i.test(line)) {
      if (stack.length > 1) throw new TraceError('A cartouche goes at the top level, outside every block');
      inCartouche = true;
      return;
    }
    if (line === '}') {
      if (stack.length === 1) throw new TraceError('There is no open block for this } to close');
      const closed = stack.pop();
      if (closed.type === 'seqblock') model.events.push({ type: 'blockEnd', block: closed, line: ln });
      return;
    }
    let m;
    const top = stack[stack.length - 1];
    if (top.type === 'tablebody' && line !== '}') {
      // a column: name [type words] [pk] [fk] [unique] [null]
      const words = line.split(/\s+/);
      const name = words[0];
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new TraceError(`"${name}" is not a column name: use letters, digits and _, as in  user_id uuid fk`);
      if (top.node.cols.some(c => c.name === name)) throw new TraceError(`The table "${top.node.id}" already has a column called "${name}"`);
      const marks = [], type = [];
      for (const w of words.slice(1)) { if (COL_MARKS.has(w.toLowerCase())) marks.push(w.toLowerCase()); else if (w.toLowerCase() === 'uq') marks.push('unique'); else type.push(w); }
      top.node.cols.push({ name, type: type.join(' '), marks: [...new Set(marks)] });
      return;
    }
    if (/^sequence$/i.test(line)) { model.mode = 'sequence'; return; }
    // tree: draw the hierarchy as an org chart (each parent centred over its children; stem, bar and drops)
    if (/^tree$/i.test(line)) { model.tree = ln || true; return; }
    if ((m = line.match(/^note\s+(over|left\s+of|right\s+of)\s+([^:]+?)\s*:\s*(.+)$/i))) {
      // note over a[, b] : text    note left of a : text    note right of a : text
      if (model.mode !== 'sequence') throw new TraceError('A note belongs to a sequence diagram: put the line  sequence  at the top');
      const where = m[1].toLowerCase().replace(/\s+/g, ' ');
      const ids = m[2].split(/[\s,]+/).filter(Boolean);
      if (ids.length < 1 || ids.length > (where === 'over' ? 2 : 1)) throw new TraceError(where === 'over' ? 'note over takes one or two participants: note over api, db : text' : `note ${where} takes one participant: note ${where} api : text`);
      for (const id of ids) ensure(id, ln);
      model.events.push({ type: 'note', where, ids, text: m[3].trim().replace(/\\n/g, '\n'), line: ln });
      return;
    }
    if ((m = line.match(/^(else|and)\b\s*(.*)$/i)) && stack[stack.length - 1].type === 'seqblock') {
      model.events.push({ type: 'divider', word: m[1].toLowerCase(), title: unquote(m[2]), block: stack[stack.length - 1], line: ln });
      return;
    }
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
    if ((m = line.match(/^caption\s+(.+)$/i))) { model.caption.push(unquote(m[1])); return; }
    if ((m = line.match(/^same-(width|height)\s+(.+)$/i))) {
      // same-width a b c: make them as wide as the widest (nodes, or frames; not a mix)
      const ids = m[2].trim().split(/[\s,]+/).filter(Boolean);
      if (ids.length < 2) throw new TraceError(`same-${m[1].toLowerCase()} takes two or more names: same-${m[1].toLowerCase()} edge dmz app`);
      for (const id of ids) if (!ID_RE.test(id)) throw new TraceError(`"${id}" is not a valid name`);
      model.sameSize.push({ axis: m[1].toLowerCase() === 'width' ? 'w' : 'h', ids, line: ln });
      return;
    }
    if ((m = line.match(/^align\s+(.+)$/i))) {
      // align a b [c ...]: keep each pair level, by making the link between them straight
      const ids = m[1].trim().split(/[\s,]+/).filter(Boolean);
      if (ids.length < 2) throw new TraceError('align takes two or more nodes that are linked, one after the other: align topic consumer');
      for (const id of ids) if (!ID_RE.test(id)) throw new TraceError(`"${id}" is not a valid name`);
      for (let i = 1; i < ids.length; i++) model.aligns.push({ a: ids[i - 1], b: ids[i], line: ln });
      return;
    }
    if ((m = line.match(/^mark\s+([A-Za-z0-9_][\w.-]*)\s*(.*)$/i)) && !/^\s*(->|-->|<-|<->|--|:)/.test(m[2])) {
      // mark flagd [flag] "reads feature flags from Flagd": the links into flagd are not drawn; each node they
      // come from carries the icon instead, and the legend says what it means
      if (model.mode === 'sequence') throw new TraceError('A mark belongs to a flow diagram, not a sequence diagram');
      const mm = m[2].match(/^(?:\[([^\]]*)\])?\s*(?:"([^"]*)"|:\s*(.*))?\s*$/);
      if (!mm) throw new TraceError('A mark reads: mark flagd [flag] "reads feature flags from Flagd"');
      const icon = (mm[1] || '').trim() || null;
      if (icon && !iconKnown(icon)) throw new TraceError(`There is no icon called "${icon}"${iconHint(icon)}`);
      const text = (mm[2] !== undefined ? mm[2] : mm[3] || '').trim();
      if (!text) throw new TraceError(`A mark needs the words for the legend: mark ${m[1]}${icon ? ` [${icon}]` : ''} "reads feature flags from ${m[1]}"`);
      if (model.marks.some(k => k.id === m[1])) throw new TraceError(`"${m[1]}" is already marked: one mark line per node`);
      model.marks.push({ id: m[1], icon, text, line: ln });
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
      const tb = head.match(/^table\b\s*(.*)$/i);
      if (tb) {
        if (model.mode === 'sequence') throw new TraceError('Tables belong to a flow diagram, not a sequence diagram');
        const parent0 = cur();
        if (parent0.type === 'group' || parent0.type === 'rail') throw new TraceError('A table goes in a frame or at the top level, not inside a row, column or rail');
        let { rest, tags } = takeTags(tb[1], NODE_TAG_SET, 'a table');
        let title = '';
        const qm = rest.match(/"([^"]*)"\s*$/);
        if (qm) { title = qm[1]; rest = rest.slice(0, qm.index).trim(); }
        const id = rest.trim();
        if (!id || !ID_RE.test(id)) throw new TraceError('A table needs a name: table orders {   (or table orders "Orders" {)');
        if (model.frames.has(id) || model.rails.has(id)) throw new TraceError(`"${id}" is already a frame or rail`);
        let icon = null;
        tags = tags.filter(t => { if (!NODE_TAGS.has(t) && t !== 'top') { icon = t; return false; } return t !== 'top'; });
        let n = model.nodes.get(id);
        if (n && !n.implicit) throw new TraceError(`There is already a node or table called "${id}"`);
        if (!n) { n = { type: 'node', id, kind: 'table', name: '', note: '', tags: [], parent: null, line: ln }; model.nodes.set(id, n); }
        Object.assign(n, { kind: 'table', name: title || id, cols: [], implicit: false, line: ln });
        n.tags = [...new Set(n.tags.concat(tags))];
        if (icon) n.icon = icon;
        placeNode(n, parent0);
        stack.push({ type: 'tablebody', node: n, parent: parent0 });
        return;
      }
      const sb = head.match(/^(loop|alt|opt|par)\b\s*(.*)$/i);
      if (sb) {
        if (model.mode !== 'sequence') throw new TraceError(`${sb[1].toLowerCase()} groups messages in a sequence diagram: put the line  sequence  at the top`);
        const blk = { type: 'seqblock', kind: sb[1].toLowerCase(), title: unquote(sb[2]), parent: cur(), line: ln };
        stack.push(blk);
        model.events.push({ type: 'blockStart', block: blk, line: ln });
        return;
      }
      if (model.mode === 'sequence') throw new TraceError('A sequence diagram has no frames, rows or columns: group messages with loop, alt, opt or par');
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
        let { rest, tags } = takeTags(hm[2], FRAME_TAG_SET, 'frame');
        const flogo = tags.find(t => !SIDE_FRAME_TAGS.has(t));
        tags = tags.filter(t => SIDE_FRAME_TAGS.has(t));
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
        // a title written "" means none; no title written shows the name
        const f = { type: 'frame', id, title: qm ? title : (id.startsWith('_') ? '' : id), tags, items: [], parent, line: ln };
        if (flogo) f.logo = flogo;
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
      let { rest, tags } = takeTags(lhs.trim(), EDGE_TAG_SET, 'a link');
      if (label) { const lt = labelTags(label, EDGE_TAG_SET); label = lt.label; tags = tags.concat(lt.tags); }
      const parts = rest.split(ARROWS).map(s => s.trim());
      if (parts.length < 3 || parts.length % 2 === 0 || parts.some((p, i) => i % 2 === 0 && !p)) {
        throw new TraceError('A link reads: a -> b : label   (also -->, <-, <->, --)');
      }
      for (let i = 0; i < parts.length; i += 2) ensure(parts[i], ln);
      for (let i = 1; i < parts.length; i += 2) {
        const op = parts[i], a = parts[i - 1], b = parts[i + 1];
        const edge = {
          a, b, op, label: label ? (/^"[^"]*"$/.test(label) ? label.slice(1, -1) : label).replace(/\\n/g, '\n') : '',
          tags: tags.slice(),
          dashed: op === '-->' || op === '<--' || tags.includes('dashed'),
          start: op.startsWith('<'), end: op.endsWith('>'),
          line: ln,
        };
        model.edges.push(edge);
        model.events.push({ type: 'msg', e: edge });
      }
      return;
    }

    // node declaration
    let { rest, tags } = takeTags(lhs.trim(), NODE_TAG_SET, 'a node');
    if (label) { const lt = labelTags(label, NODE_TAG_SET); label = lt.label; tags = tags.concat(lt.tags); }
    let icon = null, iconTop = false, logo = null;
    tags = tags.filter(t => { if (t === 'top') { iconTop = true; return false; } if (!NODE_TAGS.has(t)) { if (isLogoTag(t)) logo = t; else icon = t; return false; } return true; });
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
    if (logo) n.logo = logo;
    if (iconTop) { if (!n.icon && !n.logo) throw new TraceError('"top" places an icon above the text, so give the node an icon: db [database top]: Orders'); n.iconTop = true; }
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
  if (inCartouche) model.errors.push({ line: src.split('\n').findIndex(l => /^\s*cartouche\s*\{\s*$/i.test(l)) + 1, msg: 'The cartouche is never closed with }' });
  if (stack.length > 1) {
    const open = stack[stack.length - 1];
    model.errors.push({ line: open.line, msg: `This ${open.type === 'frame' ? 'frame' : open.axis === 'v' ? 'column' : 'row'} is never closed with }` });
  }
  // orders.user_id: a column of a table. Reading a link made a node of that name; turn it back into
  // the table and the column.
  for (const [id, n] of [...model.nodes]) {
    if (!n.implicit || !id.includes('.')) continue;
    for (let dot = id.indexOf('.'); dot >= 0; dot = id.indexOf('.', dot + 1)) {
      const t = model.nodes.get(id.slice(0, dot)), col = id.slice(dot + 1);
      if (!t || t.kind !== 'table') continue;
      const edgesOf = model.edges.filter(e => e.a === id || e.b === id);
      if (!t.cols.some(c => c.name === col)) {
        for (const e of edgesOf) model.errors.push({ line: e.line, msg: `The table "${t.id}" has no column "${col}". Its columns are: ${t.cols.map(c => c.name).join(', ') || '(none yet)'}` });
      } else {
        for (const e of edgesOf) { if (e.a === id) { e.a = t.id; e.aCol = col; } if (e.b === id) { e.b = t.id; e.bCol = col; } }
      }
      if (n.parent) n.parent.items.splice(n.parent.items.indexOf(n), 1);
      model.nodes.delete(id);
      break;
    }
  }
  for (const ss of model.sameSize) {
    const word = ss.axis === 'w' ? 'width' : 'height';
    const kinds = ss.ids.map(id => model.nodes.has(id) && !(model.nodes.get(id).parent && model.nodes.get(id).parent.type === 'rail') ? 'node' : model.frames.has(id) ? 'frame' : null);
    const bad = kinds.indexOf(null);
    if (bad >= 0) { model.errors.push({ line: ss.line, msg: `same-${word}: there is no node or frame called "${ss.ids[bad]}"` }); continue; }
    if (new Set(kinds).size > 1) { model.errors.push({ line: ss.line, msg: `same-${word} takes nodes or frames, not a mix: write one line for the nodes and one for the frames` }); continue; }
    ss.kind = kinds[0];
  }
  for (const al of model.aligns) {
    const missing = [al.a, al.b].find(id => !model.nodes.has(id));
    if (missing) { model.errors.push({ line: al.line, msg: `align: there is no node called "${missing}"` }); continue; }
    const linked = model.edges.some(e => (e.a === al.a && e.b === al.b) || (e.a === al.b && e.b === al.a));
    if (!linked) model.errors.push({ line: al.line, msg: `align ${al.a} ${al.b} keeps the link between them straight, so they need one: write ${al.a} -> ${al.b}` });
  }
  for (const mk of model.marks) {
    const t = model.nodes.get(mk.id);
    if (!t) { model.errors.push({ line: mk.line, msg: model.frames.has(mk.id) ? `mark takes a node, not a frame: mark a node inside "${mk.id}"` : `mark: there is no node called "${mk.id}"` }); continue; }
    mk.icon = mk.icon || t.icon || null;
    if (!mk.icon) { model.errors.push({ line: mk.line, msg: `mark ${mk.id} needs an icon, since "${mk.id}" has none: mark ${mk.id} [flag] "${mk.text}"` }); continue; }
    // a link points into the marked node when its arrow ends there (b -> t, or t <- b)
    const into = e => (e.b === mk.id && (e.end || !e.start)) || (e.a === mk.id && e.start && !e.end);
    const links = model.edges.filter(e => into(e) && model.nodes.has(e.a === mk.id ? e.b : e.a) && (e.a === mk.id ? e.b : e.a) !== mk.id);
    if (!links.length) { model.errors.push({ line: mk.line, msg: `mark ${mk.id} draws the links into "${mk.id}" as an icon on the nodes they come from, but no link arrives there: write  checkout -> ${mk.id}` }); continue; }
    for (const e of links) {
      const src = model.nodes.get(e.a === mk.id ? e.b : e.a);
      src.marks = src.marks || [];
      if (!src.marks.includes(mk)) src.marks.push(mk);
    }
    mk.links = links;
    model.edges = model.edges.filter(e => !links.includes(e));
    mk.rest = model.edges.filter(e => e.a === mk.id || e.b === mk.id).length;
    t.markTarget = mk;
  }
  if (!model.errors.length) desugarSides(model);
  return model;
}


// ---------------------------------------------------------------- side zones
// A frame tagged [side] (or [left] [right] [top] [bottom], with [span]) is a zone that stands beside the main
// flow instead of after it: logs, metrics, admin access. Only the two sides across the flow exist: left and
// right in a diagram that flows down, top and bottom in one that flows right. The rest of the diagram goes
// in a block of its own, and the side zones in blocks on either side of it, ordered by where their links come
// from. It is what you would write with rows and columns, written for you.
const SIDE_WORDS = new Set(['left', 'right', 'top', 'bottom']);
function desugarSides(model) {
  const root = model.root;
  const isSide = f => f.type === 'frame' && f.tags.some(t => t === 'side' || t === 'span' || SIDE_WORDS.has(t));
  for (const f of model.frames.values()) {
    if (isSide(f) && f.parent !== root) { model.errors.push({ line: f.line, msg: `The zone "${f.id}" is tagged as a side zone, which goes at the top level: put it outside every frame, row and column` }); return; }
  }
  const sides = root.items.filter(isSide);
  if (!sides.length) return;
  const flowH = model.direction === 'RIGHT';
  const slots = flowH ? ['top', 'bottom'] : ['left', 'right'];
  const dflt = flowH ? 'bottom' : 'right';
  for (const f of sides) {
    const words = f.tags.filter(t => SIDE_WORDS.has(t));
    if (words.length > 1) { model.errors.push({ line: f.line, msg: `A side zone is on one side: write [side ${words[0]}] or [side ${words[1]}], not both` }); return; }
    f.side = words[0] || dflt;
    f.spanSide = f.tags.includes('span');
    if (!f.tags.includes('side') && !words.length) { model.errors.push({ line: f.line, msg: `span on a frame goes with a side: write [side span] for "${f.id}"` }); return; }
    if (!slots.includes(f.side)) { model.errors.push({ line: f.line, msg: `In a diagram that flows ${flowH ? 'right' : 'down'} a side zone goes ${slots[0]} or ${slots[1]}: the other two sides are where the flow starts and ends. Write [side ${slots[0]}] or [side ${slots[1]}] for "${f.id}"` }); return; }
  }
  const main = root.items.filter(i => !sides.includes(i) && i.type !== 'rail');
  if (!main.length) return;
  const toZone = model.edges.find(e => model.frames.has(e.a) || model.frames.has(e.b));
  if (toZone) { const z = model.frames.has(toZone.a) ? toZone.a : toZone.b; model.errors.push({ line: toZone.line, msg: `With side zones, links go between nodes: "${z}" is a zone. Link a node in it (a collector, a gateway) instead` }); return; }
  // where each side zone's links come from: the mean place, in the main flow, of what it is linked to
  const nodesOf = it => { const out = new Set(); (function w(c) { for (const x of c.items || []) { if (x.type === 'node') out.add(x.id); else w(x); } })(it); return out; };
  const mainOf = new Map();
  main.forEach((it, i) => { if (it.type === 'node') mainOf.set(it.id, i); else for (const id of nodesOf(it)) mainOf.set(id, i); if (it.type === 'frame') mainOf.set(it.id, i); });
  const bary = f => {
    const mine = nodesOf(f); mine.add(f.id);
    const idx = [];
    for (const e of model.edges) {
      const a = mine.has(e.a), b = mine.has(e.b);
      if (a === b) continue;
      const other = a ? e.b : e.a;
      if (mainOf.has(other)) idx.push(mainOf.get(other));
    }
    return idx.length ? idx.reduce((t, v) => t + v, 0) / idx.length : null;
  };
  const order = list => list.map((f, i) => ({ f, i, b: bary(f) })).sort((x, y) => (x.b === null ? 1e9 + x.i : x.b) - (y.b === null ? 1e9 + y.i : y.b) || x.i - y.i).map(x => x.f);
  let n = 0;
  const lane = (axis, items) => { const l = { type: 'lane', id: '_side' + (++n), axis, title: '', items, parent: null, line: 0 }; for (const it of items) it.parent = l; return l; };
  const at = side => order(sides.filter(f => f.side === side));
  const mainLane = lane(flowH ? 'h' : 'v', main);
  mainLane.id = '_main';     // the main flow's zones line up like any column's; only the side lanes are left alone
  model.mainLane = mainLane;
  const parts = [];
  if (!flowH) {
    if (at('left').length) parts.push(lane('v', at('left')));
    parts.push(mainLane);
    if (at('right').length) parts.push(lane('v', at('right')));
  } else {
    if (at('top').length) parts.push(lane('h', at('top')));
    parts.push(mainLane);
    if (at('bottom').length) parts.push(lane('h', at('bottom')));
  }
  const outer = lane(flowH ? 'v' : 'h', parts);
  outer.parent = root;
  root.items = [outer, ...root.items.filter(i => i.type === 'rail')];
}

// ---------------------------------------------------------------- measuring

const FONT_NAME = '600 13px Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
const FONT_NOTE = '400 11px Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
const FONT_TITLE = '600 11.5px Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
const FONT_HEAD = '700 16px Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
const FONT_CAP = '400 12px Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
const FONT_CK = '400 10.5px Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
const FONT_CV = '600 11px Inter, system-ui, -apple-system, "Segoe UI", sans-serif';

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

const FONT_COL = '400 12px Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
const MARK_TEXT = { pk: 'PK', fk: 'FK', unique: 'UQ' };
function sizeTable(n, measure) {
  n.nameLines = []; n.noteLines = []; n.textH = 0; n.padX = 14;
  n.iconMarkup = n.icon ? iconSvg(n.icon) : null;
  n.headH = 30; n.rowH = 22;
  const anyMarks = n.cols.some(c => c.marks.some(m => MARK_TEXT[m]));
  // room for the longest run of markers (PK FK)
  n.markW = anyMarks ? Math.ceil(Math.max(...n.cols.map(c => measure(c.marks.filter(m => MARK_TEXT[m]).map(m => MARK_TEXT[m]).join(' '), '700 9px Inter, system-ui, sans-serif')))) + 14 : 0;
  const head = measure(n.name, FONT_NAME) + 28 + (n.iconMarkup ? ICON_SIZE + 8 : 0);
  let rows = 0;
  for (const c of n.cols) {
    const t = c.type ? c.type + (c.marks.includes('null') ? '?' : '') : '';
    rows = Math.max(rows, 24 + n.markW + measure(c.name, FONT_COL) + (t ? 24 + measure(t, FONT_NOTE) : 0));
  }
  n.w = even(Math.max(110, head, rows));
  n.h = even(n.headH + n.cols.length * n.rowH + (n.cols.length ? 8 : 0));
  n.ports = [];
}
function sizeNode(n, measure) {
  if (n.kind === 'table') return sizeTable(n, measure);
  if (n.kind === 'start') { n.w = 18; n.h = 18; n.nameLines = []; n.noteLines = []; return; }
  if (n.kind === 'junction') {
    // a bar as long as its links need, 14px apart; it runs across the flow (flowH: set by the layout)
    const L = Math.max(28, (n.links - 1) * 14 + 14);
    n.w = n.barV ? 6 : L; n.h = n.barV ? L : 6; n.nameLines = []; n.noteLines = []; n.textH = 0; n.ports = []; return;
  }
  n.nameLines = n.name ? wrap(n.name, FONT_NAME, 210, measure) : [];
  // with a role icon and a logo, the note starts with the technology's name ("Redis · sessions, 1 h"), so the
  // logo before it always stands beside its name; the note as written is kept for the next sizing
  if (n.noteWritten === undefined) n.noteWritten = n.note || '';
  const lg = n.logo && n.icon && n.kind !== 'table' ? logoData(n.logo) : null;
  n.note = lg && iconSvg(n.icon) ? (!n.noteWritten ? lg.t : n.noteWritten.toLowerCase().startsWith(lg.t.toLowerCase()) ? n.noteWritten : `${lg.t} · ${n.noteWritten}`) : n.noteWritten;
  n.noteLines = n.note ? wrap(n.note, FONT_NOTE, 230, measure) : [];
  const tw = Math.max(0, ...n.nameLines.map(l => measure(l, FONT_NAME)), ...n.noteLines.map(l => measure(l, FONT_NOTE)));
  n.textH = n.nameLines.length * 16 + n.noteLines.length * 14;
  n._nameW = n.nameLines.length ? measure(n.nameLines[0], FONT_NAME) : 0;
  const padX = (n.kind === 'ask' || n.kind === 'pill') ? 24 : 15;
  n.padX = padX;
  n.iconMarkup = n.icon ? iconSvg(n.icon) : null;
  // a logo: in the icon's place when there is no icon, else small, before the technology's name in the note
  n.logoD = n.logo ? (logoData(n.logo) || {}).d || null : null;
  n.logoMain = !!(n.logoD && !n.iconMarkup);
  n.logoSmall = !!(n.logoD && n.iconMarkup);
  const tw2 = n.logoSmall ? Math.max(0, ...n.nameLines.map(l => measure(l, FONT_NAME)), ...n.noteLines.map((l, i) => measure(l, FONT_NOTE) + (i ? 0 : LOGO_SMALL + 4))) : 0;
  if (n.logoSmall) { n.textH = n.nameLines.length * 16 + n.noteLines.length * 14; n._noteW = measure(n.noteLines[0], FONT_NOTE); }
  const slot = (n.iconMarkup || n.logoMain) && !n.iconTop ? ICON_SIZE + 8 : 0;
  n.markW = n.marks && n.marks.length ? n.marks.length * (MARK_SIZE + 5) + 3 : 0;
  n.w = even(Math.max(72, Math.max(tw, tw2) + 2 * padX + slot + n.markW));
  n.h = even(Math.max(36, n.textH + 16 + ((n.iconMarkup || n.logoMain) && n.iconTop ? ICON_SIZE + 4 : 0)));
  if (n.kind === 'final') { n.w += 8; n.h += 8; }
}

function sizeLabel(text, measure) {
  if (!text) return null;
  const lines = wrap(text, FONT_NOTE, 150, measure);
  return { lines, w: Math.ceil(Math.max(...lines.map(l => measure(l, FONT_NOTE)))) + 6, h: lines.length * 13 + 2 };
}

// ---------------------------------------------------------------- layout

// ---- sequence diagrams (see layoutSequence)

// Participants run across the top in the order they were first mentioned; time runs down. Messages are
// the links, in the order written; notes, and loop/alt/opt/par groups, sit between them. The result has
// the shape the renderer already draws: boxes (participants and notes), frames (groups) and links
// (lifelines, messages, dividers), so icons, kinds, tags and the light and dark themes all apply.
async function layoutSequence(model, measure) {
  const parts = [...model.nodes.values()];
  for (const n of parts) sizeNode(n, measure);
  model.edges.forEach((e, i) => { e.i = i; e.lab = sizeLabel(e.label, measure); });
  const TOP = 16, H = Math.max(36, ...parts.map(n => n.h));
  for (const n of parts) n.h = H;
  const idx = new Map(parts.map((n, i) => [n.id, i]));
  const k = parts.length;

  // notes: wrap the text and size the box
  const notes = model.events.filter(ev => ev.type === 'note');
  for (const nt of notes) {
    nt.lines = wrap(nt.text, FONT_NOTE, 210, measure);
    nt.w = Math.ceil(Math.max(...nt.lines.map(l => measure(l, FONT_NOTE)))) + 20;
    nt.h = nt.lines.length * 14 + 14;
  }

  // distance between neighbouring lifelines: boxes must not touch, and every message label, self message
  // and two-participant note must fit in the span it crosses (shortest spans first)
  const d = parts.slice(1).map((n, i) => (parts[i].w + n.w) / 2 + 28);
  const need = [];
  for (const ev of model.events) {
    if (ev.type === 'msg') {
      const a = idx.get(ev.e.a), b = idx.get(ev.e.b);
      if (a === b) { if (a < k - 1) need.push({ lo: a, hi: a + 1, v: 52 + (ev.e.lab ? ev.e.lab.w : 0) }); }
      else need.push({ lo: Math.min(a, b), hi: Math.max(a, b), v: (ev.e.lab ? ev.e.lab.w : 0) + 44 });
    } else if (ev.type === 'note' && ev.ids.length === 2) {
      const a = idx.get(ev.ids[0]), b = idx.get(ev.ids[1]);
      if (a !== b) need.push({ lo: Math.min(a, b), hi: Math.max(a, b), v: ev.w - 30 });
    }
  }
  need.sort((x, y) => (x.hi - x.lo) - (y.hi - y.lo));
  for (const r of need) {
    const have = d.slice(r.lo, r.hi).reduce((t, v) => t + v, 0);
    if (have < r.v) { const add = (r.v - have) / (r.hi - r.lo); for (let i = r.lo; i < r.hi; i++) d[i] += add; }
  }
  const cx = [parts[0].w / 2];
  for (let i = 1; i < k; i++) cx.push(cx[i - 1] + d[i - 1]);
  const X = id => cx[idx.get(id)];

  const edges = [], nodes = [...parts], frames = [], texts = [];
  const open = [];       // groups being filled
  const closed = [];
  let y = TOP + H + 26, minX = 0, maxX = cx[k - 1] + parts[k - 1].w / 2, noteN = 0;
  const reach = (x1, x2) => { for (const b of open) { b.x1 = Math.min(b.x1, x1); b.x2 = Math.max(b.x2, x2); } minX = Math.min(minX, x1); maxX = Math.max(maxX, x2); };
  for (const ev of model.events) {
    if (ev.type === 'msg') {
      const e = ev.e, ca = X(e.a), cb = X(e.b), lab = e.lab, lh = lab ? lab.h : 0;
      if (e.a === e.b) {
        const ys = y + 6, w = 34;
        edges.push({ e, pts: [{ x: ca, y: ys }, { x: ca + w, y: ys }, { x: ca + w, y: ys + 22 }, { x: ca, y: ys + 22 }], lab: lab ? { x: ca + w + 6, y: ys + 11 - lh / 2, anchor: 'start' } : null });
        reach(ca - 8, ca + w + (lab ? lab.w + 8 : 8));
        y = ys + 22 + 18 + Math.max(0, lh - 22);
      } else {
        const ay = y + lh + 14;
        edges.push({ e, pts: [{ x: ca, y: ay }, { x: cb, y: ay }], lab: lab ? { x: (ca + cb) / 2, y: ay - 6 - lh, anchor: 'middle' } : null });
        reach(Math.min(ca, cb) - 8, Math.max(ca, cb) + 8);
        y = ay + 18;
      }
    } else if (ev.type === 'note') {
      const [a, b] = ev.ids.map(X);
      let x;
      if (ev.where === 'over') { const w = ev.ids.length === 2 ? Math.max(ev.w, Math.abs(b - a) + 40) : ev.w; ev.w = w; x = ev.ids.length === 2 ? Math.min(a, b) - 20 : a - w / 2; }
      else if (ev.where === 'left of') x = a - 12 - ev.w;
      else x = a + 12;
      nodes.push({ id: '_note' + (++noteN), type: 'node', kind: 'store', name: '', note: '', nameLines: [], noteLines: ev.lines, textH: ev.lines.length * 14, padX: 10, w: ev.w, h: ev.h, x, y: y + 4, tags: [], parent: null, iconMarkup: null });
      reach(x, x + ev.w);
      y += ev.h + 18;
    } else if (ev.type === 'blockStart') {
      const b = { block: ev.block, y1: y, x1: Infinity, x2: -Infinity, depth: open.length, dividers: [] };
      open.push(b);
      y += 30;
    } else if (ev.type === 'divider') {
      const b = open[open.length - 1];
      if (b) { b.dividers.push({ y: y + 2, title: ev.title, word: ev.word }); y += 28; }
    } else if (ev.type === 'blockEnd') {
      const b = open.pop();
      if (!b) continue;
      b.y2 = y + 2;
      closed.push(b);
      y += 18;
    }
  }
  const bottom = y + 8;

  // groups: wide enough for what is inside, each one a little wider than the groups it holds
  const byDepth = closed.slice().sort((p, q) => q.depth - p.depth);
  for (const b of byDepth) {
    if (b.x1 === Infinity) { b.x1 = cx[0] - 20; b.x2 = cx[k - 1] + 20; }
    b.x1 -= 14; b.x2 += 14;
    for (const c of closed) if (c !== b && c.depth === b.depth + 1 && c.y1 >= b.y1 && c.y2 <= b.y2) { b.x1 = Math.min(b.x1, c.x1 - 8); b.x2 = Math.max(b.x2, c.x2 + 8); }
    minX = Math.min(minX, b.x1); maxX = Math.max(maxX, b.x2);
  }

  // everything moves right if something reaches past the left edge
  const dx = 16 - minX;
  for (const n of nodes) { if (n.kind === 'store' && n.id.startsWith('_note')) n.x += dx; else { n.x = cx[idx.get(n.id)] - n.w / 2 + dx; n.y = TOP; } }
  for (const r of edges) { r.pts.forEach(p => { p.x += dx; }); if (r.lab) r.lab.x += dx; }
  const lifelines = parts.map((n, i) => ({ e: { a: n.id, b: n.id, tags: ['muted'], dashed: true, start: false, end: false, label: '', lab: null, lifeline: true }, pts: [{ x: cx[i] + dx, y: TOP + H }, { x: cx[i] + dx, y: bottom }], lab: null }));
  const dividers = [];
  for (const b of closed) {
    const f = { type: 'frame', id: '_seq' + frames.length, title: b.block.kind + (b.block.title ? '  ' + b.block.title : ''), tags: ['grey'], items: [], parent: null };
    f.titleW = measure(f.title, FONT_TITLE);
    frames.push({ f, x: b.x1 + dx, y: b.y1, w: b.x2 - b.x1, h: b.y2 - b.y1, depth: b.depth, titleLeft: true });
    for (const dv of b.dividers) {
      const lab = dv.title ? { lines: [dv.word + '  ' + dv.title], w: measure(dv.word + '  ' + dv.title, FONT_NOTE), h: 13 } : null;
      dividers.push({ e: { a: '', b: '', tags: ['muted'], dashed: true, start: false, end: false, label: dv.title, lab, divider: true }, pts: [{ x: b.x1 + dx, y: dv.y }, { x: b.x2 + dx, y: dv.y }], lab: lab ? { x: b.x1 + dx + 8, y: dv.y + 4, anchor: 'start' } : null });
    }
  }
  frames.sort((p, q) => p.depth - q.depth);
  const rm = { nodes, frames, edges: [...lifelines, ...dividers, ...edges], rails: [], width: maxX + dx + 16, height: bottom + 16, model, notes: [] };
  return rm;
}

// A link that goes across, down, across, down, across (or down, across, down, across, down) has one step more
// than it needs: ELK's channel assignment put two runs side by side where one would do. When one run in the
// gap, at the place farthest from frame borders, is clear of nodes and other links, the link takes that.
function simplifySnakes(rm) {
  const eq = (a, b) => Math.abs(a - b) < 0.5;
  for (const r of rm.edges) {
    if (r.e.rail || r.e.lifeline || !r.pts || r.pts.length < 6) continue;
    const q = simplifyPts(r.pts);
    if (q.length !== 6) continue;
    const vertical = eq(q[0].x, q[1].x) && eq(q[1].y, q[2].y) && eq(q[2].x, q[3].x) && eq(q[3].y, q[4].y) && eq(q[4].x, q[5].x);
    const horizontal = eq(q[0].y, q[1].y) && eq(q[1].x, q[2].x) && eq(q[2].y, q[3].y) && eq(q[3].x, q[4].x) && eq(q[4].y, q[5].y);
    if (vertical === horizontal) continue;
    const A = vertical ? 'y' : 'x', B = vertical ? 'x' : 'y';       // A runs along the link's direction, B across
    const a0 = q[0][A], a5 = q[5][A], dir = Math.sign(a5 - a0);
    if (!dir) continue;
    // the two runs across, and a few places between them
    const m1 = q[1][A], m2 = q[3][A];
    if (Math.sign(m1 - a0) !== dir || Math.sign(a5 - m2) !== dir) continue;
    const cands = [m1, m2, (m1 + m2) / 2, (a0 + a5) / 2].filter(v => Math.sign(v - a0) === dir && Math.sign(a5 - v) === dir && Math.abs(v - a0) > 8 && Math.abs(a5 - v) > 8);
    const borderGap = v => Math.min(Infinity, ...rm.frames.filter(f => (vertical
      ? Math.min(q[0].x, q[5].x) < f.x + f.w && f.x < Math.max(q[0].x, q[5].x)
      : Math.min(q[0].y, q[5].y) < f.y + f.h && f.y < Math.max(q[0].y, q[5].y)))
      .flatMap(f => vertical ? [Math.abs(v - f.y), Math.abs(v - f.y - f.h)] : [Math.abs(v - f.x), Math.abs(v - f.x - f.w)]));
    const segs = v => vertical
      ? [{ x1: q[0].x, x2: q[0].x, y1: Math.min(a0, v), y2: Math.max(a0, v) }, { x1: Math.min(q[0].x, q[5].x), x2: Math.max(q[0].x, q[5].x), y1: v, y2: v }, { x1: q[5].x, x2: q[5].x, y1: Math.min(a5, v), y2: Math.max(a5, v) }]
      : [{ y1: q[0].y, y2: q[0].y, x1: Math.min(a0, v), x2: Math.max(a0, v) }, { y1: Math.min(q[0].y, q[5].y), y2: Math.max(q[0].y, q[5].y), x1: v, x2: v }, { y1: q[5].y, y2: q[5].y, x1: Math.min(a5, v), x2: Math.max(a5, v) }];
    const clear = v => segs(v).every(sg => !rm.nodes.some(n => n.x !== undefined && sg.x1 < n.x + n.w - 0.5 && n.x + 0.5 < sg.x2 + (sg.x1 === sg.x2 ? 0.01 : 0) && sg.y1 < n.y + n.h - 0.5 && n.y + 0.5 < sg.y2 + (sg.y1 === sg.y2 ? 0.01 : 0))) &&
      // only the new run across can lie along another link: the first and last run are where they were
      !segs(v).filter((sg, i) => i === 1).some(sg => rm.edges.some(o => {
        if (o === r || !o.pts) return false;
        for (let i = 1; i < o.pts.length; i++) {
          const u = o.pts[i - 1], w = o.pts[i];
          if (sg.y1 === sg.y2 && eq(u.y, w.y) && Math.abs(u.y - sg.y1) < 3 && Math.min(u.x, w.x) < sg.x2 && sg.x1 < Math.max(u.x, w.x)) return true;
          if (sg.x1 === sg.x2 && eq(u.x, w.x) && Math.abs(u.x - sg.x1) < 3 && Math.min(u.y, w.y) < sg.y2 && sg.y1 < Math.max(u.y, w.y)) return true;
        }
        return false;
      }));
    let best = null;
    for (const v of cands) { if (!clear(v)) continue; const g = Math.min(borderGap(v), 40); if (!best || g > best.g + 0.5) best = { v, g }; }
    if (!best) continue;
    const v = best.v;
    r.pts = vertical ? [q[0], { x: q[0].x, y: v }, { x: q[5].x, y: v }, q[5]] : [q[0], { x: v, y: q[0].y }, { x: v, y: q[5].y }, q[5]];
  }
}

// A link label that a link, a node or another label runs through moves to the nearest clear place along its
// own link (above or below a horizontal stretch, left or right of a vertical one). Labels that are clear are
// not touched, so a diagram that was fine stays exactly as it was. ELK keeps labels off nodes but not off
// the other links, which is where the strike-throughs came from.
function placeLabels(rm, measure) {
  // a box for a label (its own size unless another shape is given)
  const boxOf = (lab, e, shape) => {
    const w = shape ? shape.w : e.lab.w, h = shape ? shape.h : e.lab.h;
    const x0 = lab.anchor === 'middle' ? lab.x - w / 2 : lab.anchor === 'end' ? lab.x - w : lab.x;
    return { x: x0, y: lab.y, w, h };
  };
  const hitSeg = (b, a, p) => Math.min(a.x, p.x) < b.x + b.w && b.x < Math.max(a.x, p.x) && Math.min(a.y, p.y) < b.y + b.h && b.y < Math.max(a.y, p.y);
  const labelled = rm.edges.filter(r => r.lab && r.e.lab && r.pts && r.pts.length > 1 && !r.e.lifeline && !r.e.divider);
  const placed = [];       // boxes of labels already settled
  const collisions = (r, b) => {
    let n = 0;
    for (const o of rm.edges) {
      if (!o.pts || o.e.lifeline && false) continue;
      for (let i = 1; i < o.pts.length; i++) if (hitSeg(b, o.pts[i - 1], o.pts[i])) n++;
    }
    for (const nd of rm.nodes) if (nd.x !== undefined && b.x < nd.x + nd.w && nd.x < b.x + b.w && b.y < nd.y + nd.h && nd.y < b.y + b.h) n += 2;
    for (const q of placed) if (b.x < q.x + q.w + 2 && q.x < b.x + b.w + 2 && b.y < q.y + q.h + 1 && q.y < b.y + b.h + 1) n += 2;
    // a label straddling a zone's border reads as belonging to neither side
    for (const f of rm.frames) {
      const inY = b.y < f.y + f.h && f.y < b.y + b.h, inX = b.x < f.x + f.w && f.x < b.x + b.w;
      if (inY && [f.x, f.x + f.w].some(v => b.x + 2 < v && v < b.x + b.w - 2)) n += 1;
      if (inX && [f.y, f.y + f.h].some(v => b.y + 2 < v && v < b.y + b.h - 2)) n += 1;
    }
    // a label belongs next to its own link: far from every stretch of it counts as a collision
    let near = Infinity;
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], p = r.pts[i];
      const dx = Math.max(0, Math.min(a.x, p.x) - (b.x + b.w), b.x - Math.max(a.x, p.x));
      const dy = Math.max(0, Math.min(a.y, p.y) - (b.y + b.h), b.y - Math.max(a.y, p.y));
      near = Math.min(near, Math.hypot(dx, dy));
    }
    if (near > 16) n += 1;
    return n;
  };
  for (const r of labelled) {
    const w = r.e.lab.w, h = r.e.lab.h;
    const cur = boxOf(r.lab, r.e);
    if (collisions(r, cur) === 0) {
      // clear already; but a label below a horizontal stretch reads better above it, when that is clear too
      for (let i = 1; i < r.pts.length; i++) {
        const a = r.pts[i - 1], p = r.pts[i];
        if (Math.abs(a.y - p.y) > 0.5 || !(Math.min(a.x, p.x) - 2 < cur.x + cur.w / 2 && cur.x + cur.w / 2 < Math.max(a.x, p.x) + 2)) continue;
        if (Math.abs(cur.y - a.y) < 10 && cur.y >= a.y - 1) {
          const lab = { x: cur.x + cur.w / 2, y: a.y - 4 - h, anchor: 'middle' };
          const up = boxOf(lab, r.e);
          if (collisions(r, up) === 0) { r.lab = lab; placed.push(up); cur.moved = true; }
        }
        break;
      }
      if (!cur.moved) placed.push(cur);
      continue;
    }
    const cands = [];
    // the same label on two lines is narrower: a second shape to try when the single line has no room
    const words = r.e.lab.lines.length === 1 ? r.e.lab.lines[0].split(' ') : [];
    let two = null;
    if (measure && words.length > 1 && r.e.lab.w > 70) {
      let best = 0, bestGap = Infinity;
      for (let i = 1; i < words.length; i++) { const a = measure(words.slice(0, i).join(' '), FONT_NOTE), b = measure(words.slice(i).join(' '), FONT_NOTE); if (Math.abs(a - b) < bestGap) { bestGap = Math.abs(a - b); best = i; } }
      const lines = [words.slice(0, best).join(' '), words.slice(best).join(' ')];
      two = { lines, w: Math.ceil(Math.max(...lines.map(l => measure(l, FONT_NOTE)))) + 6, h: 2 * 13 + 2 };
    }
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], p = r.pts[i];
      const horizontal = Math.abs(a.y - p.y) < 0.5, len = Math.hypot(p.x - a.x, p.y - a.y);
      if (len < 18) continue;
      for (const f of [0.5, 0.3, 0.7, 0.15, 0.85]) {
        const mx = a.x + (p.x - a.x) * f, my = a.y + (p.y - a.y) * f;
        for (const shape of two ? [null, two] : [null]) {
          const hh = shape ? shape.h : h;
          if (horizontal) cands.push({ shape, lab: { x: mx, y: my - 4 - hh, anchor: 'middle' } }, { shape, lab: { x: mx, y: my + 4, anchor: 'middle' } });
          else cands.push({ shape, lab: { x: mx + 6, y: my - hh / 2, anchor: 'start' } }, { shape, lab: { x: mx - 6, y: my - hh / 2, anchor: 'end' } });
        }
      }
    }
    let best = null;
    for (const c of cands) {
      const b = boxOf(c.lab, r.e, c.shape);
      const n = collisions(r, b);
      const dist = Math.hypot(b.x + b.w / 2 - (cur.x + w / 2), b.y + b.h / 2 - (cur.y + h / 2));
      const score = n * 1000 + dist + (c.shape ? 150 : 0);
      if (!best || score < best.score) best = { score, n, lab: c.lab, b, shape: c.shape };
    }
    if (best && best.n < collisions(r, cur)) {
      r.lab = best.lab; placed.push(best.b);
      if (best.shape) r.e.lab = { ...r.e.lab, lines: best.shape.lines, w: best.shape.w, h: best.shape.h };
    } else placed.push(cur);
  }
}

// Keep links off frame borders: a stretch of link that runs along a frame's border closer than 8px
// (ELK routed it before the frames were drawn tight around their members, or a node on a border sent it
// along that border) moves to 12px from it, on the side it was on, when that touches no node and runs
// along no other link. Only the middle of a link moves: the first and last stretch stay on their nodes.
function clearFrames(rm) {
  if (!rm.frames.length) return;
  const NEAR = 8, GOAL = 12, MIN = 12;
  const eq = (a, b) => Math.abs(a - b) < 0.5;
  for (const r of rm.edges) {
    if (r.e.rail || !r.pts || r.pts.length < 4) continue;
    const q = simplifyPts(r.pts);
    if (q.length < 4) continue;
    let changed = false;
    for (let k = 1; k < q.length - 2; k++) {
      const a = q[k], b = q[k + 1];
      const horizontal = eq(a.y, b.y), vertical = eq(a.x, b.x);
      if (horizontal === vertical) continue;
      const A = horizontal ? 'y' : 'x', B = horizontal ? 'x' : 'y';
      const lo = Math.min(a[B], b[B]), hi = Math.max(a[B], b[B]);
      for (const f of rm.frames) {
        const sides = horizontal ? [f.y, f.y + f.h] : [f.x, f.x + f.w];
        const along = horizontal ? [f.x, f.x + f.w] : [f.y, f.y + f.h];
        if (Math.min(hi, along[1]) - Math.max(lo, along[0]) < MIN) continue;
        const border = sides.find(v => Math.abs(a[A] - v) < NEAR);
        if (border === undefined) continue;
        // which side of the border to be on: where it already is, or either when exactly on it
        const dirs = Math.abs(a[A] - border) < 0.5 ? [-1, 1] : [Math.sign(a[A] - border)];
        let moved = false;
        for (const [dir, goal] of dirs.flatMap(d => [12, 10, 14, 16].map(g => [d, g]))) {
          const target = border + dir * goal, delta = target - a[A];
          const prev = q[k - 1], next = q[k + 2];
          // the stretches on either side stretch or shrink: they must keep their direction
          const prevLen = a[A] + delta - prev[A], nextLen = next[A] - (b[A] + delta);
          if (Math.sign(prevLen) !== Math.sign(a[A] - prev[A]) || Math.abs(prevLen) < 4) continue;
          if (Math.sign(nextLen) !== Math.sign(next[A] - b[A]) || Math.abs(nextLen) < 4) continue;
          const seg = horizontal ? { x1: lo, x2: hi, y1: target, y2: target } : { x1: target, x2: target, y1: lo, y2: hi };
          if (rm.nodes.some(n => n.x !== undefined && seg.x1 < n.x + n.w && n.x < seg.x2 && seg.y1 < n.y + n.h && n.y < seg.y2)) continue;
          // no other frame border near the new place
          if (rm.frames.some(g => g !== f && (horizontal ? [g.y, g.y + g.h] : [g.x, g.x + g.w]).some(v => Math.abs(v - target) < NEAR) &&
            Math.min(hi, (horizontal ? g.x + g.w : g.y + g.h)) - Math.max(lo, (horizontal ? g.x : g.y)) >= MIN)) continue;
          // not along another link
          const clash = rm.edges.some(o => {
            if (o === r || !o.pts) return false;
            for (let i = 1; i < o.pts.length; i++) {
              const u = o.pts[i - 1], w = o.pts[i];
              if (horizontal && eq(u.y, w.y) && Math.abs(u.y - target) < 3 && Math.min(u.x, w.x) < hi && lo < Math.max(u.x, w.x)) return true;
              if (!horizontal && eq(u.x, w.x) && Math.abs(u.x - target) < 3 && Math.min(u.y, w.y) < hi && lo < Math.max(u.y, w.y)) return true;
            }
            return false;
          });
          if (clash) continue;
          a[A] = target; b[A] = target;
          changed = true;
          moved = true;
          break;
        }
        if (moved) continue;
      }
    }
    if (changed) r.pts = q;
  }
}

// A link that runs through a node that is not one of its ends is routed again: an orthogonal route on the
// grid of lines just outside every node, the shortest with the fewest bends, from where it leaves its source to
// the side of its target that its route reaches first. Links that are clear are not touched.
function rerouteBlocked(rm, force, siblingsOnly) {
  const M = 8;                                             // the route keeps this far from every node
  const boxes = rm.nodes.filter(n => n.x !== undefined && n.kind !== 'start');
  const inside = (b, x, y, m) => x > b.x - m + 0.01 && x < b.x + b.w + m - 0.01 && y > b.y - m + 0.01 && y < b.y + b.h + m - 0.01;
  const segHits = (a, p, b, m) => Math.min(a.x, p.x) < b.x + b.w + m - 0.5 && b.x - m + 0.5 < Math.max(a.x, p.x) && Math.min(a.y, p.y) < b.y + b.h + m - 0.5 && b.y - m + 0.5 < Math.max(a.y, p.y);
  for (const r of force ? rm.edges.filter(x => force.has(x)) : rm.edges) {
    const e = r.e;
    if (e.rail || e.lifeline || e.divider || (r.merged && !force) || !r.pts || r.pts.length < 2 || e.a === e.b) continue;
    // a link may end on a zone: its box is the end (the route stops at its border, so what is inside stays in the
    // way of a route that would cut through)
    const zoneBox = id => { const fr = rm.frames.find(f => f.f.id === id); return fr ? { id, x: fr.x, y: fr.y, w: fr.w, h: fr.h, zone: fr.f } : null; };
    let S = boxes.find(n => n.id === e.a) || zoneBox(e.a), T = boxes.find(n => n.id === e.b) || zoneBox(e.b);
    if (!S || !T) continue;
    // the points may run either way round (a link written with <-): S is the node at the first point
    const dd = (n, p) => Math.hypot(Math.max(n.x - p.x, 0, p.x - n.x - n.w), Math.max(n.y - p.y, 0, p.y - n.y - n.h));
    if (dd(T, r.pts[0]) < dd(S, r.pts[0])) [S, T] = [T, S];
    const others = boxes.filter(n => n !== S && n !== T);
    // through a node, or brushing past one closer than 6px: both read as touching it
    const blocked = r.pts.some((p, i) => i && others.some(b => segHits(r.pts[i - 1], p, b, 6)));
    // a link that turns right against its node (a first or last stretch under 10px) reads as touching it
    const len = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    const q0 = simplifyPts(r.pts), n = q0.length;
    const hugs = n > 2 && ((len(q0[n - 2], q0[n - 1]) < 10 && !T.cols && !T.span) || (len(q0[0], q0[1]) < 10 && !S.cols && !S.span));
    // a stretch that runs along a frame border, closer than 8px, for more than 20px
    const along = r.pts.some((p, i) => i && rm.frames.some(f => {
      const a = r.pts[i - 1];
      if (Math.abs(a.x - p.x) < 0.5) return Math.min(Math.max(a.y, p.y), f.y + f.h) - Math.max(Math.min(a.y, p.y), f.y) > 20 && (Math.abs(a.x - f.x) < 8 || Math.abs(a.x - f.x - f.w) < 8);
      if (Math.abs(a.y - p.y) < 0.5) return Math.min(Math.max(a.x, p.x), f.x + f.w) - Math.max(Math.min(a.x, p.x), f.x) > 20 && (Math.abs(a.y - f.y) < 8 || Math.abs(a.y - f.y - f.h) < 8);
      return false;
    }));
    // a link with three or more bends is tried again too, and kept only if the new route is clearly shorter:
    // it catches the detours (out one way, round, and back) that a layout leaves behind
    const curCost = q0.reduce((t, p, i) => i ? t + len(q0[i - 1], p) : 0, 0) + 60 * Math.max(0, q0.length - 2);
    const detour = !force && !blocked && !hugs && !along && q0.length >= 5;
    // a link that crosses another link leaving or reaching the same node: it may leave by another side (a pass of its
    // own, last, once the links are spread and pulled apart, so the new route is judged as it will be drawn)
    const sibling = !!siblingsOnly && !force && !blocked && !hugs && !along && !detour && rm.edges.some(o => o !== r && o.pts && (o.e.a === e.a || o.e.b === e.a || o.e.a === e.b || o.e.b === e.b) &&
      r.pts.some((p, i) => i && o.pts.some((q, j) => j && crossSeg(r.pts[i - 1], p, o.pts[j - 1], q))));
    if (siblingsOnly ? !sibling : (!force && !blocked && !hugs && !along && !detour)) continue;
    // first choice: one straight line, when the two nodes overlap across the gap between them (not in the pass for
    // links crossing their siblings: there a new route must prove it crosses less)
    if (!siblingsOnly && !S.cols && !S.span && !T.cols && !T.span) {
      const ox0 = Math.max(S.x, T.x) + 10, ox1 = Math.min(S.x + S.w, T.x + T.w) - 10;
      const oy0 = Math.max(S.y, T.y) + 10, oy1 = Math.min(S.y + S.h, T.y + T.h) - 10;
      let st = null;
      if (ox1 >= ox0) { const x = (ox0 + ox1) / 2; st = S.y + S.h <= T.y ? [{ x, y: S.y + S.h }, { x, y: T.y }] : T.y + T.h <= S.y ? [{ x, y: S.y }, { x, y: T.y + T.h }] : null; }
      else if (oy1 >= oy0) { const y = (oy0 + oy1) / 2; st = S.x + S.w <= T.x ? [{ x: S.x + S.w, y }, { x: T.x, y }] : T.x + T.w <= S.x ? [{ x: S.x, y }, { x: T.x + T.w, y }] : null; }
      if (st && !others.some(b => segHits(st[0], st[1], b, 4))) { r.pts = st; continue; }
    }
    // where it leaves: as it did, a short way straight out of its side
    let p0 = r.pts[0];
    const sideOf = (b, p) => Math.abs(p.x - b.x) < 2 ? [-1, 0] : Math.abs(p.x - b.x - b.w) < 2 ? [1, 0] : Math.abs(p.y - b.y) < 2 ? [0, -1] : [0, 1];
    const [dx0, dy0] = sideOf(S, p0);
    const nearB = (v, vert) => rm.frames.some(f => vert ? Math.abs(v - f.x) < 9 || Math.abs(v - f.x - f.w) < 9 : Math.abs(v - f.y) < 9 || Math.abs(v - f.y - f.h) < 9);
    // a stub long enough that the turn after it is not on a frame border
    const stubOut = (p, dx, dy) => { for (const L of [12, 20, 28, 36, 44]) { const q = { x: p.x + dx * L, y: p.y + dy * L }; if (!(dx ? nearB(q.x, true) : nearB(q.y, false))) return q; } return { x: p.x + dx * 12, y: p.y + dy * 12 }; };
    // a start that would send the link up along a frame border slides along its side, away from it
    if (!S.cols && !S.span && S.kind !== 'junction') {
      const along = dy0 ? 'x' : 'y', lo = (dy0 ? S.x : S.y) + 8, hi = (dy0 ? S.x + S.w : S.y + S.h) - 8;
      if (nearB(p0[along], !!dy0)) for (const k of [16, -16, 28, -28, 40, -40]) { const v = p0[along] + k; if (v >= lo && v <= hi && !nearB(v, !!dy0)) { p0 = { ...p0, [along]: v }; break; } }
    }
    const s1 = stubOut(p0, dx0, dy0);
    // it may also leave from the middle of another side of its source (a little dearer than where it was)
    const starts = [{ p: p0, s: s1, d: [dx0, dy0], extra: 0 }];
    // a [span] node keeps the side a link leaves from, but the link may leave near either end of it, past the links
    // to its stack, instead of between them
    if (S.span && !S.cols) for (const k of [0.04, 0.96]) {
      const p = dy0 ? { x: S.x + S.w * k, y: p0.y } : { x: p0.x, y: S.y + S.h * k };
      if (Math.abs((dy0 ? p.x - p0.x : p.y - p0.y)) < 12 || nearB(dy0 ? p.x : p.y, !!dy0)) continue;
      starts.push({ p, s: stubOut(p, dx0, dy0), d: [dx0, dy0], extra: 20 });
    }
    if (!S.cols && !S.span && S.kind !== 'junction') for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      if (dx === dx0 && dy === dy0) continue;
      const p = { x: dx < 0 ? S.x : dx > 0 ? S.x + S.w : S.x + S.w / 2, y: dy < 0 ? S.y : dy > 0 ? S.y + S.h : S.y + S.h / 2 };
      if (nearB(dx ? p.y : p.x, !dx)) continue;
      starts.push({ p, s: stubOut(p, dx, dy), d: [dx, dy], extra: 40 });
    }
    // where it may arrive: the middle of each side of the target, a short way out
    // where it may arrive: the middle of each side of the target, or level with where it leaves (a straight
    // link when the two overlap); a table or a span node keeps the attachment point it was given
    const pend = r.pts[r.pts.length - 1];
    // a table, a span node or a concentrator keeps the place the link was given on it
    const sides = T.cols || T.span || T.kind === 'junction' ? [sideOf(T, pend)] : [[-1, 0], [1, 0], [0, -1], [0, 1]];
    const ports = [];
    for (const [dx, dy] of sides) {
      const cands = [];
      if (T.cols || T.span || T.kind === 'junction') cands.push({ ...pend });
      else {
        cands.push({ x: dx < 0 ? T.x : dx > 0 ? T.x + T.w : T.x + T.w / 2, y: dy < 0 ? T.y : dy > 0 ? T.y + T.h : T.y + T.h / 2 });
        if (dy && p0.x > T.x + 10 && p0.x < T.x + T.w - 10) cands.push({ x: p0.x, y: dy < 0 ? T.y : T.y + T.h });
        if (dx && p0.y > T.y + 10 && p0.y < T.y + T.h - 10) cands.push({ x: dx < 0 ? T.x : T.x + T.w, y: p0.y });
      }
      // a side where other links already arrive costs more: arrowheads side by side read as one
      const ends = rm.edges.filter(o => o !== r && o.pts && o.pts.length > 1).flatMap(o => [o.pts[0], o.pts[o.pts.length - 1]]).filter(q => dx ? Math.abs(q.x - (dx < 0 ? T.x : T.x + T.w)) < 2 && q.y > T.y - 1 && q.y < T.y + T.h + 1 : Math.abs(q.y - (dy < 0 ? T.y : T.y + T.h)) < 2 && q.x > T.x - 1 && q.x < T.x + T.w + 1);
      // and where one already arrives, the new one takes a quarter of the side away from it
      if (ends.length && !T.cols && !T.span && T.kind !== 'junction') {
        cands.length = 0;
        for (const k of [0.25, 0.75]) {
          const p = dx ? { x: dx < 0 ? T.x : T.x + T.w, y: T.y + T.h * k } : { x: T.x + T.w * k, y: dy < 0 ? T.y : T.y + T.h };
          if (!ends.some(q => Math.abs(dx ? q.y - p.y : q.x - p.x) < 10)) cands.push(p);
        }
      }
      // and not where the link would run along a frame border
      for (const p of cands) if (T.cols || T.span || T.kind === 'junction' || !nearB(dx ? p.y : p.x, !dx)) ports.push({ p, q: stubOut(p, dx, dy), d: [dx, dy], extra: ends.length * 150 });
    }
    const xs = new Set([...starts.map(o => o.s.x), ...ports.map(o => o.q.x)]), ys = new Set([...starts.map(o => o.s.y), ...ports.map(o => o.q.y)]);
    for (const b of others.concat([S, T])) { xs.add(b.x - M - 2); xs.add(b.x + b.w + M + 2); ys.add(b.y - M - 2); ys.add(b.y + b.h + M + 2); }
    // lines that stay clear of the frame borders: a route is not drawn along a border
    for (const f of rm.frames) { for (const v of [f.x - 14, f.x + 14, f.x + f.w - 14, f.x + f.w + 14]) xs.add(v); for (const v of [f.y - 14, f.y + 14, f.y + f.h - 14, f.y + f.h + 14]) ys.add(v); }
    const keep = new Set([...starts.flatMap(o => [o.s.x, o.s.y]), ...ports.flatMap(o => [o.q.x, o.q.y])]);
    const nearX = v => rm.frames.some(f => Math.abs(v - f.x) < 8 || Math.abs(v - f.x - f.w) < 8), nearY = v => rm.frames.some(f => Math.abs(v - f.y) < 8 || Math.abs(v - f.y - f.h) < 8);
    const X = [...xs].filter(v => keep.has(v) || !nearX(v)).sort((a, b) => a - b), Y = [...ys].filter(v => keep.has(v) || !nearY(v)).sort((a, b) => a - b);
    const all = others.concat([S, T]);
    const free = (x, y) => !all.some(b => inside(b, x, y, M - 1));
    const key = (i, j) => i * Y.length + j;
    const ix = new Map(X.map((v, i) => [v, i])), iy = new Map(Y.map((v, j) => [v, j]));
    const startAt = new Map(starts.map(o => [key(ix.get(o.s.x), iy.get(o.s.y)), o]));
    const goals = new Map(ports.map(o => [key(ix.get(o.q.x), iy.get(o.q.y)), o]));
    // Dijkstra over (grid point, direction): length plus a price per bend
    const BEND = 60, dist = new Map(), prev = new Map(), heap = [];
    const occupied = rm.edges.filter(o => o !== r && o.pts && !o.e.rail && !o.e.lifeline).flatMap(o => o.pts.slice(1).map((p, i) => [o.pts[i], p]));
    const push = (k, d, c) => { const id = k * 4 + d; if (c < (dist.get(id) ?? Infinity)) { dist.set(id, c); heap.push([c, id]); } };
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    // a start whose first stub already lies on another link (the trunk of a bus) is as dear as running on one
    // (closer than 8px counts, as everywhere: two lines that near read as one)
    for (const o of starts) if (occupied.some(([u, w]) => overlapSeg(o.p, o.s, u, w, 8))) o.extra += 600;
    for (const o of ports) if (occupied.some(([u, w]) => overlapSeg(o.q, o.p, u, w, 8))) o.extra = (o.extra || 0) + 600;
    for (const [k, o] of startAt) { const d0 = DIRS.findIndex(([a, b]) => a === o.d[0] && b === o.d[1]); push(k, d0 < 0 ? 0 : d0, o.extra); }
    let best = null;
    while (heap.length) {
      let m = 0; for (let k = 1; k < heap.length; k++) if (heap[k][0] < heap[m][0]) m = k;
      const [c, id] = heap.splice(m, 1)[0];
      if (c > (dist.get(id) ?? Infinity)) continue;
      const k = Math.floor(id / 4), d = id % 4, i = Math.floor(k / Y.length), j = k % Y.length;
      if (goals.has(k)) {
        const o = goals.get(k);
        // arrive straight: the last stretch runs into the side, so the direction must point at the node
        const need = DIRS.findIndex(([a, b]) => a === -o.d[0] && b === -o.d[1]);
        const back = DIRS[d][0] === o.d[0] && DIRS[d][1] === o.d[1];      // arriving the wrong way round
        const total = c + (d === need ? 0 : BEND) + (o.extra || 0);
        if (!back && (!best || total < best.c)) best = { c: total, id, o };
      }
      for (let nd = 0; nd < 4; nd++) {
        const [a, b] = DIRS[nd];
        const ni = i + a, nj = j + b;
        if (ni < 0 || nj < 0 || ni >= X.length || nj >= Y.length) continue;
        const P = { x: X[i], y: Y[j] }, Q = { x: X[ni], y: Y[nj] };
        if (!free(Q.x, Q.y) && !goals.has(key(ni, nj))) continue;
        if (all.some(bx => segHits(P, Q, bx, M - 2))) continue;
        // running on top of another link is never wanted: it costs as much as a long detour
        const onLink = (occupied.some(([u, w]) => overlapSeg(P, Q, u, w, 8)) ? 600 : 0) + 40 * occupied.filter(([u, w]) => crossSeg(P, Q, u, w)).length;
        push(key(ni, nj), nd, c + Math.abs(Q.x - P.x) + Math.abs(Q.y - P.y) + (nd === d ? 0 : BEND) + onLink);
        if (!prev.has(key(ni, nj) * 4 + nd) || dist.get(key(ni, nj) * 4 + nd) === c + Math.abs(Q.x - P.x) + Math.abs(Q.y - P.y) + (nd === d ? 0 : BEND) + onLink) prev.set(key(ni, nj) * 4 + nd, id);
      }
    }
    if (!best) continue;
    const path = [];
    let from = starts[0];
    for (let id = best.id; id !== undefined; id = prev.get(id)) { const k = Math.floor(id / 4); path.unshift({ x: X[Math.floor(k / Y.length)], y: Y[k % Y.length] }); if (startAt.has(k) && !prev.has(id)) { from = startAt.get(k); break; } if (startAt.has(k) && dist.get(id) === startAt.get(k).extra) { from = startAt.get(k); break; } }
    const pts = simplifyPts([from.p, ...path, best.o.p]);
    // a route on top of another link is refused, unless the old one runs right through a node: a link through a
    // box reads as joining it, which is worse than two links side by side
    const through = r.pts.some((p, i) => i && others.some(b => segHits(r.pts[i - 1], p, b, -2)));
    if (!through && overlapsLinks(rm, pts, new Set([r])) && (force || !overlapsLinks(rm, r.pts, new Set([r])))) continue;
    // a new route may not cross more links than the old one, unless the old one ran through a node; a detour
    // may cross one more link when the new route is at most half as long (a hop reads better than going round)
    const newCost = pts.reduce((t, p, i) => i ? t + len(pts[i - 1], p) : 0, 0) + 60 * Math.max(0, pts.length - 2);
    const spare = force ? 2 : detour && newCost <= curCost * 0.5 ? 1 : 0;
    if (!blocked && crossingsWith(rm, pts, r) > crossingsWith(rm, r.pts, r) + spare) continue;
    // (crossings with the links of its own two nodes count here: those are the ones a new side avoids)
    const sibX = P => rm.edges.reduce((t, o) => t + (o !== r && o.pts && (o.e.a === e.a || o.e.b === e.a || o.e.a === e.b || o.e.b === e.b) ? P.reduce((u, p, i) => u + (i ? o.pts.filter((q, j) => j && crossSeg(P[i - 1], p, o.pts[j - 1], q)).length : 0), 0) : 0), 0);
    if (sibling && !(crossingsWith(rm, pts, r) + sibX(pts) < crossingsWith(rm, r.pts, r) + sibX(r.pts) && newCost <= curCost && simplifyPts(pts).length <= simplifyPts(r.pts).length)) continue;
    // nor beside another link (closer than 8px they read as one), nor along a zone border, nor over a zone's title
    // band (a zone with a link on its title grows to free it)
    if (sibling && overlapsLinks(rm, pts, new Set([r]), 8)) continue;
    if (sibling && pts.some((p, i) => i && rm.frames.some(f => {
      const a = pts[i - 1];
      if (Math.abs(a.x - p.x) < 0.5) return Math.min(Math.max(a.y, p.y), f.y + f.h) - Math.max(Math.min(a.y, p.y), f.y) > 20 && (Math.abs(a.x - f.x) < 8 || Math.abs(a.x - f.x - f.w) < 8);
      if (Math.abs(a.y - p.y) < 0.5) return (Math.min(Math.max(a.x, p.x), f.x + f.w) - Math.max(Math.min(a.x, p.x), f.x) > 20 && (Math.abs(a.y - f.y) < 8 || Math.abs(a.y - f.y - f.h) < 8)) || (a.y > f.y && a.y < f.y + 30 && Math.min(Math.max(a.x, p.x), f.x + f.w) - Math.max(Math.min(a.x, p.x), f.x) > 20);
      return false;
    }))) continue;
    if (detour && newCost > curCost * 0.8) continue;
    if (pts.some((p, i) => i && others.some(b => segHits(pts[i - 1], p, b, 0)))) continue;
    r.pts = pts;
  }
}

// Links that leave (or reach) one side of a node are put in the order that crosses least: the places where
// they meet the side are shared out again among them, trying every order (up to five links), and the best one
// is kept when it has fewer crossings. A straight link that has to move gets a short step near the node.
function reorderEnds(rm) {
  const eq = (a, b) => Math.abs(a - b) < 0.5;
  const X = (a, b, c, d) => {                     // proper crossing of two orthogonal segments
    const h1 = eq(a.y, b.y), h2 = eq(c.y, d.y);
    if (h1 === h2) return false;
    const [H0, H1, V0, V1] = h1 ? [a, b, c, d] : [c, d, a, b];
    const y = H0.y, x = V0.x;
    return Math.min(H0.x, H1.x) + 0.5 < x && x < Math.max(H0.x, H1.x) - 0.5 && Math.min(V0.y, V1.y) + 0.5 < y && y < Math.max(V0.y, V1.y) - 0.5;
  };
  // two stretches on top of each other (closer than 4px, overlapping by more than 4px) count as a crossing
  const OV = (a, b, c, d) => {
    if (eq(a.y, b.y) && eq(c.y, d.y)) return Math.abs(a.y - c.y) < 4 && Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) > 4;
    if (eq(a.x, b.x) && eq(c.x, d.x)) return Math.abs(a.x - c.x) < 4 && Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) > 4;
    return false;
  };
  const cross = (P, Q) => { let n = 0; for (let i = 1; i < P.length; i++) for (let j = 1; j < Q.length; j++) if (X(P[i - 1], P[i], Q[j - 1], Q[j]) || OV(P[i - 1], P[i], Q[j - 1], Q[j])) n++; return n; };
  const perms = a => a.length <= 1 ? [a] : a.flatMap((x, i) => perms([...a.slice(0, i), ...a.slice(i + 1)]).map(p => [x, ...p]));
  // a merged link takes part at the far end of its branch, where its end is an ordinary arrow; its bus stays put
  // links on a concentrator were put in order when they were placed on it
  const onBar = r => rm.nodes.some(n => n.kind === 'junction' && (n.id === r.e.a || n.id === r.e.b));
  const live = rm.edges.filter(r => r.pts && r.pts.length > 1 && !r.e.rail && !r.e.lifeline && !r.e.divider && r.e.a !== r.e.b && !onBar(r));
  // points in a straight line are dropped first: moving an end moves the next point too, which must be a corner
  for (const r of live) if (r.pts.length > 2) r.pts = simplifyPts(r.pts);
  const orthogonal = q => q.every((p, i) => !i || eq(p.x, q[i - 1].x) || eq(p.y, q[i - 1].y));
  for (const n of rm.nodes) {
    if (n.x === undefined || n.cols || n.span) continue;
    for (const side of ['left', 'right', 'top', 'bottom']) {
      const horiz = side === 'left' || side === 'right';           // the stretch at the node is horizontal
      const sv = side === 'left' ? n.x : side === 'right' ? n.x + n.w : side === 'top' ? n.y : n.y + n.h;
      const ends = [];
      for (const r of live) {
        const q = r.pts, L = q.length;
        for (const at of [0, L - 1]) {
          const p = q[at], nx = q[at === 0 ? 1 : L - 2];
          const on = horiz ? Math.abs(p.x - sv) < 1.5 && p.y > n.y && p.y < n.y + n.h : Math.abs(p.y - sv) < 1.5 && p.x > n.x && p.x < n.x + n.w;
          if (!on || !(horiz ? eq(p.y, nx.y) : eq(p.x, nx.x))) continue;
          if (r.merged && (r.mergeHub === n.id || L < 5)) continue;   // with fewer points the moved corner is on the bus
          ends.push({ r, at });
        }
      }
      if (ends.length < 2 || ends.length > 5) continue;
      const A = horiz ? 'y' : 'x';
      const slots = ends.map(e => e.r.pts[e.at][A]).sort((a, b) => a - b);
      const out = side === 'right' || side === 'bottom' ? 1 : -1;
      // the links as they would be with their end at `pos`
      // the link as it would be with its end at `pos`; a straight link gets a step, near this node (near: true)
      // or near its other end
      const moved = (e, pos, near) => {
        const q = e.r.pts.map(p => ({ ...p })), L = q.length, i = e.at, j = i === 0 ? 1 : L - 2;
        if (eq(q[i][A], pos)) return q;
        if (L === 2) {
          const C = horiz ? 'x' : 'y';
          const sx = near ? q[i][C] + out * 24 : q[j][C] - out * 24;
          const s0 = { ...q[i], [A]: pos };
          const a = { [C]: sx, [A]: pos }, b = { [C]: sx, [A]: q[j][A] };
          return i === 0 ? [s0, a, b, q[1]] : [q[0], b, a, s0];
        }
        q[i] = { ...q[i], [A]: pos }; q[j] = { ...q[j], [A]: pos };
        return q;
      };
      const others = live.filter(r => !ends.some(e => e.r === r));
      const score = sets => {
        let c = 0;
        // links from the same side crossing each other read worst: a fan that twists on itself
        for (let a = 0; a < sets.length; a++) { for (const o of others) c += cross(sets[a], o.pts); for (let b = a + 1; b < sets.length; b++) c += 3 * cross(sets[a], sets[b]); }
        return c;
      };
      // a candidate may not pass within 6px of a node that is not one of its ends, nor run along a frame border
      const hitsNode = (q, r) => q.some((p, i) => {
        if (!i) return false;
        const a = q[i - 1];
        if (rm.nodes.some(m => m.x !== undefined && m.id !== r.e.a && m.id !== r.e.b &&
          Math.min(a.x, p.x) < m.x + m.w + 6 && m.x - 6 < Math.max(a.x, p.x) && Math.min(a.y, p.y) < m.y + m.h + 6 && m.y - 6 < Math.max(a.y, p.y))) return true;
        return rm.frames.some(f => eq(a.x, p.x) ? Math.min(Math.max(a.y, p.y), f.y + f.h) - Math.max(Math.min(a.y, p.y), f.y) > 6 && (Math.abs(a.x - f.x) < 8 || Math.abs(a.x - f.x - f.w) < 8)
          : Math.min(Math.max(a.x, p.x), f.x + f.w) - Math.max(Math.min(a.x, p.x), f.x) > 6 && (Math.abs(a.y - f.y) < 8 || Math.abs(a.y - f.y - f.h) < 8));
      });
      const now = score(ends.map(e => e.r.pts));
      if (!now) continue;
      let best = null;
      for (const perm of perms(slots)) for (const near of [false, true]) {
        const sets = ends.map((e, k) => moved(e, perm[k], near));
        if (sets.some(q => !orthogonal(q))) continue;
        if (sets.some((q, k) => q !== ends[k].r.pts && hitsNode(q, ends[k].r) && !hitsNode(ends[k].r.pts, ends[k].r))) continue;
        const c = score(sets), bends = sets.reduce((t, q) => t + q.length, 0);
        if (c < now && (!best || c < best.c || (c === best.c && bends < best.bends))) best = { c, bends, sets };
      }
      if (best) ends.forEach((e, k) => { e.r.pts = best.sets[k]; });
    }
  }
}

// Last: two links that still lie on top of each other (not two links of one bus) are pulled apart by routing
// one of them again: the one that is not part of a bus, with the more bends.
function resolveOverlaps(rm) {
  const E = rm.edges.filter(r => r.pts && r.pts.length > 1 && !r.e.rail && !r.e.lifeline && !r.e.divider && r.e.a !== r.e.b);
  for (let round = 0; round < 3; round++) {
    const victims = new Set();
    for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) {
      const A = E[i], B = E[j];
      if (A.merged && B.merged) continue;
      let hit = false;
      for (let a = 1; a < A.pts.length && !hit; a++) for (let b = 1; b < B.pts.length && !hit; b++) if (overlapSeg(A.pts[a - 1], A.pts[a], B.pts[b - 1], B.pts[b], 8)) hit = true;
      if (!hit) continue;
      const pick = A.merged ? B : B.merged ? A : (A.pts.length >= B.pts.length ? A : B);
      if (!victims.has(A) && !victims.has(B)) victims.add(pick);
    }
    if (!victims.size) return;
    rerouteBlocked(rm, victims);
  }
}

// A link with one small step (12px or less) is made straight, by sliding its end along the side of its
// target (or its start along its source), when that side has room and no other link ends there.
function straightenSmallJogs(rm) {
  const eq = (a, b) => Math.abs(a - b) < 0.5;
  for (const r of rm.edges) {
    const e = r.e;
    if (e.rail || e.lifeline || r.merged || !r.pts || e.a === e.b) continue;
    const q = simplifyPts(r.pts);
    if (q.length !== 4) continue;
    const S = rm.nodes.find(n => n.id === e.a), T = rm.nodes.find(n => n.id === e.b);
    if (!S || !T || S.cols || T.cols) continue;
    const hv = eq(q[0].y, q[1].y) && eq(q[1].x, q[2].x) && eq(q[2].y, q[3].y);
    const vh = eq(q[0].x, q[1].x) && eq(q[1].y, q[2].y) && eq(q[2].x, q[3].x);
    if (!hv && !vh) continue;
    const A = hv ? 'y' : 'x', L = hv ? 'h' : 'w';
    const off = q[3][A] - q[0][A];
    if (Math.abs(off) < 0.5 || Math.abs(off) > 12) continue;
    const clear = (node, v, skip) => v >= node[A] + 6 && v <= node[A] + node[L] - 6 &&
      !rm.edges.some(o => o !== r && o.pts && [o.pts[0], o.pts[o.pts.length - 1]].some(p => p !== skip && Math.abs(p[A] - v) < 8 && (hv ? Math.abs(p.x - (skip === 'end' ? q[3].x : q[0].x)) < 2 : Math.abs(p.y - (skip === 'end' ? q[3].y : q[0].y)) < 2)));
    const hit = (a, b) => rm.nodes.some(n => n !== S && n !== T && n.x !== undefined && Math.min(a.x, b.x) < n.x + n.w && n.x < Math.max(a.x, b.x) && Math.min(a.y, b.y) < n.y + n.h && n.y < Math.max(a.y, b.y));
    // a span node keeps its attachment points: only the other end slides
    if (!T.span && clear(T, q[0][A], 'end')) {
      const end = { ...q[3], [A]: q[0][A] };
      if (!hit(q[0], end)) { r.pts = [q[0], end]; continue; }
    }
    if (!S.span && clear(S, q[3][A], 'start')) {
      const st = { ...q[0], [A]: q[3][A] };
      if (!hit(st, q[3])) r.pts = [st, q[3]];
    }
  }
}

// Links that go to (or come from) one node, say the same thing and look the same are merged into a bus: a
// short trunk at the node, a line running along its side, and a branch from each of the others (a dot
// where a branch meets the line in the middle of it). The text is written once. A hand would draw it so;
// ten parallel lines into one box are hard to follow. Needs MIN links; a link that cannot reach the bus
// without crossing a node stays as it was.
function mergeHubs(rm, MIN = 4) {
  const eq = (a, b) => Math.abs(a - b) < 0.5;
  const T = 8, TRUNK = 36;
  rm.joins = [];
  const nodeAt = (p) => rm.nodes.find(n => n.x !== undefined && !n.cols && !n.span && (
    (Math.abs(p.y - n.y) <= T || Math.abs(p.y - n.y - n.h) <= T) && p.x >= n.x && p.x <= n.x + n.w ||
    (Math.abs(p.x - n.x) <= T || Math.abs(p.x - n.x - n.w) <= T) && p.y >= n.y && p.y <= n.y + n.h));
  const groups = new Map();
  for (const r of rm.edges) {
    const e = r.e;
    if (e.rail || e.lifeline || e.divider || !r.pts || r.pts.length < 2 || e.a === e.b) continue;
    for (const role of ['b', 'a']) {
      const id = e[role];
      const k = [id, role, e.label || '', (e.tags || []).join(','), !!e.dashed, !!e.start, !!e.end].join('|');
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
  }
  const used = new Set(), busLines = [];       // the line and trunk of every bus built so far
  const sorted = [...groups.entries()].sort((x, y) => y[1].length - x[1].length);
  for (const [k, list0] of sorted) {
    const list = list0.filter(r => !used.has(r));
    if (list.length < 2) continue;
    const role = k.split('|')[1];
    const hub = rm.nodes.find(n => n.id === list[0].e[role]);
    // a node tagged join asks for it from two links up
    const need = hub && hub.tags && hub.tags.includes('join') ? 2 : MIN;
    if (list.length < need) continue;
    if (!hub || hub.x === undefined || hub.cols || hub.span) continue;
    const rev = role === 'a';
    // every link seen as running toward the hub
    const items = list.map(r => ({ r, P: (rev ? [...r.pts].reverse() : r.pts).map(p => ({ ...p })) }));
    const sideOf = p => {
      const d = [['top', Math.abs(p.y - hub.y), p.x >= hub.x && p.x <= hub.x + hub.w], ['bottom', Math.abs(p.y - hub.y - hub.h), p.x >= hub.x && p.x <= hub.x + hub.w],
        ['left', Math.abs(p.x - hub.x), p.y >= hub.y && p.y <= hub.y + hub.h], ['right', Math.abs(p.x - hub.x - hub.w), p.y >= hub.y && p.y <= hub.y + hub.h]]
        .filter(x => x[1] <= T && x[2]).sort((a, b) => a[1] - b[1]);
      return d.length ? d[0][0] : null;
    };
    const count = {};
    for (const it of items) { const sd = sideOf(it.P[it.P.length - 1]); if (sd) count[sd] = (count[sd] || 0) + 1; }
    const side = Object.keys(count).sort((a, b) => count[b] - count[a])[0];
    if (!side) continue;
    const vert = side === 'top' || side === 'bottom';           // the trunk runs along y
    const dir = side === 'left' || side === 'top' ? 1 : -1;     // direction of travel into the hub
    const M = p => vert ? p.y : p.x, C = p => vert ? p.x : p.y;
    const mk = (m, c) => vert ? { x: c, y: m } : { x: m, y: c };
    const last = items.find(it => sideOf(it.P[it.P.length - 1]) === side).P;
    // a junction is a point on its own bus: the bus line runs through it
    if (hub.kind === 'junction') continue;
    const J = false;
    const endM = J ? M({ x: hub.x + hub.w / 2, y: hub.y + hub.h / 2 }) : M(last[last.length - 1]);
    const trunkC = vert ? hub.x + hub.w / 2 : hub.y + hub.h / 2;
    // a bus and its branches keep 6px clear of every node they do not serve, like any link
    const hits = (a, b, skip) => rm.nodes.some(n => n.x !== undefined && !skip.has(n.id) && Math.min(a.x, b.x) < n.x + n.w + 6 && n.x - 6 < Math.max(a.x, b.x) && Math.min(a.y, b.y) < n.y + n.h + 6 && n.y - 6 < Math.max(a.y, b.y));
    const ok = items.filter(it => sideOf(it.P[it.P.length - 1]) === side);
    // the bus stands where the branches are short: just past the sources, as near to them as a free place allows
    const build = busM => {
      const res = new Map(), taken = [];      // taken: runs across toward the bus already planned {c, m1, m2}
      const inflated = (a, b, skip, g) => rm.nodes.some(n => n.x !== undefined && !skip.has(n.id) && Math.min(a.x, b.x) < n.x + n.w + g && n.x - g < Math.max(a.x, b.x) && Math.min(a.y, b.y) < n.y + n.h + g && n.y - g < Math.max(a.y, b.y));
      const bounds = rm.nodes.filter(n => n.x !== undefined);
      const cLo = Math.min(...bounds.map(n => vert ? n.x : n.y)) - 8, cHi = Math.max(...bounds.map(n => vert ? n.x + n.w : n.y + n.h)) + 8;
      const tryPath = (it, head, c) => {
        const skip = new Set([hub.id, it.r.e.a, it.r.e.b]);
        const path = [...head, mk(busM, c), mk(busM, trunkC), mk(endM, trunkC)];
        for (let i = Math.max(1, head.length); i < path.length; i++) if (hits(path[i - 1], path[i], skip)) return null;
        // nor on another link (the links of this group share the bus, that is the point)
        // (7px: two links side by side closer than that read as one; another bus's line included)
        if (overlapsLinks(rm, path, new Set(ok.map(x => x.r)), 7)) return null;
        return { it, path, c };
      };
      const lane = (c, m1, m2) => !taken.some(t => Math.abs(t.c - c) < 14 && Math.min(t.m1, t.m2) < Math.max(m1, m2) && Math.min(m1, m2) < Math.max(t.m1, t.m2));
      const borderOk = (c, m1, m2) => !rm.frames.some(f => vert
        ? (Math.min(m1, m2) < f.y + f.h && f.y < Math.max(m1, m2) && (Math.abs(c - f.x) < 9 || Math.abs(c - f.x - f.w) < 9))
        : (Math.min(m1, m2) < f.x + f.w && f.x < Math.max(m1, m2) && (Math.abs(c - f.y) < 9 || Math.abs(c - f.y - f.h) < 9)));
      // 1. straight out of the source toward the bus
      // a link that leaves its node sideways (not toward the bus) is let out of the side that faces the bus
      const startOf = it => {
        const P = it.P, a0 = P[0], a1 = P[1];
        if ((vert ? eq(a0.x, a1.x) : eq(a0.y, a1.y)) && (M(a1) - M(a0)) * dir > 0) return { a0, a1 };
        const sn = rm.nodes.find(n => n.id === (rev ? it.r.e.b : it.r.e.a));
        if (!sn || sn.x === undefined || sn.cols || sn.span) return null;
        const mSide = vert ? (dir > 0 ? sn.y + sn.h : sn.y) : (dir > 0 ? sn.x + sn.w : sn.x);
        const c0 = vert ? sn.x + sn.w / 2 : sn.y + sn.h / 2;
        return { a0: mk(mSide, c0), a1: mk(mSide + dir * 10, c0), fresh: true };
      };
      for (const it of ok) {
        const st = startOf(it); if (!st) continue;
        const a0 = st.a0;
        if ((busM - M(a0)) * dir > 4) {
          const got = tryPath(it, [a0], C(a0));
          if (got && lane(C(a0), M(a0), busM)) { res.set(it, got); taken.push({ c: C(a0), m1: M(a0), m2: busM }); }
        }
      }
      // 2. out a little, across to a free lane, then along it to the bus
      for (const it of ok) {
        if (res.has(it)) continue;
        const st = startOf(it); if (!st) continue;
        const a0 = st.a0, skip = new Set([hub.id, it.r.e.a, it.r.e.b]);
        let best = null;
        for (let off = 12; off <= 60; off += 8) {
          const mj = M(a0) + dir * off;
          if ((busM - mj) * dir < 12) break;
          for (let c = Math.ceil(cLo / 4) * 4; c <= cHi; c += 4) {
            if (Math.abs(c - C(a0)) < 6) continue;
            const cost = Math.abs(c - C(a0)) + off * 0.5;
            if (best && cost >= best.cost) continue;
            const p1 = mk(mj, C(a0)), p2 = mk(mj, c), p3 = mk(busM, c);
            if (inflated(a0, p1, skip, 0) || inflated(p1, p2, skip, 8) || inflated(p2, p3, skip, 8)) continue;
            if (!lane(c, mj, busM) || !borderOk(c, mj, busM) || !borderOk(mj, C(a0), c) && false) continue;
            const got = tryPath(it, [a0, p1, p2], c);
            if (got) best = { cost, got, c, mj };
          }
        }
        if (best) { res.set(it, best.got); taken.push({ c: best.c, m1: best.mj, m2: busM }); }
      }
      // 3. along its own route until it crosses the bus line
      for (const it of ok) {
        if (res.has(it)) continue;
        const P = it.P;
        let at = null;
        for (let i = 1; i < P.length && !at; i++) {
          const a = P[i - 1], b = P[i];
          if (vert ? eq(a.x, b.x) : eq(a.y, b.y)) { if ((M(a) - busM) * dir <= 0.5 && (M(b) - busM) * dir >= -0.5) at = { i, c: C(a) }; }
          else if (eq(M(a), busM)) at = { i: i - 1, c: C(a) };
        }
        const got = at && tryPath(it, P.slice(0, at.i), at.c);
        if (got) res.set(it, got);
      }
      return ok.filter(it => res.has(it)).map(it => res.get(it));
    };
    // a border only counts where the bus runs beside it: across the span of its branches and trunk
    const spanC = ok.map(it => C(it.P[0])).concat(trunkC), sLo = Math.min(...spanC) - 20, sHi = Math.max(...spanC) + 20;
    const frameNear = m => rm.frames.some(f => vert
      ? (Math.abs(m - f.y) < 20 || Math.abs(m - f.y - f.h) < 20) && f.x < sHi && sLo < f.x + f.w
      : (Math.abs(m - f.x) < 20 || Math.abs(m - f.x - f.w) < 20) && f.y < sHi && sLo < f.y + f.h);
    const startMax = Math.max(...ok.map(it => M(it.P[0]) * dir)) ;
    // the side of the bus that carries the arrowheads needs room for them (30px); the other side 16px
    const e0 = ok[0].r.e, arrowAtHub = role === 'b' ? !!e0.end : !!e0.start;
    // (a join that was asked for makes do with a little less)
    const ask = need === 2 ? 0.8 : 1;
    const TR = (arrowAtHub ? 30 : 16) * ask, BR = (arrowAtHub ? 16 : 30) * ask;
    let plan = [], busM;
    if (J) {
      // the members' side needs room for arrowheads only when the branches have them there
      const arrowAtOthers = role === 'b' ? !!e0.start : !!e0.end;
      if (endM * dir - startMax < (arrowAtOthers ? 30 : 12)) continue;
      busM = endM;
      plan = build(busM);
    } else {
      if (endM * dir - startMax < TR + BR) continue;
      const near = startMax + Math.min(BR + 10, endM * dir - startMax - TR);
      const far = endM * dir - Math.min(TR + 6, endM * dir - startMax - BR);
      busM = near * dir;
      for (let m = near; m <= far + 0.1; m += 6) {
        const bm = m * dir;
        if (frameNear(bm)) continue;
        const pl = build(bm);
        if (pl.length > plan.length) { plan = pl; busM = bm; }
      }
      if (!plan.length && !frameNear(busM)) plan = build(busM);
    }
    if (plan.length < need) continue;
    // a bus never crosses the line of another bus: a branch cutting across it reads as joining it, so such a
    // branch stays an ordinary link (crossing another bus's branch is an ordinary crossing, with a hop)
    // and a bus that would leave out more than a quarter of its links is not built: it would not say they are alike
    const whole = plan.length;
    plan = plan.filter(x => !x.path.some((p, j) => j && busLines.some(([u, w]) => crossSeg(x.path[j - 1], p, u, w))));
    if (plan.length < Math.max(need, Math.ceil(whole * 0.75))) continue;
    // the trunk never runs a few pixels beside a branch (it reads as a slip): it goes midway between two branches,
    // on the hub's side, or the hub slides to such a place when it is free to; else it lines up with the branch
    const placed = placeTrunk(rm, hub, plan.map(x => x.c), trunkC, vert, new Set(plan.map(x => x.it.r)));
    const trunkAt = placed.t;
    if (trunkAt !== trunkC) {
      const t = trunkAt;
      plan.forEach(x => {
        const n = x.path.length;
        x.path[n - 2] = mk(busM, t); x.path[n - 1] = mk(endM, t);
      });
    }
    const trunkC2 = trunkAt;
    const cs = plan.map(x => x.c).concat(trunkC2), lo = Math.min(...cs), hi = Math.max(...cs);
    // nor is it built where branches of a bus already drawn would cut across its own line
    const mine = [[mk(busM, lo), mk(busM, hi)], [mk(busM, trunkC2), mk(endM, trunkC2)]];
    if (rm.edges.some(o => o.merged && o.e.a !== hub.id && o.e.b !== hub.id && o.pts.some((p, j) => j && mine.some(([u, w]) => crossSeg(o.pts[j - 1], p, u, w))))) continue;
    if (placed.d) { if (vert) hub.x += placed.d; else hub.y += placed.d; }
    busLines.push([mk(busM, lo), mk(busM, hi)], [mk(busM, trunkC2), mk(endM, trunkC2)]);
    plan.forEach((x, i) => {
      const r = x.it.r;
      let out = x.path.filter((p, j, a) => j === 0 || Math.hypot(p.x - a[j - 1].x, p.y - a[j - 1].y) > 0.5);
      out = simplifyPts(out);
      r.pts = rev ? out.reverse() : out;
      r.merged = true; r.mergeHub = hub.id; r.mergeRep = i === 0; used.add(r);
      if (x.c > lo + 0.5 && x.c < hi - 0.5 && !eq(x.c, trunkC2)) rm.joins.push(mk(busM, x.c));
      if (i) r.lab = null;
    });
    if (plan.some(x => x.c < trunkC2 - 0.5) && plan.some(x => x.c > trunkC2 + 0.5)) rm.joins.push(mk(busM, trunkC2));
    const keep = plan[0].it.r;
    if (keep.lab && keep.e.lab) keep.lab = { x: (busM + endM) / 2, y: trunkC2 - 4 - keep.e.lab.h, anchor: 'middle' };
  }
  const seen = new Set();
  rm.joins = rm.joins.filter(p => { const k = Math.round(p.x) + ',' + Math.round(p.y); if (seen.has(k)) return false; seen.add(k); return true; });
}

// Where a bus's trunk meets its hub. A trunk a few pixels beside a branch reads as a slip, so when one is that
// close the trunk goes midway between two branches on the hub's side; if no such place is on the side, the hub
// slides across to one (only when all its links are in this bus and the room is free); failing that, the trunk
// lines up with the branch. Returns { t: the trunk's coordinate across, d: how far the hub moves }.
function placeTrunk(rm, hub, cs, trunkC, vert, planRs) {
  const NEAR = 14, R = 10, MAXMOVE = 60;
  if (!cs.some(c => Math.abs(c - trunkC) > 0.5 && Math.abs(c - trunkC) < NEAR)) return { t: trunkC, d: 0 };
  const sorted = [...cs].sort((a, b) => a - b).filter((c, i, a) => !i || c - a[i - 1] > 0.5);
  const mids = [];
  for (let i = 1; i < sorted.length; i++) if (sorted[i] - sorted[i - 1] >= 2 * NEAR) mids.push((sorted[i] + sorted[i - 1]) / 2);
  const lo = (vert ? hub.x : hub.y) + R, hi = (vert ? hub.x + hub.w : hub.y + hub.h) - R;
  const byNear = a => [...a].sort((x, y) => Math.abs(x - trunkC) - Math.abs(y - trunkC));
  const inSide = byNear(mids.filter(m => m >= lo && m <= hi));
  if (inSide.length) return { t: inSide[0], d: 0 };
  // the hub may slide when nothing else is tied to it
  const own = rm.edges.filter(r => r.e.a === hub.id || r.e.b === hub.id);
  if (own.every(r => planRs.has(r))) {
    const box = d => vert ? { x: hub.x + d, y: hub.y, w: hub.w, h: hub.h } : { x: hub.x, y: hub.y + d, w: hub.w, h: hub.h };
    const near = (a, b, g) => a.x < b.x + b.w + g && b.x < a.x + a.w + g && a.y < b.y + b.h + g && b.y < a.y + a.h + g;
    const inside = (a, f, g) => a.x >= f.x + g && a.y >= f.y + g && a.x + a.w <= f.x + f.w - g && a.y + a.h <= f.y + f.h - g;
    const free = nb => rm.nodes.every(n => n === hub || n.x === undefined || !near(n, nb, 12)) &&
      (rm.frames || []).every(f => inside(hub, f, 0) ? inside(nb, f, 10) : !near(nb, f, 6)) &&
      rm.edges.every(r => planRs.has(r) || !r.pts || r.e.rail || r.e.lifeline || r.e.divider ||
        !r.pts.some((p, j) => j && near({ x: Math.min(p.x, r.pts[j - 1].x), y: Math.min(p.y, r.pts[j - 1].y), w: Math.abs(p.x - r.pts[j - 1].x), h: Math.abs(p.y - r.pts[j - 1].y) }, nb, 6)));
    for (const m of byNear(mids)) {
      const d = m - trunkC;
      if (Math.abs(d) <= MAXMOVE && free(box(d))) return { t: m, d };
    }
  }
  const on = byNear(sorted.filter(c => c >= lo && c <= hi));
  return on.length ? { t: on[0], d: 0 } : { t: trunkC, d: 0 };
}

// Two links whose stretches run side by side closer than 8px (or on top of each other) are pulled apart to
// 12px. Only a stretch in the middle of a link moves (the one that has a bend at each end), by sliding
// sideways; the stretches before and after it follow. Nothing moves when it would run into a node or leave
// a stub shorter than 8px. Merged buses stay as they are.
function separateParallels(rm) {
  const NEAR = 8, GOAL = 12, MINSTUB = 8;
  const eq = (a, b) => Math.abs(a - b) < 0.5;
  const segsOf = () => {
    const out = [];
    for (const r of rm.edges) {
      if (r.merged || r.e.rail || r.e.lifeline || r.e.divider || !r.pts || r.pts.length < 4) continue;
      r.pts = simplifyPts(r.pts);
      const q = r.pts;
      for (let i = 1; i + 2 < q.length; i++) {
        const a = q[i], b = q[i + 1];
        if (eq(a.x, b.x) && !eq(a.y, b.y)) out.push({ r, i, v: true, c: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
        else if (eq(a.y, b.y) && !eq(a.x, b.x)) out.push({ r, i, v: false, c: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
      }
    }
    // the first and last stretch too: they slide along the side of their node, when it has room
    for (const r of rm.edges) {
      if (r.merged || r.e.rail || r.e.lifeline || r.e.divider || !r.pts || r.pts.length < 3) continue;
      const q = r.pts, n = q.length;
      for (const [i, at] of [[0, q[0]], [n - 2, q[n - 1]]]) {
        const node = nodeAt(at);
        if (!node || node.cols || node.span) continue;
        const a = q[i], b = q[i + 1];
        if (eq(a.x, b.x) && !eq(a.y, b.y)) out.push({ r, i, v: true, c: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y), end: i === 0 ? 'start' : 'end', node });
        else if (eq(a.y, b.y) && !eq(a.x, b.x)) out.push({ r, i, v: false, c: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x), end: i === 0 ? 'start' : 'end', node });
      }
    }
    return out;
  };
  const nodeAt = p => rm.nodes.find(n => n.x !== undefined && p.x >= n.x - 1.5 && p.x <= n.x + n.w + 1.5 && p.y >= n.y - 1.5 && p.y <= n.y + n.h + 1.5);
  const allSegs = () => {   // every stretch of every link, to measure against
    const out = [];
    for (const r of rm.edges) {
      if (r.e.rail || r.e.lifeline || r.e.divider || !r.pts) continue;
      for (let i = 1; i < r.pts.length; i++) {
        const a = r.pts[i - 1], b = r.pts[i];
        if (eq(a.x, b.x) && !eq(a.y, b.y)) out.push({ r, v: true, c: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
        else if (eq(a.y, b.y) && !eq(a.x, b.x)) out.push({ r, v: false, c: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
      }
    }
    return out;
  };
  // (6px, the clearance every link keeps from a node it does not serve)
  const hitsNode = (a, b) => rm.nodes.some(n => n.x !== undefined && Math.min(a.x, b.x) < n.x + n.w + 6 && n.x - 6 < Math.max(a.x, b.x) && Math.min(a.y, b.y) < n.y + n.h + 6 && n.y - 6 < Math.max(a.y, b.y));
  for (let pass = 0; pass < 6; pass++) {
    let moved = false;
    const mov = segsOf();
    for (const s of mov) {
      const q = s.r.pts;
      if (s.end) { if (slideEnd(s)) moved = true; continue; }
      if (!q[s.i + 2] || !q[s.i - 1]) continue;
      const others = allSegs().filter(o => o.r !== s.r && o.v === s.v && Math.min(s.hi, o.hi) - Math.max(s.lo, o.lo) > 6 && Math.abs(o.c - s.c) < NEAR);
      if (!others.length) continue;
      // the side with more room, away from the nearest neighbour
      const o = others.sort((x, y) => Math.abs(x.c - s.c) - Math.abs(y.c - s.c))[0];
      const dirs = o.c >= s.c ? [-1, 1] : [1, -1];
      for (const d of dirs) {
        const want = o.c + (d < 0 ? -GOAL : GOAL);          // 12px from the neighbour, on this side
        const delta = want - s.c;
        if (Math.abs(delta) > 2 * GOAL) continue;
        const a = q[s.i], b = q[s.i + 1], p0 = q[s.i - 1], p3 = q[s.i + 2];
        const na = s.v ? { x: want, y: a.y } : { x: a.x, y: want }, nb = s.v ? { x: want, y: b.y } : { x: b.x, y: want };
        // the stretches before and after keep a length of at least MINSTUB
        const lenBefore = s.v ? Math.abs(p0.x - na.x) : Math.abs(p0.y - na.y), lenAfter = s.v ? Math.abs(p3.x - nb.x) : Math.abs(p3.y - nb.y);
        if (lenBefore < MINSTUB || lenAfter < MINSTUB) continue;
        // the ends of the link must not be this stretch's neighbours' ports: the first and last stretch stay
        if (hitsNode(p0, na) && !(s.i - 1 === 0) || hitsNode(na, nb) || hitsNode(nb, p3) && !(s.i + 2 === q.length - 1)) continue;
        if (s.i - 1 === 0 && hitsNodeBeyond(p0, na)) continue;
        // and not onto a frame border
        if (rm.frames.some(f => s.v
          ? (Math.min(s.hi, f.y + f.h) > Math.max(s.lo, f.y) && (Math.abs(want - f.x) < 9 || Math.abs(want - f.x - f.w) < 9))
          : (Math.min(s.hi, f.x + f.w) > Math.max(s.lo, f.x) && (Math.abs(want - f.y) < 9 || Math.abs(want - f.y - f.h) < 9)))) continue;
        // not into another link's stretch on the new side
        const clash = allSegs().some(x => x.r !== s.r && x.v === s.v && Math.min(s.hi, x.hi) - Math.max(s.lo, x.lo) > 6 && Math.abs(x.c - want) < NEAR - 0.5);
        if (clash) continue;
        q[s.i] = na; q[s.i + 1] = nb;
        moved = true;
        break;
      }
    }
    if (!moved) break;
  }
  function hitsNodeBeyond() { return false; }
  // a first or last stretch that lies on another link's: slide it, with the point where it meets its node,
  // along that node's side
  function slideEnd(s) {
    const q = s.r.pts, n = q.length, node = s.node;
    const others = allSegs().filter(o => o.r !== s.r && o.v === s.v && Math.min(s.hi, o.hi) - Math.max(s.lo, o.lo) > 6 && Math.abs(o.c - s.c) < NEAR);
    if (!others.length) return false;
    const o = others.sort((x, y) => Math.abs(x.c - s.c) - Math.abs(y.c - s.c))[0];
    const lo = (s.v ? node.x : node.y) + 6, hi = (s.v ? node.x + node.w : node.y + node.h) - 6;
    for (const d of o.c >= s.c ? [-1, 1] : [1, -1]) {
      const want = o.c + d * GOAL;
      if (want < lo || want > hi) continue;
      const a = q[s.i], b = q[s.i + 1];
      const na = s.v ? { x: want, y: a.y } : { x: a.x, y: want }, nb = s.v ? { x: want, y: b.y } : { x: b.x, y: want };
      const nxt = s.end === 'start' ? q[s.i + 2] : q[s.i - 1];
      if (!nxt) continue;
      const moving = s.end === 'start' ? nb : na;
      if ((s.v ? Math.abs(nxt.x - moving.x) : Math.abs(nxt.y - moving.y)) < MINSTUB) continue;
      const own = new Set([s.r.e.a, s.r.e.b]);
      const hit = (u, w) => rm.nodes.some(m => m.x !== undefined && !own.has(m.id) && Math.min(u.x, w.x) < m.x + m.w + 2 && m.x - 2 < Math.max(u.x, w.x) && Math.min(u.y, w.y) < m.y + m.h + 2 && m.y - 2 < Math.max(u.y, w.y));
      if (hit(na, nb) || hit(moving, nxt)) continue;
      if (allSegs().some(x => x.r !== s.r && x.v === s.v && Math.min(s.hi, x.hi) - Math.max(s.lo, x.lo) > 6 && Math.abs(x.c - want) < NEAR - 0.5)) continue;
      // no other link may end on that side within 8px of the new place
      const endsHere = rm.edges.some(x => x !== s.r && x.pts && [x.pts[0], x.pts[x.pts.length - 1]].some(p => nodeAt(p) === node && Math.abs((s.v ? p.x : p.y) - want) < 8));
      if (endsHere) continue;
      q[s.i] = na; q[s.i + 1] = nb;
      return true;
    }
    return false;
  }
}

// Links that meet the same side of a node are kept at least `gap` px apart, so an arrowhead never touches
// the line next to it. Only ends that can slide are moved: the last stretch (across the side) and the one
// before it follow, and nothing moves when it would run into a node. Tables, span nodes and straight links
// keep their places.
function spreadEnds(rm, gap0 = 22) {
  const eq = (a, b) => Math.abs(a - b) < 0.5;
  const T = 8;
  const ends = [];
  for (const r of rm.edges) {
    if (r.e.rail || r.e.lifeline || !r.pts || r.pts.length < 2 || r.e.a === r.e.b) continue;
    // a bus branch counts where it leaves its own node (it stays put, the others keep clear of it); at the hub
    // the branches share one point, which counts once
    const q = r.merged ? r.pts : simplifyPts(r.pts);
    r.pts = q;
    for (const end of [0, 1]) {
      const i = end ? q.length - 1 : 0, p = q[i];
      for (const n of rm.nodes) {
        if (n.x === undefined || n.cols || n.span) continue;
        const c = [['top', Math.abs(p.y - n.y), p.x >= n.x && p.x <= n.x + n.w, p.x], ['bottom', Math.abs(p.y - n.y - n.h), p.x >= n.x && p.x <= n.x + n.w, p.x],
          ['left', Math.abs(p.x - n.x), p.y >= n.y && p.y <= n.y + n.h, p.y], ['right', Math.abs(p.x - n.x - n.w), p.y >= n.y && p.y <= n.y + n.h, p.y]]
          .filter(x => x[1] <= T && x[2]).sort((a, b) => a[1] - b[1]);
        if (!c.length) continue;
        if (r.merged && n.id === r.mergeHub && !r.mergeRep) break;
        const side = c[0][0], pos = c[0][3];
        // the stretch leaving the node must run across the side, and a stretch before it must exist
        const nx = q[end ? i - 1 : i + 1], nn = q[end ? i - 2 : i + 2];
        const across = (side === 'top' || side === 'bottom') ? eq(p.x, nx.x) : eq(p.y, nx.y);
        ends.push({ r, n, side, pos, i, nx, nn, movable: !!(across && nn) && !r.merged, end });
        break;
      }
    }
  }
  const groups = new Map();
  for (const e of ends) { const k = e.n.id + '|' + e.side; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  const hitsNode = (x1, y1, x2, y2, skip) => rm.nodes.some(n => n.x !== undefined && n !== skip[0] && n !== skip[1] &&
    Math.min(x1, x2) < n.x + n.w - 0.5 && n.x + 0.5 < Math.max(x1, x2) && Math.min(y1, y2) < n.y + n.h - 0.5 && n.y + 0.5 < Math.max(y1, y2));
  for (const [, list] of groups) {
    if (list.length < 2) continue;
    const horiz = list[0].side === 'top' || list[0].side === 'bottom';
    // ends on one point are put in the order that keeps their links apart once pushed: a link turning right goes
    // right of a straight one, which goes right of one turning left; of two turning the same way, the one that
    // turns sooner goes on the outside of the turn
    const turn = e => { if (!e.nn) return 0; const h = (horiz ? e.nn.x : e.nn.y) - e.pos; return Math.abs(h) < 0.5 ? 0 : Math.sign(h); };
    const reach = e => horiz ? Math.abs(e.nx.y - e.n.y - (e.side === 'bottom' ? e.n.h : 0)) : Math.abs(e.nx.x - e.n.x - (e.side === 'right' ? e.n.w : 0));
    list.sort((a, b) => {
      if (Math.abs(a.pos - b.pos) > 0.5) return a.pos - b.pos;
      const ta = turn(a), tb = turn(b);
      if (ta !== tb) return ta - tb;
      return ta < 0 ? reach(a) - reach(b) : ta > 0 ? reach(b) - reach(a) : 0;
    });
    const n = list[0].n, lo = (horiz ? n.x : n.y) + 5, hi = (horiz ? n.x + n.w : n.y + n.h) - 5;
    // a short side with many links: share the room out evenly, down to 7px between links
    const gap = Math.max(7, Math.min(gap0, (hi - lo) / (list.length - 1)));
    if (!list.some((e, k) => k && list[k].pos - list[k - 1].pos < gap - 0.5)) continue;
    // wanted positions: push apart from the middle of the crowd
    const want = list.map(e => e.pos);
    for (let pass = 0; pass < 20; pass++) {
      let moved = false;
      for (let k = 1; k < want.length; k++) {
        const d = want[k] - want[k - 1];
        if (d >= gap - 0.01) continue;
        const a = list[k - 1], b = list[k], need = gap - d;
        if (a.movable && b.movable) { want[k - 1] -= need / 2; want[k] += need / 2; }
        else if (b.movable) want[k] += need;
        else if (a.movable) want[k - 1] -= need;
        else continue;
        moved = true;
      }
      if (!moved) break;
    }
    if (want.some(v => v < lo || v > hi)) continue;
    const todo = [];
    let ok = true;
    list.forEach((e, k) => {
      if (!ok || !e.movable || Math.abs(want[k] - e.pos) < 0.5) return;
      const q = e.r.pts, ni = e.end ? e.i - 1 : e.i + 1, nj = e.end ? e.i - 2 : e.i + 2;
      const np = horiz ? { x: want[k], y: q[e.i].y } : { x: q[e.i].x, y: want[k] };
      const nm = horiz ? { x: want[k], y: q[ni].y } : { x: q[ni].x, y: want[k] };
      const other = q[nj], skip = [e.r.src || null, e.r.dst || null];
      // the stretch across the side, and the stretch before it that now ends in a new place
      if (hitsNode(np.x, np.y, nm.x, nm.y, skip) || hitsNode(nm.x, nm.y, other.x, other.y, skip)) { ok = false; return; }
      todo.push({ q, i: e.i, ni, np, nm });
    });
    if (!ok) continue;
    for (const t of todo) { t.q[t.i] = t.np; t.q[t.ni] = t.nm; }
  }
}


// [side span]: a side zone is as tall (as wide, beside a flow to the right) as the zones it is linked to, from
// the top of the first to the bottom of the last, and the nodes in it move level with what they are linked to,
// so the links across the gutter are straight. Done after the layout; the links that touch a moved node are
// drawn again, the others stay as they were.
function spanSides(rm, model) {
  const allSides = [...model.frames.values()].filter(f => f.side);
  const zones = allSides;
  if (!allSides.some(f => f.spanSide) || !model.mainLane || (rm.notes || []).some(n => /could not be placed/.test(n))) return;
  const flowH = model.direction === 'RIGHT';
  const A = flowH ? 'x' : 'y', S = flowH ? 'w' : 'h', C = flowH ? 'y' : 'x', CS = flowH ? 'h' : 'w';   // along the side, across it
  const GAP = 14, TITLE = 30;
  const fbox = f => rm.frames.find(b => b.f === f);
  const nbox = id => rm.nodes.find(n => n.id === id);
  const leaves = c => { const out = []; (function w(x) { for (const i of x.items || []) { if (i.type === 'node') out.push(i.id); else w(i); } })(c); return out; };
  const mainItem = id => {
    let p = model.nodes.get(id);
    while (p && p.parent !== model.mainLane) p = p.parent;
    return p || null;
  };
  const boxOfItem = it => it.type === 'frame' ? fbox(it) : it.type === 'node' ? nbox(it.id) : (() => {
    const ids = leaves(it).map(nbox).filter(Boolean);
    if (!ids.length) return null;
    const x = Math.min(...ids.map(b => b.x)), y = Math.min(...ids.map(b => b.y));
    return { x, y, w: Math.max(...ids.map(b => b.x + b.w)) - x, h: Math.max(...ids.map(b => b.y + b.h)) - y };
  })();
  const bySide = {};
  for (const f of zones) (bySide[f.side] = bySide[f.side] || []).push(f);
  const plans = [];
  for (const list of Object.values(bySide)) {
    const mk = [];
    for (const F of list) {
      const FB = fbox(F);
      if (!FB) continue;
      const mine = new Set(leaves(F));
      const ext = [];                                    // the other end of each link that crosses the zone's border
      for (const e of model.edges) {
        const a = mine.has(e.a), b = mine.has(e.b);
        if (a === b) continue;
        const other = a ? e.b : e.a, mineId = a ? e.a : e.b;
        const it = mainItem(other);
        if (!it) continue;
        const ib = boxOfItem(it), ob = nbox(other);
        if (ib && ob) ext.push({ e, other: ob, mine: mineId, item: ib });
      }
      const inner = F.items.filter(i => i.type === 'node').map(i => nbox(i.id)).filter(Boolean);
      const flat = inner.length === leaves(F).length;
      const need = TITLE + (flat ? inner.reduce((t, nb) => t + nb[S] + GAP, -GAP) + 12 : FB[S] - TITLE);
      const fixed = !F.spanSide;                          // a zone without [span] keeps its place and size, and the others make room
      const lo = ext.length && !fixed ? Math.min(FB[A], ...ext.map(x => x.item[A])) : FB[A];
      const hi = ext.length && !fixed ? Math.max(FB[A] + FB[S], ...ext.map(x => x.item[A] + x.item[S])) : FB[A] + FB[S];
      mk.push({ F, FB, mine, ext, inner, flat, need, lo, hi, fixed });
    }
    mk.sort((p, q) => p.lo - q.lo);
    // zones on the same side share the length: where two ranges overlap the line between them is halfway
    for (let i = 1; i < mk.length; i++) {
      const p = mk[i - 1], q = mk[i];
      if (p.hi + GAP > q.lo) {
        if (p.fixed && q.fixed) continue;
        if (p.fixed) q.lo = p.hi + GAP;
        else if (q.fixed) p.hi = q.lo - GAP;
        else { const mid = (Math.max(p.lo, q.lo) + Math.min(p.hi, q.hi)) / 2; p.hi = Math.min(p.hi, mid - GAP / 2); q.lo = Math.max(q.lo, mid + GAP / 2); }
        if (!p.fixed && p.hi < p.lo + p.need) p.hi = p.lo + p.need;
        if (q.lo < p.hi + GAP && !q.fixed) q.lo = p.hi + GAP;
      }
    }
    for (const m of mk) if (!m.fixed && m.hi < m.lo + m.need) m.hi = m.lo + m.need;
    plans.push(...mk);
  }
  for (const m of plans) {
    if (m.fixed) continue;
    const { F, FB, mine, ext, inner, flat } = m, lo = m.lo, hi = m.hi;
    if (flat && inner.length) {
      const want = new Map();
      // where each link will leave the main flow (off any zone border, as below), and the node level with the
      // middle one of them: with the ends spread evenly round the node's middle, that link is straight
      const tw = F.side === 'right' || F.side === 'bottom' ? 1 : -1;
      const gutC = tw > 0 ? FB[C] - 16 : FB[C] + FB[CS] + 16;
      const leaveAt = o => {
        const o1 = tw > 0 ? o[C] + o[CS] : o[C];
        const onB = v => rm.frames.some(f => f[C] < Math.max(o1, gutC) && Math.min(o1, gutC) < f[C] + f[CS] && (Math.abs(v - f[A]) < 8 || Math.abs(v - f[A] - f[S]) < 8));
        let v = o[A] + o[S] / 2;
        if (onB(v)) v = [0.75, 0.25].map(k => o[A] + o[S] * k).find(u => !onB(u)) ?? v;
        return v;
      };
      for (const nb of inner) {
        const cs = ext.filter(x => x.mine === nb.id).map(x => leaveAt(x.other)).sort((a, b) => a - b);
        const rel = (nb[A] + nb[S] / 2 - FB[A]) / FB[S];
        const mid = cs.length % 2 ? cs[(cs.length - 1) / 2] : (cs[cs.length / 2 - 1] + cs[cs.length / 2]) / 2;
        want.set(nb, cs.length ? mid : lo + rel * (hi - lo));
      }
      const ord = [...inner].sort((p, q) => want.get(p) - want.get(q));
      let pos = lo + TITLE;
      for (const nb of ord) { const d = want.get(nb) - nb[S] / 2; nb[A] = Math.max(d, pos); pos = nb[A] + nb[S] + GAP; }
      let limit = hi - 12;                                // not past the end: push back up
      for (let i = ord.length - 1; i >= 0; i--) { const nb = ord[i]; nb[A] = Math.min(nb[A], limit - nb[S]); limit = nb[A] - GAP; }
    }
    FB[A] = lo; FB[S] = hi - lo;
    // draw again the links that touch a node of this zone
    const toward = F.side === 'right' || F.side === 'bottom' ? 1 : -1;   // the zone lies this way from the main flow
    const Q = (al, cr) => flowH ? { x: al, y: cr } : { x: cr, y: al };   // a point from its place along the side and across it
    for (const r of rm.edges) {
      const e = r.e, a = mine.has(e.a), b = mine.has(e.b);
      if (a === b) {
        if (a && flat) {                                     // between two nodes of the zone
          const u = nbox(e.a), v = nbox(e.b);
          if (!u || !v) continue;
          const down = u[A] < v[A];
          const ov0 = Math.max(u[C], v[C]), ov1 = Math.min(u[C] + u[CS], v[C] + v[CS]);
          const m1 = down ? u[A] + u[S] : u[A], m2 = down ? v[A] : v[A] + v[S];
          // a node between them in the way: go round by the far side of the zone
          const between = inner.some(w => w !== u && w !== v && w[A] < Math.max(m1, m2) && Math.min(m1, m2) < w[A] + w[S] && (ov1 > ov0 + 8 ? w[C] < (ov0 + ov1) / 2 + 2 && (ov0 + ov1) / 2 - 2 < w[C] + w[CS] : false));
          if (between) { const far = FB[C] + FB[CS] - 10, c1 = u[C] + u[CS] / 2, c2 = v[C] + v[CS] / 2, a1 = u[A] + u[S] / 2, a2 = v[A] + v[S] / 2; r.pts = [Q(a1, u[C] + u[CS]), Q(a1, far), Q(a2, far), Q(a2, v[C] + v[CS])]; }
          else if (ov1 > ov0 + 8) { const cc = (ov0 + ov1) / 2; r.pts = [Q(m1, cc), Q(m2, cc)]; }
          else { const c1 = u[C] + u[CS] / 2, c2 = v[C] + v[CS] / 2, mid = (m1 + m2) / 2; r.pts = [Q(m1, c1), Q(mid, c1), Q(mid, c2), Q(m2, c2)]; }
        }
        continue;
      }
      const inside = nbox(a ? e.a : e.b), outside = nbox(a ? e.b : e.a);
      if (!inside || !outside || !mainItem(outside.id)) continue;
      // from the main flow across the gutter into the zone
      const o1 = toward > 0 ? outside[C] + outside[CS] : outside[C], i1 = toward > 0 ? inside[C] : inside[C] + inside[CS];
      const gut = toward > 0 ? FB[C] - 16 : FB[C] + FB[CS] + 16;
      // a node that sits on a zone border (a bridge) would send the link along that border: leave lower down
      const onBorder = v => rm.frames.some(f => f[C] < Math.max(o1, gut) && Math.min(o1, gut) < f[C] + f[CS] && (Math.abs(v - f[A]) < 8 || Math.abs(v - f[A] - f[S]) < 8));
      let co = outside[A] + outside[S] / 2;
      if (onBorder(co)) co = [0.75, 0.25].map(k => outside[A] + outside[S] * k).find(v => !onBorder(v)) ?? co;
      const ci = inside[A] + inside[S] / 2;
      const pts = Math.abs(co - ci) < 0.5 ? [Q(co, o1), Q(ci, i1)] : [Q(co, o1), Q(co, gut), Q(ci, gut), Q(ci, i1)];
      if (a) pts.reverse();
      r.pts = pts;
      if (r.lab && e.lab) { const m = { x: (pts[0].x + pts[1].x) / 2, y: pts[0].y }; r.lab = pts.length === 2 ? { x: (pts[0].x + pts[1].x) / 2, y: pts[0].y - 4 - e.lab.h, anchor: 'middle' } : { x: m.x, y: m.y - 4 - e.lab.h, anchor: 'middle' }; }
    }
  }
  // the drawing grows if a zone does
  for (const f of rm.frames) { rm.width = Math.max(rm.width, f.x + f.w + 16); rm.height = Math.max(rm.height, f.y + f.h + 16); }
}

// A node whose links all reach it with a short last step (a run along the flow, then a jog of under 80px to its
// side or end) slides across the flow, when that room is free, so the runs end straight on its side.
function slideToStraighten(rm, flowH) {
  const A = flowH ? 'y' : 'x', B = flowH ? 'x' : 'y', S = flowH ? 'h' : 'w', L = flowH ? 'w' : 'h';
  const eq = (a, b) => Math.abs(a - b) < 0.5;
  for (const n of rm.nodes) {
    if (n.x === undefined || n.cols || n.span || n.kind === 'junction' || n.kind === 'start') continue;
    const mine = rm.edges.filter(r => r.pts && r.pts.length > 1 && !r.e.rail && !r.e.lifeline && !r.e.divider && !r.merged && (r.e.a === n.id || r.e.b === n.id) && r.e.a !== r.e.b);
    if (!mine.length || mine.length > 3) continue;
    // each link seen as arriving at n; its last long run along the flow, and how far the jog after it goes
    const plans = [];
    for (const r of mine) {
      const atEnd = Math.hypot(r.pts[r.pts.length - 1].x - (n.x + n.w / 2), r.pts[r.pts.length - 1].y - (n.y + n.h / 2)) < Math.hypot(r.pts[0].x - (n.x + n.w / 2), r.pts[0].y - (n.y + n.h / 2));
      const P = atEnd ? r.pts : [...r.pts].reverse();
      let k = -1;
      for (let i = P.length - 1; i > 0; i--) if (eq(P[i - 1][A], P[i][A]) && Math.abs(P[i][B] - P[i - 1][B]) > 30) { k = i; break; }
      if (k < 1) { plans.length = 0; break; }
      const tail = P.slice(k).reduce((t, p, i, a) => i ? t + Math.abs(p.x - a[i - 1].x) + Math.abs(p.y - a[i - 1].y) : 0, 0);
      const c = P[k][A];
      // the run must come from the side of n it would enter, and the jog be short
      const fromLow = P[k - 1][B] < n[B];
      if (tail > 80 || (fromLow ? P[k - 1][B] > n[B] - 4 : P[k - 1][B] < n[B] + n[L] + 4)) { plans.length = 0; break; }
      plans.push({ r, atEnd, P, k, c, fromLow });
    }
    if (plans.length !== mine.length) continue;
    const lo = Math.max(...plans.map(q => q.c)) - n[S] + 8, hi = Math.min(...plans.map(q => q.c)) - 8;
    if (lo > hi) continue;
    const to = Math.min(hi, Math.max(lo, n[A]));
    if (Math.abs(to - n[A]) < 0.5) continue;
    const moved = { x: n.x, y: n.y, w: n.w, h: n.h, [A]: to };
    const ov = (a, b, m) => a.x < b.x + b.w + m && b.x - m < a.x + a.w && a.y < b.y + b.h + m && b.y - m < a.y + a.h;
    if (rm.nodes.some(o => o !== n && o.x !== undefined && ov(moved, o, 10))) continue;
    // it stays in the zones that hold it and out of the others
    const holds = fr => { for (let q = n.parent; q; q = q.parent) if (q === fr.f) return true; return false; };
    if (rm.frames.some(fr => holds(fr) ? !(moved.x >= fr.x + 10 && moved.y >= fr.y + 10 && moved.x + moved.w <= fr.x + fr.w - 10 && moved.y + moved.h <= fr.y + fr.h - 10) : ov(moved, fr, 8))) continue;
    if (rm.edges.some(o => !mine.includes(o) && o.pts && o.pts.some((p, i) => i && ov(moved, { x: Math.min(p.x, o.pts[i - 1].x), y: Math.min(p.y, o.pts[i - 1].y), w: Math.abs(p.x - o.pts[i - 1].x), h: Math.abs(p.y - o.pts[i - 1].y) }, 4)))) continue;
    n[A] = to;
    for (const q of plans) {
      const side = q.fromLow ? n[B] : n[B] + n[L];
      const out = [...q.P.slice(0, q.k), { [A]: q.c, [B]: side }].map(p => ({ x: p.x, y: p.y }));
      q.r.pts = q.atEnd ? out : out.reverse();
      if (q.r.lab && q.r.e.lab) q.r.lab = { x: (q.P[q.k - 1][B] + side) / 2, y: q.c - 4 - q.r.e.lab.h, anchor: 'middle', ...(flowH ? {} : { x: q.c + 6, y: (q.P[q.k - 1][B] + side) / 2 - q.r.e.lab.h / 2, anchor: 'start' }) };
    }
  }
}

// Two links with one step each (out, across, in) that cross twice, each step at the height of the other's legs,
// swap their step heights when that clears both crossings and touches no node.
function uncrossSteps(rm) {
  const eq = (a, b) => Math.abs(a - b) < 0.5;
  const steps = [];
  for (const r of rm.edges) {
    if (!r.pts || r.merged || r.e.rail || r.e.lifeline || r.e.divider) continue;
    const q = simplifyPts(r.pts);
    if (q.length !== 4) continue;
    const v = eq(q[0].x, q[1].x) && eq(q[1].y, q[2].y) && eq(q[2].x, q[3].x);
    const h = eq(q[0].y, q[1].y) && eq(q[1].x, q[2].x) && eq(q[2].y, q[3].y);
    if (v || h) steps.push({ r, q, A: v ? 'y' : 'x' });
  }
  const cross = (P, Q) => { let k = 0; for (let i = 1; i < P.length; i++) for (let j = 1; j < Q.length; j++) if (crossSeg(P[i - 1], P[i], Q[j - 1], Q[j])) k++; return k; };
  const hitsNode = (P, r) => P.some((p, i) => i && rm.nodes.some(n => n.x !== undefined && n.id !== r.e.a && n.id !== r.e.b &&
    Math.min(P[i - 1].x, p.x) < n.x + n.w + 6 && n.x - 6 < Math.max(P[i - 1].x, p.x) && Math.min(P[i - 1].y, p.y) < n.y + n.h + 6 && n.y - 6 < Math.max(P[i - 1].y, p.y)));
  for (let i = 0; i < steps.length; i++) for (let j = i + 1; j < steps.length; j++) {
    const a = steps[i], b = steps[j];
    if (a.A !== b.A || cross(a.q, b.q) < 2) continue;
    const A = a.A, ca = a.q[1][A], cb = b.q[1][A];
    const move = (q, c) => q.map((p, k) => k === 1 || k === 2 ? { ...p, [A]: c } : { ...p });
    const na = move(a.q, cb), nb = move(b.q, ca);
    // the legs must keep their direction (the new step between each link's two ends)
    const okDir = (q, n) => Math.sign(n[1][A] - n[0][A]) === Math.sign(q[1][A] - q[0][A]) && Math.sign(n[3][A] - n[2][A]) === Math.sign(q[3][A] - q[2][A]) && Math.abs(n[1][A] - n[0][A]) >= 8 && Math.abs(n[3][A] - n[2][A]) >= 8;
    if (!okDir(a.q, na) || !okDir(b.q, nb) || cross(na, nb) !== 0 || hitsNode(na, a.r) || hitsNode(nb, b.r)) continue;
    // and add no crossing with the other links
    const others = rm.edges.filter(o => o !== a.r && o !== b.r && o.pts);
    const before = others.reduce((t, o) => t + cross(a.q, o.pts) + cross(b.q, o.pts), 0), after = others.reduce((t, o) => t + cross(na, o.pts) + cross(nb, o.pts), 0);
    if (after > before) continue;
    // nor lie on another link (closer than 8px they read as one)
    if (overlapsLinks(rm, na, new Set([a.r, b.r]), 8) || overlapsLinks(rm, nb, new Set([a.r, b.r]), 8)) continue;
    const lab = (s, c0, c1) => { if (s.r.lab && Math.abs((A === 'y' ? s.r.lab.y : s.r.lab.x) - c0) < 30) { if (A === 'y') s.r.lab.y += c1 - c0; else s.r.lab.x += c1 - c0; } };
    lab(a, ca, cb); lab(b, cb, ca);
    a.r.pts = na; b.r.pts = nb; a.q = na; b.q = nb;
  }
}

// A stretch that is almost straight (up to 2px off, left by rounding in a tidy-up) is made straight: the end that
// is on a node stays, and the run of points on the other side moves with it, so the stretches next to it keep their
// direction.
function squareUp(rm) {
  for (const r of rm.edges) {
    const P = r.pts;
    if (!P || P.length < 2 || r.e.rail) continue;
    for (const [A, B] of [['x', 'y'], ['y', 'x']]) {
      // runs of points along B whose A differs by at most 2px (but not all the same): set to the run's first A,
      // or its last when the run ends on the last point and does not start on the first
      let i = 0;
      while (i < P.length - 1) {
        let j = i;
        while (j < P.length - 1 && Math.abs(P[j + 1][A] - P[j][A]) <= 2 && Math.abs(P[j + 1][B] - P[j][B]) > 4 * Math.abs(P[j + 1][A] - P[j][A])) j++;
        if (j > i) {
          const vals = P.slice(i, j + 1).map(q => q[A]);
          if (Math.max(...vals) - Math.min(...vals) > 0.01) {
            const target = i === 0 || j < P.length - 1 ? P[i][A] : P[j][A];
            for (let k = i; k <= j; k++) P[k][A] = target;
          }
        }
        i = j + 1;
      }
    }
  }
}

// The drawing is as big as what it holds, plus its 16px margin: a tidy-up that moved things (align, a zone pulled
// in) leaves nothing past the left or top edge and no blank band at the right or the bottom.
function fitCanvas(rm) {
  // nothing closer than 16px to the left or top edge (8px for a label): everything shifts right or down
  const labBox = r => { const w = r.e.lab.w; return { x: r.lab.anchor === 'middle' ? r.lab.x - w / 2 : r.lab.anchor === 'end' ? r.lab.x - w : r.lab.x, y: r.lab.y }; };
  const xs = [16, ...rm.nodes.filter(n => n.x !== undefined).map(n => n.x), ...rm.frames.map(f => f.x), ...rm.edges.flatMap(r => (r.pts || []).map(p => p.x + 6)),
    ...rm.edges.filter(r => r.lab && r.e.lab).map(r => labBox(r).x + 8)];
  const ys = [16, ...rm.nodes.filter(n => n.x !== undefined).map(n => n.y), ...rm.frames.map(f => f.y), ...rm.edges.flatMap(r => (r.pts || []).map(p => p.y + 6)),
    ...rm.edges.filter(r => r.lab && r.e.lab).map(r => labBox(r).y + 8)];
  const dx = 16 - Math.min(...xs), dy = 16 - Math.min(...ys);
  if (dx > 0.5 || dy > 0.5) {
    const ddx = Math.max(0, dx), ddy = Math.max(0, dy), mv = o => { o.x += ddx; o.y += ddy; };
    for (const n of rm.nodes) if (n.x !== undefined) mv(n);
    for (const g of (rm.model && rm.model.groups) || []) if (g.x !== undefined) mv(g);
    for (const f of rm.frames) mv(f);
    for (const r of rm.edges) { (r.pts || []).forEach(mv); if (r.lab) mv(r.lab); }
    for (const rl of rm.rails || []) { mv(rl); (rl.bus || []).forEach(mv); (rl.dots || []).forEach(mv); }
    (rm.joins || []).forEach(mv);
    rm.width += ddx; rm.height += ddy;
  }
  let X = 0, Y = 0;
  const take = (x, y) => { if (x > X) X = x; if (y > Y) Y = y; };
  for (const n of rm.nodes) if (n.x !== undefined) take(n.x + n.w, n.y + n.h);
  for (const f of rm.frames) take(f.x + f.w, f.y + f.h);
  for (const r of rm.edges) {
    for (const p of r.pts || []) take(p.x, p.y);
    if (r.lab && r.e.lab) { const w = r.e.lab.w; take(r.lab.anchor === 'middle' ? r.lab.x + w / 2 : r.lab.anchor === 'end' ? r.lab.x : r.lab.x + w, r.lab.y + r.e.lab.h); }
  }
  for (const rl of rm.rails || []) take(rl.x + rl.w, rl.y + rl.h);
  if (X > 0 && X + 16 < rm.width) rm.width = X + 16;
  if (Y > 0 && Y + 16 < rm.height) rm.height = Y + 16;
}

// The tidy-up runs on the layout that was chosen, after the choice: it changes the number of points in a
// link without changing how it looks, and the choice is made on those counts.
// opts.off lists the automatic tidy-ups to leave out (for showing what they do): 'wrap', 'fold', 'merge', 'tidy'
async function layout(model, measure, ELK, opts) {
  const env = (typeof process !== 'undefined' && process.env) || {};
  const off = new Set((opts && opts.off) || []);
  model.noWrap = off.has('wrap');
  if (!off.has('merge') && !model.junctionsDone) { addJunctions(model); model.junctionsDone = true; }
  const finish = rm => { if (isTree(model)) centreParents(rm, model.direction === 'RIGHT'); placeOnConcentrators(rm); splitDecisions(rm, model.direction === 'RIGHT'); spanSides(rm, model); clearFrames(rm); alignJogs(rm); simplifySnakes(rm); if (!off.has('merge')) mergeHubs(rm); rerouteBlocked(rm); straightenSmallJogs(rm); reorderEnds(rm); if (!off.has('tidy')) { spreadEnds(rm); separateParallels(rm); } uncrossSteps(rm); resolveOverlaps(rm); slideToStraighten(rm, model.direction === 'RIGHT'); rerouteBlocked(rm, null, true); squareUp(rm); placeLabels(rm, measure); roomForTitles(rm); alignTitleEdges(rm); sameSizeFrames(rm, model); fitCanvas(rm); return rm; };
  const run = async () => finish(await chooseLayout(model, measure, ELK));
  let rm = await run();
  // A strip that is still much wider than tall is folded: the top-level items, in the order they lie, go into
  // two or three rows (items above each other stay one column). Kept only when the finished drawing is
  // clearly better: less width, and no more tangle.
  if (!env.TRACE_NOFOLD && !off.has('fold') && rm.width / rm.height > 3.5 && rm.width > 1500 && model.frames.size) {
    const fold = await foldCandidate(model, rm, run);
    if (fold) return fold;
    rm = await run();      // the model holds the last try: draw the strip again
  }
  return rm;
}

// A bus belongs to the group it gathers. Five or more links with the same meaning between one node and
// several nodes that all stand in one zone (the node itself outside it) meet at a junction inside that zone,
// as close to them as the layout can put it, and only one link crosses the zone's edge: into the zone for a
// fan-out (an API gateway to its services), out of it for a fan-in (every service to the identity provider).
// The junction is a point the layout places like a node, so the members line up beside it; the branches
// between it and the members are then merged into a bus like any other.
function addJunctions(model) {
  const MIN = 5;                       // more than four links: below that, separate links read well enough
  const frames = n => { const a = []; for (let p = n.parent; p; p = p.parent) if (p.type === 'frame') a.unshift(p); return a; };
  const groups = new Map();
  for (const e of model.edges) {
    if (e.rail || e.a === e.b || e.aCol || e.bCol || (e.start && e.end)) continue;
    const A = model.nodes.get(e.a), B = model.nodes.get(e.b);
    if (!A || !B || A.kind === 'table' || B.kind === 'table') continue;
    for (const role of ['b', 'a']) {
      const k = [e[role], role, e.label || '', (e.tags || []).join(','), !!e.dashed, !!e.start, !!e.end].join('|');
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }
  }
  const used = new Set();
  let n = 0;
  for (const [k, list0] of [...groups.entries()].sort((x, y) => y[1].length - x[1].length)) {
    const list = list0.filter(e => !used.has(e));
    if (list.length < MIN) continue;
    const role = k.split('|')[1], other = role === 'b' ? 'a' : 'b';
    const hub = model.nodes.get(list[0][role]);
    const hubFrames = frames(hub);
    // the zone that holds most of the others (at least five), the innermost such zone, the hub standing
    // outside it; the links from outside that zone stay ordinary links
    const count = new Map();
    for (const e of list) { const x = model.nodes.get(e[other]); if (!x || x.span) continue; for (const f of frames(x)) count.set(f, (count.get(f) || 0) + 1); }
    let F = null;
    for (const [f, c] of count) if (c >= MIN && !hubFrames.includes(f) && (!F || c > count.get(F) || (c === count.get(F) && frames(f.items[0] || f).length > frames(F.items[0] || F).length))) F = f;
    if (!F) continue;
    const inF = x => { for (let p = x.parent; p; p = p.parent) if (p === F) return true; return false; };
    list.splice(0, list.length, ...list.filter(e => { const x = model.nodes.get(e[other]); return x && !x.span && inF(x); }));
    // a fan-in gathers where the zone is left, a fan-out spreads where it is entered
    const j = { type: 'node', id: '_junction' + (++n), kind: 'junction', name: '', note: '', tags: [], parent: F, line: list[0].line, junction: role === 'b' ? 'last' : 'first' };
    j.links = list.length;
    F.items.push(j);
    model.nodes.set(j.id, j);
    const e0 = list[0];
    // the trunk keeps the words, the style and the arrowhead at the hub; the branches keep the arrowhead at each member
    const trunk = role === 'b'
      ? { a: j.id, b: hub.id, op: e0.op, label: e0.label, tags: e0.tags.slice(), dashed: e0.dashed, start: false, end: e0.end, line: e0.line, trunk: true }
      : { a: hub.id, b: j.id, op: e0.op, label: e0.label, tags: e0.tags.slice(), dashed: e0.dashed, start: e0.start, end: false, line: e0.line, trunk: true };
    for (const e of list) {
      e[role] = j.id;
      e.label = '';
      if (role === 'b') e.end = false; else e.start = false;
      e.branch = true;
      used.add(e);
    }
    model.edges.push(trunk);
  }
}

// Links on a concentrator: in the order their other ends lie, 14px apart, centred on its one link, each
// arriving straight; the step of each link stands beside the concentrator, staggered so that none cross.
function placeOnConcentrators(rm) {
  for (const j of rm.nodes.filter(n => n.kind === 'junction' && n.x !== undefined)) {
    const vert = !!j.barV;                    // links arrive on the left or right side
    const A = vert ? 'y' : 'x', B = vert ? 'x' : 'y', S = vert ? 'h' : 'w', Bs = vert ? 'w' : 'h';
    const fanIn = j.junction === 'last';
    const mine = rm.edges.filter(r => r.pts && (r.e.a === j.id || r.e.b === j.id));
    const one = mine.find(r => r.e.trunk);
    const many = mine.filter(r => r !== one);
    const c = j[A] + j[S] / 2;
    // the wide side faces the many links: left (or top) for a fan-in, right (or bottom) for a fan-out
    const wide = fanIn ? j[B] : j[B] + j[Bs], narrow = fanIn ? j[B] + j[Bs] : j[B];
    const dir = fanIn ? -1 : 1;                    // from the wide side toward the members
    const other = r => rm.nodes.find(n => n.id === (r.e.a === j.id ? r.e.b : r.e.a));
    const items = many.map(r => ({ r, n: other(r) })).filter(x => x.n && x.n.x !== undefined);
    items.sort((a, b) => (a.n[A] + a.n[S] / 2) - (b.n[A] + b.n[S] / 2));
    // each link arrives level with its member, so it runs straight; two members at nearly the same level
    // share out the room 14px apart. The bar then reaches from the first link to the last (and its own link).
    items.forEach((it, k) => { it.from = it.n[A] + it.n[S] / 2; it.at = Math.max(it.from, k ? items[k - 1].at + 14 : -Infinity); });
    if (items.length) {
      const lo = Math.min(items[0].at, c), hi = Math.max(items[items.length - 1].at, c);
      j[A] = lo - 7; j[S] = hi - lo + 14;
    }
    // steps: links going toward the middle from above step nearer the concentrator the higher they arrive
    const down = items.filter(it => it.from <= it.at), up = items.filter(it => it.from > it.at);
    down.sort((a, b) => a.at - b.at); up.sort((a, b) => b.at - a.at);
    const stepAt = new Map();
    down.forEach((it, k) => stepAt.set(it, wide + dir * (12 + 8 * k)));
    up.forEach((it, k) => stepAt.set(it, wide + dir * (12 + 8 * k)));
    for (const it of items) {
      const n = it.n, nearSide = fanIn ? n[B] + n[Bs] : n[B];
      const P = (a, b) => vert ? { x: b, y: a } : { x: a, y: b };
      const st = stepAt.get(it);
      let pts = Math.abs(it.from - it.at) < 0.5 ? [P(it.at, nearSide), P(it.at, wide)] : [P(it.from, nearSide), P(it.from, st), P(it.at, st), P(it.at, wide)];
      if (!fanIn) pts = pts.reverse();
      // the plain route only when nothing stands in its way; otherwise the layout's route, its last stretch
      // moved to the link's place on the concentrator
      const blocks = q => q.some((b, i) => i && rm.nodes.some(m => m.x !== undefined && m !== n && m !== j &&
        Math.min(q[i - 1].x, b.x) < m.x + m.w + 4 && m.x - 4 < Math.max(q[i - 1].x, b.x) && Math.min(q[i - 1].y, b.y) < m.y + m.h + 4 && m.y - 4 < Math.max(q[i - 1].y, b.y)));
      if (blocks(pts)) {
        // the layout's route, arriving at a free place on the bar: not level with the bar's own link (it would
        // read as one line through the bar) nor with another link; tried at its own level, then 14px steps away
        const q0 = it.r.pts.map(p => ({ ...p })), L = q0.length;
        const e = fanIn ? L - 1 : 0, e1 = fanIn ? L - 2 : 1, e2 = fanIn ? L - 3 : 2;
        const taken = v => Math.abs(v - c) < 10 || items.some(o => o !== it && o.placed !== undefined && Math.abs(o.placed - v) < 10);
        pts = it.r.pts;
        if (L >= 3 && Math.abs(q0[e][A] - q0[e1][A]) < 0.5 && Math.abs(q0[e1][B] - q0[e2][B]) < 0.5) {
          for (const d of [0, 14, -14, 28, -28, 42, -42]) {
            const v = q0[e][A] + d;
            if (taken(v)) continue;
            const q = q0.map(p => ({ ...p }));
            q[e] = { ...q[e], [A]: v, [B]: wide }; q[e1] = { ...q[e1], [A]: v };
            if (!blocks(q)) { pts = q; break; }
          }
        }
      }
      it.placed = (fanIn ? pts[pts.length - 1] : pts[0])[A];
      it.r.pts = pts;
    }
    if (items.length) {
      const lo = Math.min(c, ...items.map(it => it.placed)), hi = Math.max(c, ...items.map(it => it.placed));
      j[A] = lo - 7; j[S] = hi - lo + 14;
    }
    if (one) {
      // the bar's own link arrives at a free level: level with a member's link it would read as one line
      // through the bar, so it takes the nearest gap between two of them (with a short step before the bar)
      const P = (a, b) => vert ? { x: b, y: a } : { x: a, y: b };
      const lv = items.map(it => it.placed).sort((u, v) => u - v);
      let t = c;
      if (lv.some(v => Math.abs(v - t) < 10)) {
        const gaps = [];
        for (let k = 1; k < lv.length; k++) if (lv[k] - lv[k - 1] >= 20) gaps.push((lv[k] + lv[k - 1]) / 2);
        if (lv.length) gaps.push(lv[0] - 14, lv[lv.length - 1] + 14);
        t = gaps.sort((u, v) => Math.abs(u - c) - Math.abs(v - c))[0];
      }
      const q = one.pts.map(p => ({ ...p })), L = q.length;
      const step = narrow - dir * 12;            // just outside the narrow side, away from the members
      if (fanIn) {
        if (Math.abs(t - q[0][A]) < 0.5 && L > 1 && Math.abs(q[1][A] - q[0][A]) < 0.5) { q[0] = P(t, narrow); }
        else if (L > 1 && Math.abs(q[1][A] - c) < 0.5) { q.splice(0, 1, P(t, narrow), P(t, step), P(q[1][A], step)); }
        else q[0] = P(t, narrow);
      } else {
        if (L > 1 && Math.abs(q[L - 2][A] - c) < 0.5 && Math.abs(t - c) > 0.5) q.splice(L - 1, 1, P(q[L - 2][A], step), P(t, step), P(t, narrow));
        else q[L - 1] = P(t, narrow);
      }
      one.pts = simplifyPts(q);
      const lo = Math.min(t, ...lv), hi = Math.max(t, ...lv);
      j[A] = lo - 7; j[S] = hi - lo + 14;
    }
  }
}

// A decision whose two outcomes leave from the same side (both down, in a flow down) sends the one whose target
// lies further across the flow out of the side facing it, as an L to the target: yes and no then part at the
// box, as a flowchart draws them. Only when that L touches no other node.
function splitDecisions(rm, flowH) {
  const A = flowH ? 'y' : 'x', B = flowH ? 'x' : 'y', S = flowH ? 'h' : 'w', Bs = flowH ? 'w' : 'h';
  const P = (a, b) => flowH ? { x: b, y: a } : { x: a, y: b };
  for (const n of rm.nodes) {
    if (n.kind !== 'ask' || n.x === undefined) continue;
    const out = rm.edges.filter(r => r.pts && r.pts.length > 1 && r.e.a === n.id && r.e.b !== n.id && !r.e.start);
    if (out.length !== 2) continue;
    const exit = n[B] + n[Bs];                                     // the side the flow leaves by
    const leaves = r => Math.abs(r.pts[0][B] - exit) < 2;
    if (!out.every(leaves)) continue;
    const c = n[A] + n[S] / 2;
    const tgt = r => rm.nodes.find(m => m.id === r.e.b);
    const off = r => { const t = tgt(r); return t ? t[A] + t[S] / 2 - c : 0; };
    const side = out.reduce((a, b) => Math.abs(off(b)) > Math.abs(off(a)) ? b : a);
    const t = tgt(side), d = off(side);
    if (!t || Math.abs(d) < n[S] / 2 + 8) continue;               // its target is not off to one side
    if (t[B] < exit + 12) continue;                               // nor further along the flow
    const lvl = n[B] + n[Bs] / 2, ta = t[A] + t[S] / 2;
    const pts = [P(d > 0 ? n[A] + n[S] : n[A], lvl), P(ta, lvl), P(ta, t[B])];
    const hit = pts.some((p, i) => i && rm.nodes.some(m => m.x !== undefined && m !== n && m !== t &&
      Math.min(pts[i - 1].x, p.x) < m.x + m.w + 6 && m.x - 6 < Math.max(pts[i - 1].x, p.x) && Math.min(pts[i - 1].y, p.y) < m.y + m.h + 6 && m.y - 6 < Math.max(pts[i - 1].y, p.y)));
    if (hit || overlapsLinks(rm, pts, new Set([side])) || crossingsWith(rm, pts, side) > crossingsWith(rm, side.pts, side)) continue;
    side.pts = pts;
    // its label on the stretch leaving the box (placeLabels moves it if anything is in the way)
    if (side.e.lab) {
      const m = P(n[A] + (d > 0 ? n[S] : 0) + (d > 0 ? 1 : -1) * Math.min(Math.abs(ta - c) - n[S] / 2, 60) / 2, lvl);
      side.lab = flowH ? { x: m.x + 6, y: m.y - side.e.lab.h / 2, anchor: 'start' } : { x: m.x, y: m.y - 4 - side.e.lab.h, anchor: 'middle' };
    }
  }
}

// A hierarchy: a tree (no zones, no layout blocks, every node reached by at most one link, one root) with no
// decisions. Its parents are centred on their children.
// Only when asked for with the line `tree`: a diagram shaped as a hierarchy is not drawn this way by itself.
function isTree(model) {
  if (model.treeShape !== undefined) return model.treeShape;
  const ok = (() => {
    if (!model.tree || model.groups.length || model.mode === 'sequence') return false;
    const nodes = [...model.nodes.values()];
    // a flowchart (decisions) keeps its straight main path; centring is for hierarchies
    if (nodes.some(n => n.kind === 'ask')) return false;
    const into = new Map();
    for (const e of model.edges) {
      if (e.a === e.b || e.start) return false;
      into.set(e.b, (into.get(e.b) || 0) + 1);
    }
    if ([...into.values()].some(v => v > 1)) return false;
    return nodes.length >= 4 && model.edges.length === nodes.length - 1 && nodes.filter(n => !into.has(n.id)).length === 1;
  })();
  model.treeShape = ok;
  return ok;
}

// In a hierarchy each parent slides to the exact middle of its children (from the deepest level up), when the
// slide touches no other node; then every link is drawn as an org chart draws it: a stem from the middle of the
// parent, a bar across its children, a drop to the middle of each child. A parent's links share stem and bar,
// so they are one bus.
function centreParents(rm, flowH) {
  const A = flowH ? 'y' : 'x', S = flowH ? 'h' : 'w', B = flowH ? 'x' : 'y', T = flowH ? 'w' : 'h';
  const P = (a, b) => flowH ? { x: b, y: a } : { x: a, y: b };
  const kids = new Map();
  for (const r of rm.edges) { if (!r.pts) continue; if (!kids.has(r.e.a)) kids.set(r.e.a, []); kids.get(r.e.a).push(r); }
  const depth = new Map(), N = id => rm.nodes.find(n => n.id === id);
  const deep = id => { if (depth.has(id)) return depth.get(id); const d = 1 + Math.max(0, ...(kids.get(id) || []).map(r => deep(r.e.b))); depth.set(id, d); return d; };
  for (const n of rm.nodes) deep(n.id);
  const parents = rm.nodes.filter(n => kids.has(n.id) && n.x !== undefined).sort((a, b) => depth.get(a.id) - depth.get(b.id));
  for (const p of parents) {
    const cs = kids.get(p.id).map(r => N(r.e.b)).filter(c => c && c.x !== undefined);
    if (!cs.length) continue;
    const lo = Math.min(...cs.map(c => c[A] + c[S] / 2)), hi = Math.max(...cs.map(c => c[A] + c[S] / 2));
    const d = (lo + hi) / 2 - (p[A] + p[S] / 2);
    if (Math.abs(d) < 0.5) continue;
    const moved = { ...p, [A]: p[A] + d };
    if (rm.nodes.some(m => m !== p && m.x !== undefined && moved.x < m.x + m.w + 8 && m.x - 8 < moved.x + moved.w && moved.y < m.y + m.h + 8 && m.y - 8 < moved.y + moved.h)) continue;
    // a parent stays inside the zones that hold it, 10px from their border, and out of every other zone
    const holds = fr => { for (let q = p.parent; q; q = q.parent) if (q === fr.f) return true; return false; };
    if ((rm.frames || []).some(fr => holds(fr)
      ? !(moved.x >= fr.x + 10 && moved.x + moved.w <= fr.x + fr.w - 10 && moved.y >= fr.y + 10 && moved.y + moved.h <= fr.y + fr.h - 10)
      : moved.x < fr.x + fr.w + 8 && fr.x - 8 < moved.x + moved.w && moved.y < fr.y + fr.h + 8 && fr.y - 8 < moved.y + moved.h)) continue;
    p[A] += d;
  }
  for (const p of parents) {
    const list = kids.get(p.id).filter(r => { const c = N(r.e.b); return c && c.x !== undefined && c[B] > p[B] + p[T]; });
    if (!list.length) continue;
    const pc = p[A] + p[S] / 2, out = p[B] + p[T];
    const mid = out + (Math.min(...list.map(r => N(r.e.b)[B])) - out) / 2;
    list.forEach((r, i) => {
      const c = N(r.e.b), cc = c[A] + c[S] / 2;
      r.pts = Math.abs(cc - pc) < 0.5 ? [P(pc, out), P(cc, c[B])] : [P(pc, out), P(pc, mid), P(cc, mid), P(cc, c[B])];
      if (list.length > 1) { r.merged = true; r.mergeHub = p.id; r.mergeRep = i === 0; }
      if (r.e.lab) r.lab = flowH ? { x: c[B] - 6, y: cc - r.e.lab.h - 2, anchor: 'end' } : { x: cc + 6, y: mid + 4, anchor: 'start' };
    });
  }
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
  // a concentrator stands beyond what it gathers: after its members for a fan-in, before them for a fan-out
  const flowH = model.direction === 'RIGHT';
  const barsOk = rm => rm.nodes.every(j => {
    if (j.kind !== 'junction' || j.x === undefined) return true;
    const A = flowH ? 'x' : 'y', S = flowH ? 'w' : 'h';
    const members = model.edges.filter(e => !e.trunk && (e.a === j.id || e.b === j.id)).map(e => rm.nodes.find(n => n.id === (e.a === j.id ? e.b : e.a))).filter(n => n && n.x !== undefined);
    return j.junction === 'last' ? members.every(n => n[A] + n[S] <= j[A] + 1) : members.every(n => n[A] >= j[A] + j[S] - 1);
  });
  const valid = rm => linked(rm) && barsOk(rm) && !(rm.frames.some(fr => rm.nodes.some(n => !owns(fr.f, n) && !n.tags.includes('bridge') && ov(fr, n))) ||
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
    if (m === 'hierwrap' && !(tried.length && tried[0].rm.width / tried[0].rm.height > 4 && !env.TRACE_NOWRAP && !model.noWrap)) continue;
    for (const cyc of cycles) {
      // ELK itself throws on a few combinations (fixed table ports with MODEL_ORDER cycle breaking): that way of placing is skipped
      let rm = null;
      try { rm = await layoutOnce(model, measure, ELK, modes[m][0], modes[m][1], modes[m][2], cyc); } catch (err) { if (cyc === undefined && m === 'compound') throw err; if (env.TRACE_DEBUG) console.error(m, cyc || '', 'THREW', err.message); }
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

// Crossings between links that do not share a node.
function crossingsOf(rm) {
  const segs = rm.edges.map(({ pts }) => (pts || []).slice(1).map((p, i) => [pts[i], p]));
  const o = (p, q, r) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const X = (a, b, c, d) => o(a, b, c) * o(a, b, d) < -1e-6 && o(c, d, a) * o(c, d, b) < -1e-6;
  let n = 0;
  for (let i = 0; i < rm.edges.length; i++) for (let j = i + 1; j < rm.edges.length; j++) {
    const a = rm.edges[i].e, b = rm.edges[j].e;
    if (a.a === b.a || a.a === b.b || a.b === b.a || a.b === b.b) continue;
    for (const s of segs[i]) for (const t of segs[j]) if (X(s[0], s[1], t[0], t[1])) n++;
  }
  return n;
}

// The longest stretch of one link that runs against the direction of flow (leftwards, in a diagram that flows
// right). A strip has none; every fold adds one, where the row ends and the next begins.
function longestReturn(rm) {
  let max = 0;
  for (const { e, pts } of rm.edges) {
    if (!pts || e.rail || e.lifeline) continue;
    let len = 0;
    for (let i = 1; i < pts.length; i++) { const a = pts[i - 1], b = pts[i]; if (Math.abs(a.y - b.y) < 0.5 && b.x < a.x - 1) len += a.x - b.x; }
    max = Math.max(max, len);
  }
  return max;
}

// Link labels with another link running through them (after the labels are placed).
function labelHits(rm) {
  let n = 0;
  for (const r of rm.edges) {
    if (!r.lab || !r.e.lab) continue;
    const w = r.e.lab.w, h = r.e.lab.h;
    const x0 = r.lab.anchor === 'middle' ? r.lab.x - w / 2 : r.lab.anchor === 'end' ? r.lab.x - w : r.lab.x;
    for (const o of rm.edges) {
      if (o === r || !o.pts) continue;
      for (let i = 1; i < o.pts.length; i++) {
        const a = o.pts[i - 1], b = o.pts[i];
        if (Math.min(a.x, b.x) < x0 + w && x0 < Math.max(a.x, b.x) && Math.min(a.y, b.y) < r.lab.y + h && r.lab.y < Math.max(a.y, b.y)) { n++; break; }
      }
    }
  }
  return n;
}

// Try the rows of a folded layout on a model whose top level is in `best.rm` (laid out as a strip). The model
// is changed while trying and put back when the fold does not win; when it wins the model keeps its rows.
async function foldCandidate(model, rm, choose) {
  const DEBUG = typeof process !== 'undefined' && process.env && process.env.TRACE_DEBUG;
  const root = model.root;
  const cost = (r, bends) => bends + 160 * (1 - Math.min(1, 1100 / r.width));
  const bendsOf = r => r.edges.reduce((t, e) => t + Math.max(0, e.pts.length - 2), 0);
  const best = { rm, cost: cost(rm, bendsOf(rm)) };
  const movable = root.items.filter(it => it.type === 'node' || it.type === 'frame' || it.type === 'group' || it.type === 'lane');
  if (movable.length < 3 || movable.length !== root.items.filter(it => it.type !== 'rail').length) return null;
  const boxOf = it => {
    if (it.type === 'frame') { const f = rm.frames.find(x => x.f === it); return f && { x: f.x, y: f.y, w: f.w, h: f.h }; }
    if (it.type === 'node' || it.type === 'group') return it.x === undefined ? null : { x: it.x, y: it.y, w: it.w, h: it.h };
    const bs = [...leafItems(it)].map(boxOf).filter(Boolean);
    if (!bs.length) return null;
    const x = Math.min(...bs.map(b => b.x)), y = Math.min(...bs.map(b => b.y));
    return { x, y, w: Math.max(...bs.map(b => b.x + b.w)) - x, h: Math.max(...bs.map(b => b.y + b.h)) - y };
  };
  const boxes = movable.map(it => ({ it, b: boxOf(it) }));
  if (boxes.some(x => !x.b)) return null;
  boxes.sort((a, b) => a.b.x - b.b.x);
  // items that lie above each other (they share most of their x range) form one column
  const clusters = [];
  for (const x of boxes) {
    const c = clusters[clusters.length - 1];
    if (c && Math.min(c.x2, x.b.x + x.b.w) - Math.max(c.x1, x.b.x) > 0.5 * Math.min(c.x2 - c.x1, x.b.w)) { c.items.push(x); c.x1 = Math.min(c.x1, x.b.x); c.x2 = Math.max(c.x2, x.b.x + x.b.w); }
    else clusters.push({ items: [x], x1: x.b.x, x2: x.b.x + x.b.w });
  }
  if (clusters.length < 2) return null;
  const saved = { items: root.items.slice(), parents: new Map(), groups: model.groups.slice() };
  for (const it of movable) saved.parents.set(it, it.parent);
  const restore = () => { root.items = saved.items; for (const [it, p] of saved.parents) it.parent = p; model.groups = saved.groups; };
  let n = 0;
  const lane = (axis, items, parent) => { const l = { type: 'lane', id: '_fold' + (++n), axis, title: '', items, parent, line: 0 }; for (const it of items) it.parent = l; return l; };
  const wOf = c => c.x2 - c.x1;
  let winner = null;
  for (const rows of [2, 3]) {
    if (clusters.length < rows) break;
    // split the clusters into `rows` runs of about equal width
    const total = clusters.reduce((t, c) => t + wOf(c), 0);
    const runs = [[]];
    let acc = 0;
    for (const c of clusters) {
      if (runs.length < rows && acc >= total * runs.length / rows - wOf(c) / 2 && runs[runs.length - 1].length) runs.push([]);
      runs[runs.length - 1].push(c); acc += wOf(c);
    }
    if (runs.length < rows) continue;
    restore();
    const outer = { type: 'lane', id: '_fold0', axis: 'v', title: '', items: [], parent: root, line: 0 };
    outer.items = runs.map(run => {
      const kids = run.map(c => c.items.length === 1 ? c.items[0].it : lane('v', c.items.sort((a, b) => a.b.y - b.b.y).map(x => x.it), null));
      const r = lane('h', kids, outer);
      for (const k of kids) k.parent = r;
      return r;
    });
    root.items = [outer, ...root.items.filter(it => it.type === 'rail')];
    outer.parent = root;
    let r2 = null;
    try { r2 = await choose(); } catch (err) { if (DEBUG) console.error('fold', rows, 'failed:', err.message); }
    if (!r2) continue;
    const c2 = cost(r2, bendsOf(r2));
    if (DEBUG) console.error('fold', rows, Math.round(r2.width) + 'x' + Math.round(r2.height), 'cost', c2.toFixed(1), 'vs', best.cost.toFixed(1));
    // a fold may not trade the width for a tangle: no more crossings, no more than 15% more bends, and no return link longer than 30% of the width than the strip
    const worse = crossingsOf(r2) > crossingsOf(best.rm) || bendsOf(r2) > bendsOf(best.rm) * 1.15 + 2 || labelHits(r2) > labelHits(best.rm)
      // the link that comes back to the start of the next row must not cross most of the page
      || longestReturn(r2) > Math.max(0.3 * r2.width, longestReturn(best.rm));
    if (!worse && c2 < best.cost * 0.92 && (!winner || c2 < winner.cost)) winner = { cost: c2, rows };
  }
  if (!winner) { restore(); return null; }
  // build the winning fold again, so the model holds it
  const runsFor = rows => { const total = clusters.reduce((t, c) => t + wOf(c), 0); const runs = [[]]; let acc = 0; for (const c of clusters) { if (runs.length < rows && acc >= total * runs.length / rows - wOf(c) / 2 && runs[runs.length - 1].length) runs.push([]); runs[runs.length - 1].push(c); acc += wOf(c); } return runs; };
  restore();
  const outer = { type: 'lane', id: '_fold0', axis: 'v', title: '', items: [], parent: root, line: 0 };
  outer.items = runsFor(winner.rows).map(run => { const kids = run.map(c => c.items.length === 1 ? c.items[0].it : lane('v', c.items.map(x => x.it), null)); const r = lane('h', kids, outer); for (const k of kids) k.parent = r; return r; });
  root.items = [outer, ...root.items.filter(it => it.type === 'rail')];
  return choose();
}

async function layoutOnce(model, measure, ELK, FLAT, HIER, WRAP, CYC, LANEP) {
  const S = model.spacing;
  // links to zones go through the per-zone layout only where it is needed: when rows or columns of zones are written
  // (a diagram without them keeps the other layouts, which draw it as before); and a link between a zone and
  // something inside it has no place in it at all
  const zoneLinks = model.edges.some(e => model.frames.has(e.a) || model.frames.has(e.b));
  const lanes = (function f(c) { return c.items.some(i => i.type === 'lane' || (i.items && f(i))); })(model.root);
  if (HIER && zoneLinks && !lanes) return null;
  if (HIER && model.edges.some(e => {
    const inside = (id, F) => { const n = model.nodes.get(id) || model.frames.get(id); for (let p = n && n.parent; p; p = p.parent) if (p === F) return true; return false; };
    return (model.frames.has(e.a) && inside(e.b, model.frames.get(e.a))) || (model.frames.has(e.b) && inside(e.a, model.frames.get(e.b)));
  })) return null;
  const flowH = model.direction === 'RIGHT';
  // inside a lane (per-frame layout only) the flow runs along the lane: a row left to right, a column downwards
  const fhOf = it => HIER && it.parent && it.parent.type === 'lane' ? it.parent.axis === 'h' : flowH;
  const sidesFor = fh => ({ IN: fh ? 'WEST' : 'NORTH', OUT: fh ? 'EAST' : 'SOUTH', PIN: fh ? 'NORTH' : 'WEST', POUT: fh ? 'SOUTH' : 'EAST' });
  for (const n of model.nodes.values()) if (n.kind === 'junction') n.barV = model.direction === 'RIGHT';
  for (const n of model.nodes.values()) sizeNode(n, measure);
  for (const f of model.frames.values()) { f.textW = f.title ? measure(f.title, FONT_TITLE) : 0; f.titleW = f.textW + (f.logo && f.title && logoData(f.logo) ? 16 : 0); }

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

  // same-width / same-height on nodes: all as wide (or tall) as the widest; this runs before stacking, so
  // columns and rows are built from the equal sizes (a span node may still grow afterwards)
  const sameNodes = model.sameSize.filter(ss => ss.kind === 'node');
  const equalNodes = (onlyLoose) => {
    for (const ss of sameNodes) {
      const ns = ss.ids.map(id => model.nodes.get(id)).filter(n => !onlyLoose || !(n.parent && n.parent.type === 'group'));
      if (ns.length < 2) continue;
      const v = Math.max(...ns.map(n => n[ss.axis]));
      for (const n of ns) n[ss.axis] = v;
    }
  };
  equalNodes(false);

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
  model.alignLoose = [];
  const padded = new Set();
  for (const al of model.aligns) {
    const A = model.nodes.get(al.a), B = model.nodes.get(al.b);
    const ga = A && A.parent && A.parent.type === 'group' ? A.parent : null;
    const gb = B && B.parent && B.parent.type === 'group' ? B.parent : null;
    if (!ga || !gb) { model.alignLoose.push({ A, B }); continue; }
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

  equalNodes(true);

  // ---- ports where links leave a group
  const { IN, OUT } = sidesFor(flowH);
  const portBuckets = new Map();
  // links into one table row that look the same (style and the mark at that end) meet at one point with
  // one mark, as an ER diagram draws them; links that look different keep their own places on the row
  const looks = (e, end) => [e.dashed, (e.tags || []).filter(t => /^(ok|bad|muted)$/.test(t) || CARD_RE.test(t)).join(','), end === 's' ? e.start : e.end].join('|');
  const colLooks = new Map();
  for (const e of model.edges) for (const end of ['s', 't']) {
    const col = end === 's' ? e.aCol : e.bCol;
    if (col && !e.rail) {
      const key = `${end === 's' ? e.a : e.b}|${col}|${end}`;
      if (!colLooks.has(key)) colLooks.set(key, []);
      const L = colLooks.get(key), l = looks(e, end);
      if (!L.includes(l)) L.push(l);
    }
  }
  function addPort(e, end) {
    const id = end === 's' ? e.a : e.b;
    const g = groupOf(id);
    const sn = model.nodes.get(id);
    const colName = end === 's' ? e.aCol : e.bCol;
    if (!g && sn && sn.cols && colName) {
      // a link to a column leaves or enters the table level with that row
      const fh = fhOf(sn), { IN, OUT } = sidesFor(fh);
      const side = end === 's' ? OUT : IN;
      const i = sn.cols.findIndex(c => c.name === colName);
      const key = `${id}|${colName}|${end}`, L = colLooks.get(key) || [], cnt = L.length || 1, k = L.indexOf(looks(e, end));
      const spread = cnt > 1 ? (k - (cnt - 1) / 2) * Math.min(6, 14 / (cnt - 1)) : 0;
      const along = fh ? sn.headH + i * sn.rowH + sn.rowH / 2 + spread : sn.w / 2 + spread;
      const pid = `P${e.i}${end}`;
      const p = { id: pid, width: 0, height: 0, layoutOptions: { 'elk.port.side': side } };
      if (side === 'WEST') { p.x = 0; p.y = along; }
      if (side === 'EAST') { p.x = sn.w; p.y = along; }
      if (side === 'NORTH') { p.x = along; p.y = 0; }
      if (side === 'SOUTH') { p.x = along; p.y = sn.h; }
      sn.ports.push(p);
      return pid;
    }
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
    if (!g && sn && sn.kind === 'junction') {
      const { IN, OUT } = sidesFor(!!sn.barV);
      const pid = `P${e.i}${end}`;
      sn.ports.push({ id: pid, width: 0, height: 0, layoutOptions: { 'elk.port.side': end === 's' ? OUT : IN } });
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
        if (it.span || (it.cols && it.ports && it.ports.length)) { en.ports = it.ports; en.layoutOptions = { 'elk.portConstraints': 'FIXED_POS' }; }
        if (it.kind === 'junction' && it.ports.length) { en.ports = it.ports; en.layoutOptions = { 'elk.portConstraints': 'FIXED_SIDE', 'elk.spacing.portPort': '14' }; }
        if (markIsland(it)) en.layoutOptions = { ...(en.layoutOptions || {}), 'elk.layered.layering.layerConstraint': 'LAST' };
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
      // a tree (an org chart, a hierarchy) puts each parent centred on its children
      ...(isTree(model) ? { 'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF', 'elk.layered.nodePlacement.bk.fixedAlignment': 'BALANCED' } : { 'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX' }),
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
      const viaPts = st => { const O = abs.get((st.T.type === 'lane' ? 'L:' : 'F:') + st.T.id); return [{ x: O.x + st.via.corner.x, y: O.y + st.via.corner.y }, { x: O.x + st.via.border.x, y: O.y + st.via.border.y }]; };
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
  alignRows(rm, model, HIER);
  fitFrames(rm, model, flowH);
  sameSizeFrames(rm, model);
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
    // a link may end on a zone: its chain is the zone's own boxes, then the zone
    const chainEnd = id => model.nodes.has(id) ? chains.get(model.nodes.get(id)) : [...chainOf(model.frames.get(id)), model.frames.get(id)];
    // a zone end stands for the zone's box: its id and, once the zone is laid out, its size
    const zoneEnd = new Map();
    const endOf = id => {
      if (model.nodes.has(id)) return model.nodes.get(id);
      if (!zoneEnd.has(id)) { const F = model.frames.get(id); zoneEnd.set(id, { id, type: 'frame', zone: F, parent: F.parent, get w() { return lay.get(F).w; }, get h() { return lay.get(F).h; } }); }
      return zoneEnd.get(id);
    };
    for (const e of model.edges) {
      if (e.intra || e.rail) continue;
      const ca = chainEnd(e.a), cb = chainEnd(e.b);
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
      if (c === n || (n.zone && c === n.zone)) return { x: q.x, y: q.y };
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
      const mp = relPos(T, m), W = lay.get(T).w;
      let cx = mp.x + m.w / 2, cy = mp.y + m.h / 2;
      // a link to a table column has its place on the table: level with that row, on the side the port is on
      const colPort = m.cols && m.ports && m.ports.find(q => q.id === `P${e.i}${end}`);
      if (colPort) { if (dirH) cy = mp.y + colPort.y; else cx = mp.x + colPort.x; }
      const cross = dirH ? ['NORTH', 'SOUTH'] : ['WEST', 'EAST'];
      if ((dirH ? cy : cx) > (dirH ? lay.get(T).h : W) / 2) cross.reverse();
      const sides = colPort ? [end === 's' ? OUT_ : IN_] : [end === 's' ? OUT_ : IN_, ...cross];
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
      // first: out of the member's top or bottom (left or right in a flow down), along the zone's inner margin, and
      // out through the side facing the link, so what it reaches outside stays beside the zone, not above it
      if (!colPort) {
        const fm = (ma0 + ma1) / 2, exitA = end === 's' ? Wa : 0, side = end === 's' ? OUT_ : IN_;
        const memLo = dirH ? mp.y : mp.x, memHi = memLo + (dirH ? m.h : m.w);
        // (14px inside the border: closer, the link would read as running along it)
        for (const cm of (c0 < Ca / 2 ? [14, Ca - 14] : [Ca - 14, 14])) {
          if (cm > memLo - 6 && cm < memHi + 6) continue;
          const edgeC = cm < memLo ? memLo : memHi;
          const segA = dirH ? { x: fm - 5, y: Math.min(cm, edgeC), w: 10, h: Math.abs(edgeC - cm) } : { x: Math.min(cm, edgeC), y: fm - 5, w: Math.abs(edgeC - cm), h: 10 };
          const f0 = Math.min(fm, exitA), f1 = Math.max(fm, exitA);
          const segB = dirH ? { x: f0, y: cm - 5, w: f1 - f0, h: 10 } : { x: cm - 5, y: f0, w: 10, h: f1 - f0 };
          if (rects.some(r => hit(segA, r) || hit(segB, r))) continue;
          const rq = { T, e, end, m, side, mp, fixed: pt(exitA, cm), via: { corner: pt(fm, cm), border: pt(fm, edgeC) } };
          reqs.push(rq);
          return rq;
        }
      }
      // (out of a zone at the top level, only the margin on the side the link goes: the other sends it back against
      // the flow, out of a corner of the zone, and what it reaches is placed level with that corner)
      const margins = end === 's' ? (T.parent && T.parent.parent ? ['far', 'near'] : ['far']) : ['near', 'far'];
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
      // last resort: the side facing the link, even though a member is in the way; the router takes the link
      // round it afterwards, as it does any blocked link, instead of giving up on the rows and columns
      const rq = { T, e, end, m, side: sides[0], mp };
      reqs.push(rq);
      return rq;
    }
    async function layoutFrame(Fr) {
      const items = Fr ? Fr.items : model.root.items;
      const dirH = dirOf(Fr);
      const reqs = [];
      const edgeEnds = [];
      const zonePorts = [];     // ports where a link ends on a zone itself
      for (const e of byL.get(Fr || null) || []) {
        const ends = {};
        for (const end of ['s', 't']) {
          const T = end === 's' ? e.h.sa : e.h.sb;
          const m = endOf(end === 's' ? e.a : e.b);
          if (!T) { ends[end] = end === 's' ? e.srcBase : e.tgtBase; continue; }
          // the link ends on this zone itself: a port in the middle of its side facing the link
          if (m.zone === T) {
            const { IN: IN_, OUT: OUT_ } = sidesFor(dirH);
            const side = end === 's' ? OUT_ : IN_, L = lay.get(T);
            const pid = `P${e.i}${end}`;
            const p = { id: pid, width: 0, height: 0, layoutOptions: { 'elk.port.side': side } };
            if (side === 'WEST') { p.x = 0; p.y = L.h / 2; } else if (side === 'EAST') { p.x = L.w; p.y = L.h / 2; } else if (side === 'NORTH') { p.x = L.w / 2; p.y = 0; } else { p.x = L.w / 2; p.y = L.h; }
            zonePorts.push([T, p]);
            ends[end] = pid;
            continue;
          }
          const rq = portFor(T, e, end, m, reqs, dirH);
          if (!rq) { if (typeof process !== 'undefined' && process.env && process.env.TRACE_DEBUG) console.error('no port', e.a, '->', e.b, 'at', T.id); return null; }
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
      for (const [T, p] of zonePorts) { if (!eports.has(T)) eports.set(T, []); eports.get(T).push(p); }
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
          const sp = rq.m.ports && rq.m.ports.find(q => q.id === rq.pid);
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
          const fixed = it.span || (it.cols && it.ports && it.ports.length);
          const bar = it.kind === 'junction' && it.ports.length;
          en.layoutOptions = { ...part, ...(fixed ? { 'elk.portConstraints': 'FIXED_POS' } : {}), ...(bar ? { 'elk.portConstraints': 'FIXED_SIDE', 'elk.spacing.portPort': '14' } : {}), ...(markIsland(it) && !isLane ? { 'elk.layered.layering.layerConstraint': 'LAST' } : {}),
            ...(it.junction && !isLane ? { 'elk.layered.layering.layerConstraint': it.junction === 'last' ? 'LAST' : 'FIRST' } : {}) };
          if (fixed || bar) en.ports = it.ports;
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
      // (not the rows that side zones are built from: spanSides places those zones level with what they serve)
      // the main flow beside side zones lines its zones up only when they are written the same size (same-width
      // edge core access): otherwise each keeps the centring ELK gave it, as without side zones
      const sameSized = Fr && Fr.id === '_main' && model.sameSize.some(ss => ss.axis === (dirH ? 'h' : 'w') && r.children.filter(c => ss.ids.some(id => c.id === 'F:' + id)).length >= 2);
      if (isLane && (!/^_(side|fold|main)/.test(String(Fr.id)) || sameSized)) { if (dirH) alignRowTops(r, children); else alignColumnLefts(r, children); }
      else if (!isLane) { if (dirH) alignLayerLefts(r, children); else alignLayerTops(r, children); }
      const minW = Fr && !isLane ? Math.ceil(Fr.titleW + 36) : 0;
      const w = Math.max(r.width, minW), dx = (w - r.width) / 2;
      const pos = new Map(r.children.map(c => [c.id, { x: c.x + dx, y: c.y }]));
      lay.set(Fr || null, { res: r, w, h: r.height, dx, pos });
      return true;
    }
    // a row of zones shares its top: ELK's layered placement slides each one up or down to straighten links,
    // which leaves zones side by side at different heights. Every zone goes to the top of the row, and the
    // links between them are drawn again as plain orthogonal routes (the router later takes any blocked one round)
    function alignRowTops(r, children, framesOnly, only) {
      // zones only: a node in the row keeps the place ELK gave it, level with what it links to (in a column,
      // only frames: rows and columns stacked in a column keep their own centring)
      const zones = r.children.filter(c => (framesOnly ? /^F:/ : /^[FL]:/).test(c.id) && (!only || only.has(c.id)));
      if (zones.length < 2) return;
      const top = Math.min(...zones.map(c => c.y));
      const dy = new Map(r.children.map(c => [c.id, zones.includes(c) ? top - c.y : 0]));
      if ([...dy.values()].every(v => Math.abs(v) < 0.5)) return;
      const owner = new Map(), side = new Map();
      for (const c of children) { owner.set(c.id, c.id); for (const q of c.ports || []) { owner.set(q.id, c.id); side.set(q.id, (q.layoutOptions || {})['elk.port.side']); } }
      for (const c of r.children) c.y += dy.get(c.id);
      for (const ed of r.edges || []) {
        const secs = ed.sections || [];
        if (!secs.length) continue;
        const ds = dy.get(owner.get(ed.sources[0])) || 0, dt = dy.get(owner.get(ed.targets[0])) || 0;
        const a = { x: secs[0].startPoint.x, y: secs[0].startPoint.y + ds }, b = { x: secs[secs.length - 1].endPoint.x, y: secs[secs.length - 1].endPoint.y + dt };
        const hs = !/NORTH|SOUTH/.test(side.get(ed.sources[0]) || ''), ht = !/NORTH|SOUTH/.test(side.get(ed.targets[0]) || '');
        let mid;
        if (Math.abs(a.y - b.y) < 0.5 || Math.abs(a.x - b.x) < 0.5) mid = [];
        else if (hs && ht) {
          // a zone in between: out into the gap beside the source, over the row, down the gap beside the target
          const sc = r.children.find(c => c.id === owner.get(ed.sources[0])), tc = r.children.find(c => c.id === owner.get(ed.targets[0]));
          const lo = Math.min(a.x, b.x), hi = Math.max(a.x, b.x);
          const between = r.children.filter(c => c !== sc && c !== tc && c.x < hi && c.x + c.width > lo);
          if (sc && tc && between.length) {
            const gapBeside = (c, right) => {
              const edge = right ? c.x + c.width : c.x;
              const nb = r.children.filter(o => o !== c && (right ? o.x >= edge - 0.5 : o.x + o.width <= edge + 0.5));
              const near = right ? Math.min(...nb.map(o => o.x)) : Math.max(...nb.map(o => o.x + o.width));
              return (edge + near) / 2;
            };
            const fwd = b.x > a.x, gy = top - 14;
            const g1 = gapBeside(sc, fwd), g2 = gapBeside(tc, !fwd);
            mid = [{ x: g1, y: a.y }, { x: g1, y: gy }, { x: g2, y: gy }, { x: g2, y: b.y }];
          } else { const mx = (a.x + b.x) / 2; mid = [{ x: mx, y: a.y }, { x: mx, y: b.y }]; }
        }
        else if (hs) mid = [{ x: b.x, y: a.y }];
        else if (ht) mid = [{ x: a.x, y: b.y }];
        else { const my = (a.y + b.y) / 2; mid = [{ x: a.x, y: my }, { x: b.x, y: my }]; }
        ed.sections = [{ ...secs[0], startPoint: a, endPoint: b, bendPoints: mid }];
        for (const l of ed.labels || []) l.y += (ds + dt) / 2;
      }
      // the row is as tall as what it holds now: its children and the routes between them
      const ys = r.children.map(c => c.y + c.height);
      for (const ed of r.edges || []) for (const sc of ed.sections || []) ys.push(sc.startPoint.y, sc.endPoint.y, ...(sc.bendPoints || []).map(q => q.y));
      r.height = Math.max(...ys);
    }
    // a column of zones shares its left edge: the same as a row, on a mirrored copy (x and y swapped)
    // Zones that ELK put side by side in one layer of a zone (or of the drawing) share their top, as in a written
    // row: groups of zones whose spans along the flow overlap. A zone moves only if it then touches nothing.
    function alignLayerTops(r, children) {
      const zs = r.children.filter(c => /^F:/.test(c.id)).sort((a, b) => a.y - b.y);
      const groups = [];
      for (const z of zs) { const g = groups.find(g => g.some(o => z.y < o.y + o.height && o.y < z.y + z.height)); if (g) g.push(z); else groups.push([z]); }
      for (const g of groups) {
        if (g.length < 2) continue;
        const top = Math.min(...g.map(c => c.y));
        // the room a zone moves through (from its place up to the common top) must be empty
        const ok = new Set(g.filter(z => z.y - top < 0.5 || !r.children.some(o => o !== z && o.x < z.x + z.width + 10 && z.x - 10 < o.x + o.width && o.y < z.y && o.y + o.height > top - 10)).map(z => z.id));
        if (ok.size >= 2) alignRowTops(r, children, true, ok);
      }
    }
    function alignLayerLefts(r, children) { mirrored(r, children, () => alignLayerTops(r, children)); }
    function mirrored(r, children, fn) {
      const SW = { NORTH: 'WEST', WEST: 'NORTH', SOUTH: 'EAST', EAST: 'SOUTH' };
      const flip = q => { if (!q) return; const { x, y } = q; q.x = y; q.y = x; };
      const flipBox = b => { flip(b); if (b.width !== undefined) { const w = b.width; b.width = b.height; b.height = w; } };
      const flipAll = () => {
        for (const c of r.children) flipBox(c);
        for (const ed of r.edges || []) { for (const sc of ed.sections || []) { flip(sc.startPoint); flip(sc.endPoint); (sc.bendPoints || []).forEach(flip); } (ed.labels || []).forEach(flipBox); }
        const w = r.width; r.width = r.height; r.height = w;
      };
      const sides = children.map(c => (c.ports || []).map(q => { const o = q.layoutOptions || {}; const was = o['elk.port.side']; if (was) o['elk.port.side'] = SW[was]; return [o, was]; }));
      flipAll();
      fn();
      flipAll();
      for (const list of sides) for (const [o, was] of list) if (was) o['elk.port.side'] = was;
    }
    function alignColumnLefts(r, children) {
      const SW = { NORTH: 'WEST', WEST: 'NORTH', SOUTH: 'EAST', EAST: 'SOUTH' };
      const flip = q => { if (!q) return; const { x, y } = q; q.x = y; q.y = x; };
      const flipBox = b => { flip(b); if (b.width !== undefined) { const w = b.width; b.width = b.height; b.height = w; } };
      const flipAll = () => {
        for (const c of r.children) flipBox(c);
        for (const ed of r.edges || []) { for (const sc of ed.sections || []) { flip(sc.startPoint); flip(sc.endPoint); (sc.bendPoints || []).forEach(flip); } (ed.labels || []).forEach(flipBox); }
        const w = r.width; r.width = r.height; r.height = w;
      };
      const sides = children.map(c => (c.ports || []).map(q => { const o = q.layoutOptions || {}; const was = o['elk.port.side']; if (was) o['elk.port.side'] = SW[was]; return [o, was]; }));
      flipAll();
      alignRowTops(r, children, true);
      flipAll();
      for (const list of sides) for (const [o, was] of list) if (was) o['elk.port.side'] = was;
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
    let n = st.node;
    if (n.zone) { const a = abs.get('F:' + n.zone.id); n = { x: a.x, y: a.y, w: a.w, h: a.h }; }
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
// a marked node whose links are all drawn as marks has nothing left to place it: it goes at the end of the
// flow (a shared library after what uses it), not among the first nodes
function markIsland(n) { return !!(n.markTarget && n.markTarget.links && !n.markTarget.rest); }
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
function alignRows(rm, model, HIER) {
  const within = (a, b) => { for (let q = a; q; q = q.parent) if (q === b) return true; return false; };
  // Slide a region along X by dd: its nodes, the stacks in it, the frames in it; the links with a point in its
  // box move with it and get a small step where they enter it. Refused (false) when the moved box would touch
  // a node outside it, or a link that does not touch it would cross it.
  function slide(inRegion, box, X, Y, dd, stacks, frames) {
    const moved = { ...box, [X]: box[X] + dd };
    const hits = [...model.nodes.values()].some(o => o.x !== undefined && !inRegion(o) &&
      o.x < moved.x + moved.w && moved.x < o.x + o.w && o.y < moved.y + moved.h && moved.y < o.y + o.h);
    if (hits) return false;
    const inside = q => q.x >= box.x - 0.5 && q.x <= box.x + box.w + 0.5 && q.y >= box.y - 0.5 && q.y <= box.y + box.h + 0.5;
    const cuts = rm.edges.some(r => {
      if (r.pts.some(inside)) return false;
      for (let i = 1; i < r.pts.length; i++) {
        const q = r.pts[i - 1], w = r.pts[i];
        const x1 = Math.min(q.x, w.x), x2 = Math.max(q.x, w.x), y1 = Math.min(q.y, w.y), y2 = Math.max(q.y, w.y);
        if (x1 < moved.x + moved.w && moved.x < x2 + 0.01 && y1 < moved.y + moved.h && moved.y < y2 + 0.01) return true;
      }
      return false;
    });
    if (cuts) return false;
    for (const o of model.nodes.values()) if (o.x !== undefined && inRegion(o)) o[X] += dd;
    for (const g of stacks) g[X] += dd;
    for (const f of frames) f[X] += dd;
    for (const r of rm.edges) {
      // a link with both ends in the region moves whole; one that leaves it gets a step where it does
      const na = model.nodes.get(r.e.a), nb = model.nodes.get(r.e.b);
      const whole = na && nb && na.x !== undefined && nb.x !== undefined && inRegion(na) && inRegion(nb);
      const flags = whole ? r.pts.map(() => true) : r.pts.map(inside);
      if (!flags.some(Boolean)) continue;
      const out = [];
      r.pts.forEach((q, i) => {
        const n = { ...q };
        if (flags[i]) n[X] += dd;
        if (i > 0 && flags[i] !== flags[i - 1]) {
          const prev = out[out.length - 1];
          if (Math.abs(prev[X] - n[X]) > 0.5 && Math.abs(r.pts[i - 1][X] - q[X]) < 0.5) {
            const m = (prev[Y] + n[Y]) / 2;
            out.push({ [X]: prev[X], [Y]: m }, { [X]: n[X], [Y]: m });
          }
        }
        out.push(n);
      });
      r.pts = out;
      if (r.lab && (whole || inside({ x: r.lab.x, y: r.lab.y }))) r.lab[X] += dd;
    }
    return true;
  }
  // the link between two nodes that are now level: one straight line from the near side of one to the other
  function straighten(A, B, X, Y, W, L) {
    const r = rm.edges.find(o => (o.e.a === A.id && o.e.b === B.id) || (o.e.a === B.id && o.e.b === A.id));
    if (!r) return;
    const lo = A[Y] + A[L] <= B[Y] ? [A, B] : B[Y] + B[L] <= A[Y] ? [B, A] : null;
    if (!lo) return;
    const [first, second] = lo;
    const c = A[X] + A[W] / 2, a0 = first[Y] + first[L], a1 = second[Y];
    const line = [{ [X]: c, [Y]: a0 }, { [X]: c, [Y]: a1 }].map(q => ({ x: Y === 'x' ? q[Y] : q[X], y: Y === 'x' ? q[X] : q[Y] }));
    const blocked = [...model.nodes.values()].some(o => o !== A && o !== B && o.x !== undefined &&
      o[X] < c + 1 && c - 1 < o[X] + o[W] && o[Y] < a1 && a0 < o[Y] + o[L]);
    if (blocked) return;
    r.pts = r.e.a === first.id ? line : line.reverse();
    if (r.lab) { r.lab = { ...r.lab, anchor: 'middle', x: (a0 + a1) / 2, y: c - 6 - (r.e.lab ? r.e.lab.h : 0) }; }
  }

  // pairs inside two stacks (the stacks were padded; slide one the last bit)
  for (const al of model.alignPairs || []) {
    const { A, B, ga, gb, vert } = al;
    if (A.x === undefined || B.x === undefined) continue;
    const X = vert ? 'y' : 'x', Y = vert ? 'x' : 'y', W = vert ? 'h' : 'w', L = vert ? 'w' : 'h';
    const d = (A[X] + A[W] / 2) - (B[X] + B[W] / 2);
    if (Math.abs(d) >= 0.5) {
      let done = false;
      for (const [g, dd] of [[gb, d], [ga, -d]]) {
        if (slide(it => it.parent === g, { x: g.x, y: g.y, w: g.w, h: g.h }, X, Y, dd, [g], [])) { done = true; break; }
      }
      if (!done) { (model.alignNotes = model.alignNotes || []).push(`align ${A.id} ${B.id}: they could not be brought level without touching another node or link, so they are left as laid out`); continue; }
    }
    straighten(A, B, X, Y, W, L);
  }

  // pairs of single nodes, or nodes in zones: the node, or the outermost zone round it that does not hold the
  // other one, slides (with everything in it) until the two nodes are level
  for (const al of model.alignLoose || []) {
    const { A, B } = al;
    if (A.x === undefined || B.x === undefined) continue;
    const dx = Math.abs((A.x + A.w / 2) - (B.x + B.w / 2)), dy = Math.abs((A.y + A.h / 2) - (B.y + B.h / 2));
    const vert = dx >= dy;       // side by side: level means the same y
    const X = vert ? 'y' : 'x', Y = vert ? 'x' : 'y', W = vert ? 'h' : 'w', L = vert ? 'w' : 'h';
    const d = (A[X] + A[W] / 2) - (B[X] + B[W] / 2);
    if (Math.abs(d) >= 0.5) {
      const regionOf = (n, other) => {
        let frame = null;
        for (let q = n.parent; q; q = q.parent) if (q.type === 'frame') { if (within(other, q)) break; frame = q; }
        return frame;
      };
      const tries = [[B, A, d], [A, B, -d]].map(([n, other, dd]) => ({ n, F: regionOf(n, other), dd }));
      // the smaller region first: a single node before a zone
      tries.sort((p, q) => (p.F ? 1 : 0) - (q.F ? 1 : 0));
      // a zone slides with the nodes that hang from it alone (every link of theirs goes into it, as a browser
      // under its server), when there is room for them too; else on its own
      const hangers = F => [...model.nodes.values()].filter(o => o.x !== undefined && !within(o, F) && o !== A && o !== B && (() => {
        const es = model.edges.filter(e => e.a === o.id || e.b === o.id);
        return es.length && es.every(e => { const t = model.nodes.get(e.a === o.id ? e.b : e.a); return t && within(t, F); });
      })());
      let done = false;
      for (const { n, F, dd } of tries) for (const extra of F ? [hangers(F), []] : [[]]) {
        if (done) break;
        const inZone = F ? [...model.nodes.values()].filter(o => o.x !== undefined && within(o, F)) : [n];
        const members = [...inZone, ...extra];
        const pad = F ? 20 : 0;
        const x1 = Math.min(...members.map(o => o.x)) - pad, y1 = Math.min(...members.map(o => o.y)) - (F ? 36 : 0);
        const x2 = Math.max(...members.map(o => o.x + o.w)) + pad, y2 = Math.max(...members.map(o => o.y + o.h)) + pad;
        const box = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
        const stacks = model.groups.filter(g => g.x !== undefined && g.items.length && members.includes(g.items[0]));
        const frames = rm.frames.filter(f => F && within(f.f, F));
        if (slide(F ? (o => within(o, F) || extra.includes(o)) : (o => o === n), box, X, Y, dd, stacks, frames)) done = true;
      }
      if (!done) { (model.alignNotes = model.alignNotes || []).push(`align ${A.id} ${B.id}: they could not be brought level without touching another node or link, so they are left as laid out`); continue; }
    }
    straighten(A, B, X, Y, W, L);
  }

  // Zones side by side in one layer share their top (their left edge in a flow to the right) in the layouts that are
  // not per zone: a zone that starts later than a neighbour slides back, with everything in it, when the room is
  // free. (The per-zone layout does this as it goes, on the zones themselves; side zones keep their place.)
  if (!HIER) {
    const flowH = model.direction === 'RIGHT';
    const X = flowH ? 'x' : 'y', Y = flowH ? 'y' : 'x', W = flowH ? 'w' : 'h', L = flowH ? 'h' : 'w';
    const boxOf = F => {
      const ms = [...model.nodes.values()].filter(o => o.x !== undefined && within(o, F));
      if (!ms.length) return null;
      const x1 = Math.min(...ms.map(o => o.x)), y1 = Math.min(...ms.map(o => o.y)), x2 = Math.max(...ms.map(o => o.x + o.w)), y2 = Math.max(...ms.map(o => o.y + o.h));
      return { F, ms, x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
    };
    const byParent = new Map();
    for (const F of model.frames.values()) {
      if (F.side || F.id.startsWith('_')) continue;
      const b = boxOf(F);
      if (!b) continue;
      if (!byParent.has(F.parent)) byParent.set(F.parent, []);
      byParent.get(F.parent).push(b);
    }
    for (const list of byParent.values()) {
      if (list.length < 2) continue;
      // groups: zones whose spans along the flow overlap (as drawn: the title band before the contents, a margin
      // after) and that stand apart across it
      const groups = [];
      for (const b of [...list].sort((p, q) => p[X] - q[X])) {
        const g = groups.find(g => g.some(o => b[X] - 34 < o[X] + o[W] + 8 && o[X] - 34 < b[X] + b[W] + 8 && (b[Y] + b[L] <= o[Y] || o[Y] + o[L] <= b[Y])));
        if (g) g.push(b); else groups.push([b]);
      }
      for (const g of groups) {
        if (g.length < 2) continue;
        const top = Math.min(...g.map(b => b[X]));
        for (const b of g) {
          const dd = top - b[X];
          if (Math.abs(dd) < 0.5) continue;
          // the zone as drawn: its title above the contents (to the left when the flow runs right), a margin round them
          const pad = 8, box = { x: b.x - (flowH ? 34 : pad), y: b.y - (flowH ? pad : 34), w: b.w + pad + (flowH ? 34 : pad), h: b.h + pad + (flowH ? pad : 34) };
          const stacks = model.groups.filter(s2 => s2.x !== undefined && s2.items.length && b.ms.includes(s2.items[0]));
          const frames = rm.frames.filter(f => within(f.f, b.F));
          // kept only if it adds no crossing
          const crossings = () => { let k = 0; const E = rm.edges.filter(r => r.pts); for (let i = 0; i < E.length; i++) for (let j = i + 1; j < E.length; j++) for (let a = 1; a < E[i].pts.length; a++) for (let c = 1; c < E[j].pts.length; c++) if (crossSeg(E[i].pts[a - 1], E[i].pts[a], E[j].pts[c - 1], E[j].pts[c])) k++; return k; };
          const before = crossings();
          const snap = { nodes: b.ms.map(o => [o, o.x, o.y]), stacks: stacks.map(o => [o, o.x, o.y]), frames: frames.map(o => [o, o.x, o.y]), links: rm.edges.map(r => [r, r.pts, r.lab && { ...r.lab }]) };
          if (slide(o => within(o, b.F), box, X, Y, dd, stacks, frames) && crossings() > before) {
            for (const [o, x, y] of [...snap.nodes, ...snap.stacks, ...snap.frames]) { o.x = x; o.y = y; }
            for (const [r, pts, lab] of snap.links) { r.pts = pts; if (lab) r.lab = lab; }
          }
        }
      }
    }
  }
}

// same-width / same-height on frames: a frame takes its size from its contents, so the narrower ones are
// grown to the size of the widest afterwards, around their centre when that is free, else to the side
// that is, keeping a gap of 10px from other frames. A frame that cannot grow without covering another frame or node stays as it is, and says so.
function sameSizeFrames(rm, model) {
  for (const ss of model.sameSize) {
    if (ss.kind !== 'frame') continue;
    const A = ss.axis === 'w' ? 'x' : 'y', S = ss.axis;
    const boxes = ss.ids.map(id => rm.frames.find(f => f.f.id === id)).filter(Boolean);
    if (boxes.length < 2) continue;
    const target = Math.max(...boxes.map(b => b[S]));
    const within = (a, b) => { for (let p = a; p; p = p.parent) if (p === b) return true; return false; };
    const owns = (fr, n) => within(n.parent, fr);
    const free0 = (b, pos) => {
      const c = { ...b, [A]: pos, [S]: target };
      const hit = (u, v) => u.x < v.x + v.w - 1 && v.x < u.x + u.w - 1 && u.y < v.y + v.h - 1 && v.y < u.y + u.h - 1;
      const gap = 10, cg = { x: c.x - gap, y: c.y - gap, w: c.w + 2 * gap, h: c.h + 2 * gap };
      if (rm.frames.some(o => o !== b && !boxes.includes(o) && !within(o.f, b.f) && !within(b.f, o.f) && hit(cg, o))) return false;
      if (rm.frames.some(o => o !== b && !boxes.includes(o) && !within(o.f, b.f) && !within(b.f, o.f) && hit(c, o))) return false;
      if (rm.nodes.some(n => n.x !== undefined && !owns(b.f, n) && !(n.tags && n.tags.includes('bridge')) && hit(c, n))) return false;
      return true;
    };
    // one common box that holds every frame as it is, so the edges line up as well as the sizes: from the
    // widest frame's edge when the others fit in it
    const lmin = Math.max(...boxes.map(b => b[A] + b[S])) - target, lmax = Math.min(...boxes.map(b => b[A]));
    if (lmin <= lmax + 0.5) {
      const widest = boxes.reduce((m, b) => b[S] > m[S] ? b : m, boxes[0]);
      const L = Math.min(lmax, Math.max(lmin, widest[A]));
      if (boxes.every(b => free0(b, L))) { for (const b of boxes) { b[A] = L; b[S] = target; } continue; }
    }
    for (const b of boxes) {
      const d = target - b[S];
      if (d < 0.5) continue;
      const free = pos => {
        const c = { ...b, [A]: pos, [S]: target };
        const hit = (u, v) => u.x < v.x + v.w - 1 && v.x < u.x + u.w - 1 && u.y < v.y + v.h - 1 && v.y < u.y + u.h - 1;
        // and keeps a gap from every other frame: a border touching another one reads as one zone
        const gap = 10, cg = { x: c.x - gap, y: c.y - gap, w: c.w + 2 * gap, h: c.h + 2 * gap };
        if (rm.frames.some(o => o !== b && !within(o.f, b.f) && !within(b.f, o.f) && hit(cg, o))) return false;
        if (rm.nodes.some(n => n.x !== undefined && !owns(b.f, n) && !(n.tags && n.tags.includes('bridge')) && hit(c, n))) return false;
        return true;
      };
      // and stays inside the zones round it, and on the page
      const inside = pos => { const c = { ...b, [A]: pos, [S]: target }; return c.x >= 8 && c.y >= 0 && rm.frames.every(o => !within(b.f, o.f) || o === b || (c.x >= o.x + 10 && c.y >= o.y + 10 && c.x + c.w <= o.x + o.w - 10 && c.y + c.h <= o.y + o.h - 10)); };
      const pos = [b[A] - d / 2, b[A], b[A] - d].find(p => free(p) && inside(p));
      if (pos === undefined) { (rm.notes = rm.notes || []).push(`same-${ss.axis === 'w' ? 'width' : 'height'}: the frame "${b.f.id}" cannot grow to match without covering something, so it keeps its size`); continue; }
      b[A] = pos; b[S] = target;
    }
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
    for (const r of rm.rails) { r.x += dx; r.y += dy; r.bus.forEach(q => { q.x += dx; q.y += dy; }); r.dots.forEach(q => { q.x += dx; q.y += dy; }); }
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
    // beside the diagram the labels of the links sit between its last border and the bus, so that gap grows
    // with the widest label
    const labW = Math.max(0, ...links.map(e => e.lab ? e.lab.w : 0));
    const gap = horiz ? GAP : Math.max(GAP, labW + 18 - 22);
    const L = Math.max(horiz ? x2 - x1 : y2 - y1, need);
    let band;
    if (side === 'bottom') band = { x: x1, y: y2 + gap, w: L, h: T };
    else if (side === 'right') band = { x: x2 + gap, y: y1, w: T, h: L };
    else if (side === 'top') { shiftAll(0, T + gap); band = { x: x1, y: y1, w: L, h: T }; }
    else { shiftAll(T + gap, 0); band = { x: x1, y: y1, w: T, h: L }; }
    const diagram = { x: horiz ? band.x : band.x, y: band.y };
    // the bus: along the side of the band that faces the diagram
    const busAt = side === 'bottom' ? band.y + 22 : side === 'top' ? band.y + band.h - 22 : side === 'right' ? band.x + 22 : band.x + band.w - 22;
    const R = { rail, side, horiz, x: band.x, y: band.y, w: band.w, h: band.h, bus: [], dots: [] };
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
      let c = (horiz ? o.x + o.w / 2 : o.y + o.h / 2) + (used ? (used % 2 ? 1 : -1) * 8 * Math.ceil(used / 2) : 0);
      // a node on the border between two frames (a bridge) would send its tap along that border: take the
      // tap off the middle, towards whichever side of the node is clear of every border
      const nearBorder = v => rm.frames.some(f => horiz
        ? (Math.abs(v - f.x) < 7 || Math.abs(v - f.x - f.w) < 7) && o.y < f.y + f.h && f.y < o.y + o.h + 200
        : (Math.abs(v - f.y) < 7 || Math.abs(v - f.y - f.h) < 7) && o.x < f.x + f.w && f.x < o.x + o.w + 200);
      if (nearBorder(c)) {
        // the place on the node farthest from every border (6px in from its edge at most)
        const lo = (horiz ? o.x : o.y) + 6, hi = (horiz ? o.x + o.w : o.y + o.h) - 6, span = hi - lo;
        const dist = v => Math.min(Infinity, ...rm.frames.flatMap(f => horiz ? [Math.abs(v - f.x), Math.abs(v - f.x - f.w)] : [Math.abs(v - f.y), Math.abs(v - f.y - f.h)]));
        const options = [lo, hi, c - span / 3, c + span / 3, c - span / 4, c + span / 4].filter(v => v >= lo && v <= hi && !nearBorder(v));
        if (options.length) c = options.reduce((best, v) => dist(v) > dist(best) ? v : best);
      }
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
    // a dot where a tap meets the bus, when two or more do, so the junction reads as a junction
    if (taps.length > 1) for (const t of taps) R.dots.push(t.e.railFrom ? t.pts[0] : t.pts[1]);
    for (const t of taps) {
      // the link's own look (dashes, colour, label), with the arrow where the link points
      const syn = { ...t.e, start: false, end: t.e.railFrom ? t.e.end : false };
      let lab = null;
      if (t.e.lab) {
        if (horiz) lab = { x: t.c + 6, y: (t.pts[0].y + t.pts[1].y) / 2 - t.e.lab.h / 2, anchor: 'start' };
        else {
          // between the border of the last frame the link crosses and the bus, where no zone title is
          const x0 = Math.min(t.pts[0].x, t.pts[1].x), x1 = Math.max(t.pts[0].x, t.pts[1].x);
          const past = Math.max(x0, ...rm.frames.filter(f => f.y < t.c && t.c < f.y + f.h && f.x + f.w > x0 && f.x < x1).map(f => f.x + f.w));
          const room = x1 - past;
          lab = room >= t.e.lab.w + 8 ? { x: (past + x1) / 2, y: t.c - 6 - t.e.lab.h, anchor: 'middle' } : { x: (x0 + x1) / 2, y: t.c - 6 - t.e.lab.h, anchor: 'middle' };
        }
      }
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
// Do two orthogonal stretches lie on top of each other (closer than 4px, sharing more than 6px)?
function overlapSeg(a, b, c, d, near = 4) {
  const h1 = Math.abs(a.y - b.y) < 0.5, h2 = Math.abs(c.y - d.y) < 0.5, v1 = Math.abs(a.x - b.x) < 0.5, v2 = Math.abs(c.x - d.x) < 0.5;
  if (h1 && h2) return Math.abs(a.y - c.y) < near && Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) > 6;
  if (v1 && v2) return Math.abs(a.x - c.x) < near && Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) > 6;
  return false;
}
// How many times a path crosses other links (proper crossings of orthogonal stretches).
function crossSeg(a, b, c, d) {
  const h1 = Math.abs(a.y - b.y) < 0.5, h2 = Math.abs(c.y - d.y) < 0.5;
  if (h1 === h2) return false;
  const [H0, H1, V0, V1] = h1 ? [a, b, c, d] : [c, d, a, b];
  return Math.min(H0.x, H1.x) + 0.5 < V0.x && V0.x < Math.max(H0.x, H1.x) - 0.5 && Math.min(V0.y, V1.y) + 0.5 < H0.y && H0.y < Math.max(V0.y, V1.y) - 0.5;
}
function crossingsWith(rm, path, self) {
  let n = 0;
  for (const o of rm.edges) {
    if (o === self || !o.pts || o.e.rail || o.e.lifeline || o.e.divider) continue;
    const share = o.e.a === self.e.a || o.e.a === self.e.b || o.e.b === self.e.a || o.e.b === self.e.b;
    if (share) continue;
    for (let i = 1; i < path.length; i++) for (let j = 1; j < o.pts.length; j++) if (crossSeg(path[i - 1], path[i], o.pts[j - 1], o.pts[j])) n++;
  }
  return n;
}
function overlapsLinks(rm, path, skip, near = 4) {
  for (const o of rm.edges) {
    if (skip.has(o) || !o.pts || o.e.rail || o.e.lifeline || o.e.divider) continue;
    for (let i = 1; i < path.length; i++) for (let j = 1; j < o.pts.length; j++) if (overlapSeg(path[i - 1], path[i], o.pts[j - 1], o.pts[j], near)) return true;
  }
  return false;
}

function simplifyPts(pts) {
  const o = [{ ...pts[0] }];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = o[o.length - 1], b = pts[i], c = pts[i + 1];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 0.5) continue;
    if ((Math.abs(a.x - b.x) < 0.5 && Math.abs(b.x - c.x) < 0.5) || (Math.abs(a.y - b.y) < 0.5 && Math.abs(b.y - c.y) < 0.5)) continue;
    o.push({ ...b });
  }
  o.push({ ...pts[pts.length - 1] });
  return o;
}
function alignJogs(rm) {
  const simp = simplifyPts;
  const eq = (a, b) => Math.abs(a - b) < 0.5;
  // single-step links: kind 'v' (vertical, horizontal, vertical: the step has a y) or 'h' (the step has an x)
  const zs = [];
  for (const r of rm.edges) {
    if (!r.pts || r.pts.length < 2 || r.e.a === r.e.b) continue;
    const q = simp(r.pts);
    if (q.length !== 4) continue;
    // the ends must face each other: a link that enters its target from the far side would cut through it
    let sb = rm.nodes.find(n => n.id === r.e.a), tb = rm.nodes.find(n => n.id === r.e.b);
    // the points may run either way round (a link written with <-): take the node nearer the first point as its start
    const dd = (n, p) => n && n.x !== undefined ? Math.hypot(Math.max(n.x - p.x, 0, p.x - n.x - n.w), Math.max(n.y - p.y, 0, p.y - n.y - n.h)) : Infinity;
    if (dd(tb, q[0]) < dd(sb, q[0])) [sb, tb] = [tb, sb];
    const facing = (kind) => !sb || !tb || sb.x === undefined || tb.x === undefined || (kind === 'v'
      ? Math.abs(q[0].y - (sb.y + sb.h)) < 2 && Math.abs(q[3].y - tb.y) < 2
      : Math.abs(q[0].x - (sb.x + sb.w)) < 2 && Math.abs(q[3].x - tb.x) < 2);
    if (eq(q[0].x, q[1].x) && eq(q[1].y, q[2].y) && eq(q[2].x, q[3].x) && q[0].y < q[3].y && facing('v')) zs.push({ r, q, kind: 'v', lo: q[0].y, hi: q[3].y });
    else if (eq(q[0].y, q[1].y) && eq(q[1].x, q[2].x) && eq(q[2].y, q[3].y) && q[0].x < q[3].x && facing('h')) zs.push({ r, q, kind: 'h', lo: q[0].x, hi: q[3].x });
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
    let fresh = list.filter(z => !used.has(z)), c, ok = false;
    // the group's links that cannot reach the shared step (a node in the way) leave the group, and the step is
    // placed again for the others
    const kind = list[0].kind;
    for (let attempt = 0; attempt < 4 && fresh.length && !ok; attempt++) {
      // the gap every link in the group can put its step in
      const lo = Math.max(...fresh.map(z => z.lo)) + 10, hi = Math.min(...fresh.map(z => z.hi)) - 10;
      if (lo > hi) break;
      // the middle of the gap, unless a frame border is there: then the place in the gap farthest from borders
      const borderGap = v => Math.min(Infinity, ...rm.frames.filter(f => fresh.some(z => kind === 'v'
        ? Math.min(z.q[0].x, z.q[3].x) < f.x + f.w && f.x < Math.max(z.q[0].x, z.q[3].x)
        : Math.min(z.q[0].y, z.q[3].y) < f.y + f.h && f.y < Math.max(z.q[0].y, z.q[3].y)))
        .flatMap(f => kind === 'v' ? [Math.abs(v - f.y), Math.abs(v - f.y - f.h)] : [Math.abs(v - f.x), Math.abs(v - f.x - f.w)]));
      c = (lo + hi) / 2;
      if (borderGap(c) < 10) {
        let best = c, gap = borderGap(c);
        for (let i = 0; i <= 12; i++) { const v = lo + (hi - lo) * i / 12, g = borderGap(v); if (g > gap + 0.5 || (Math.abs(g - gap) <= 0.5 && Math.abs(v - (lo + hi) / 2) < Math.abs(best - (lo + hi) / 2))) { best = v; gap = g; } }
        c = best;
      }
      // the new steps must clear every node and not run along another link
      const steps = fresh.map(z => kind === 'v'
        ? { x1: Math.min(z.q[0].x, z.q[3].x), x2: Math.max(z.q[0].x, z.q[3].x), y1: c, y2: c }
        : { x1: c, x2: c, y1: Math.min(z.q[0].y, z.q[3].y), y2: Math.max(z.q[0].y, z.q[3].y) });
      // and so must the stretches on either side, which grow or shrink to meet the new step (a link's own ends aside)
      const legs = fresh.flatMap(z => kind === 'v'
        ? [{ z, x1: z.q[0].x, x2: z.q[0].x, y1: Math.min(z.q[0].y, c), y2: Math.max(z.q[0].y, c) }, { z, x1: z.q[3].x, x2: z.q[3].x, y1: Math.min(z.q[3].y, c), y2: Math.max(z.q[3].y, c) }]
        : [{ z, x1: Math.min(z.q[0].x, c), x2: Math.max(z.q[0].x, c), y1: z.q[0].y, y2: z.q[0].y }, { z, x1: Math.min(z.q[3].x, c), x2: Math.max(z.q[3].x, c), y1: z.q[3].y, y2: z.q[3].y }]);
      // (the node a stretch starts on is its own: a link to a table row names the row, so it is found by place)
      const onIt = (n, z) => [z.q[0], z.q[3]].some(p => p.x >= n.x - 2 && p.x <= n.x + n.w + 2 && p.y >= n.y - 2 && p.y <= n.y + n.h + 2);
      const stepHits = st => rm.nodes.some(n => n.x !== undefined && st.x1 < n.x + n.w && n.x < st.x2 && st.y1 < n.y + n.h && n.y < st.y2);
      const blockedZ = new Set([...legs.filter(st => rm.nodes.some(n => n.x !== undefined && !onIt(n, st.z) && st.x1 < n.x + n.w && n.x < st.x2 + 0.01 && st.y1 < n.y + n.h && n.y < st.y2 + 0.01)).map(st => st.z),
        ...fresh.filter((z, k) => stepHits(steps[k]))]);
      if (blockedZ.size) { fresh = fresh.filter(z => !blockedZ.has(z)); continue; }
      const along = steps.some(st => rm.edges.some(o => {
        if (fresh.some(z => z.r === o) || !o.pts) return false;
        for (let i = 1; i < o.pts.length; i++) {
          const a = o.pts[i - 1], b = o.pts[i];
          if (kind === 'v' && eq(a.y, b.y) && Math.abs(a.y - c) < 3 && Math.min(a.x, b.x) < st.x2 && st.x1 < Math.max(a.x, b.x)) return true;
          if (kind === 'h' && eq(a.x, b.x) && Math.abs(a.x - c) < 3 && Math.min(a.y, b.y) < st.y2 && st.y1 < Math.max(a.y, b.y)) return true;
        }
        return false;
      }));
      if (along) break;
      ok = true;
    }
    if (!ok) continue;
    for (const z of fresh) {
      const [p0, , , p3] = z.q;
      const old = z.q[1][kind === 'v' ? 'y' : 'x'];
      z.r.pts = kind === 'v' ? [p0, { x: p0.x, y: c }, { x: p3.x, y: c }, p3] : [p0, { x: c, y: p0.y }, { x: c, y: p3.y }, p3];
      // a label that sat on the old step moves with it, and sits beside the new one (above a horizontal step,
      // to the right of a vertical one), never on the line
      const lab = z.r.lab, eh = z.r.e.lab ? z.r.e.lab.h : 14;
      if (lab && Math.abs((kind === 'v' ? lab.y : lab.x) - old) < 40) {
        if (kind === 'v') { lab.x = (p0.x + p3.x) / 2; lab.anchor = 'middle'; lab.y = c - 4 - eh; }
        else { lab.x = c + 6; lab.anchor = 'start'; lab.y = (p0.y + p3.y) / 2 - eh / 2; }
      }
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
    if (nw < minW) { fr.widen = { cx1: nx, cx2: nx + nw, minW, ex: fr.x, ew: fr.w }; nx -= (minW - nw) / 2; nw = minW; }
    Object.assign(fr, { x: nx, y: y1 - top, w: nw, h: y2 - y1 + top + PAD });
  }
  // a frame widened to fit its title grows away from its neighbours
  const hit = (a, b) => a !== b && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const nested = (a, b) => { for (let p = a.f.parent; p; p = p.parent) if (p === b.f) return true; return false; };
  for (const fr of rm.frames) {
    if (!fr.widen) continue;
    const { cx1, cx2, minW, ex, ew } = fr.widen;
    // centred first, then where the layout had room for it (ELK puts the spare width on one side), then flush with
    // either end of the contents, then any place in between
    const tries = [fr.x];
    if (ex !== undefined && ew >= minW - 0.5) tries.push(ex, ex + ew - minW);
    tries.push(cx2 - minW, cx1);
    for (let x = cx2 - minW; x <= cx1; x += 4) tries.push(x);
    let placed = false;
    for (const x of tries) {
      const c = { ...fr, x };
      if (!rm.frames.some(o => o !== fr && !nested(fr, o) && !nested(o, fr) && hit(c, o))) { fr.x = x; placed = true; break; }
    }
    // no room beside its neighbours: the zone keeps the width of its contents and its title is shortened (the
    // whole title is kept as the zone's tooltip)
    if (!placed) { fr.x = cx1; fr.w = cx2 - cx1; fr.titleFit = Math.max(40, fr.w - 36); }
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
    zones: { green: ['#eef7f1', '#7fb38f', '#3f7a52'], blue: ['#eef2f8', '#8aa0c2', '#4a6491'], orange: ['#fbf1e6', '#d0a06a', '#9a6427'], purple: ['#f3effb', '#a78fd6', '#7d62b8'], grey: ['#f4f5f7', '#b5bac4', '#6b7280'] },
  },
  dark: {
    fg: '#e3e6ec', muted: '#9aa3b2', panel: '#181b21', box: '#1b1e25', line: '#c9ced8', engine: '#23262d',
    storeFill: '#33290f', storeLine: '#e5b94e', ok: '#5cc97a', bad: '#ff7b7b', soft: '#6b7385',
    zones: { green: ['#15241b', '#4f8a62', '#7fc497'], blue: ['#18202d', '#4f6a94', '#8fb0e0'], orange: ['#2a1f14', '#a3743d', '#e0a868'], purple: ['#211a33', '#7d62b8', '#b39ce8'], grey: ['#1d2027', '#4a505c', '#a3aab6'] },
  },
};

function diagramCSS(p, scope) {
  const s = scope ? scope + ' ' : '';
  const z = Object.entries(p.zones).map(([k, [f, st, ink]]) => `${s}.zone-${k}{fill:${f};stroke:${st}}${s}.mki.ink-${k}{stroke:${ink}}`).join('');
  return `${s}text{font:12px Inter,system-ui,-apple-system,"Segoe UI",sans-serif}` +
    `${s}.fg{fill:${p.fg}}${s}.muted{fill:${p.muted}}` +
    `${s}.dtitle{font-size:16px;font-weight:700}${s}.cap{font-size:12px}${s}.ck{font-size:10.5px}${s}.cv{font-size:11px;font-weight:600}${s}.name{font-size:13px;font-weight:600}${s}.note{font-size:11px;font-weight:400}${s}.ztitle{font-size:11.5px;font-weight:600}` +
    `${s}.halo{paint-order:stroke;stroke:${p.panel};stroke-width:4px;stroke-linejoin:round}` +
    `${s}.labbg{fill:${p.panel}}` +
    `${s}.box{fill:${p.box};stroke:${p.line};stroke-width:1.2}` +
    `${s}.box.engine{fill:${p.engine}}${s}.box.store{fill:${p.storeFill};stroke:${p.storeLine};stroke-width:1.4}` +
    `${s}.box.ok{stroke:${p.ok};stroke-width:1.6}${s}.box.bad{stroke:${p.bad};stroke-width:1.6}` +
    `${s}.box.muted{stroke:${p.soft}}${s}.dashed{stroke-dasharray:4 3}` +
    `${s}.dot{fill:${p.line}}` +
    `${s}.card{fill:none;stroke:${p.line};stroke-width:1.2}${s}.cardo{fill:${p.panel};stroke:${p.line};stroke-width:1.2}` +
    `${s}.thead{fill:${p.engine}}${s}.tsep{fill:none;stroke:${p.soft};stroke-width:1}${s}.tframe{fill:none;stroke:${p.line};stroke-width:1.2}` +
    `${s}.tframe.ok{stroke:${p.ok};stroke-width:1.6}${s}.tframe.bad{stroke:${p.bad};stroke-width:1.6}${s}.tframe.muted{stroke:${p.soft}}` +
    `${s}.mk{font-size:9px;font-weight:700;letter-spacing:.03em}${s}.cn{font-size:12px;font-weight:400}${s}.cn.pk{font-weight:700}${s}.ct{font-size:11px}` +
    `${s}.ico{fill:none;stroke:${p.line};stroke-width:1.75;stroke-linecap:round;stroke-linejoin:round}` +
    `${s}.logo{fill:${p.line};stroke:none}${s}.logo-soft{fill:${p.muted};stroke:none}` +
    `${s}.mki{fill:none;stroke:${p.muted};stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}` +
    `${s}.zone{stroke-width:1}${z}${s}.zground{stroke:none}` +
    `${s}.arrow{fill:none;stroke:${p.line};stroke-width:1.2}${s}.arrow.ok{stroke:${p.ok}}${s}.arrow.bad{stroke:${p.bad}}${s}.arrow.muted{stroke:${p.soft}}` +
    `${s}.head{fill:${p.line}}${s}.head-ok{fill:${p.ok}}${s}.head-bad{fill:${p.bad}}${s}.head-muted{fill:${p.soft}}`;
}

// theme 'light' or 'dark' fixes the palette; without one the SVG follows prefers-color-scheme
function standaloneCSS(theme) {
  if (theme === 'light' || theme === 'dark') return diagramCSS(PALETTE[theme], '');
  return diagramCSS(PALETTE.light, '') + `@media (prefers-color-scheme: dark){${diagramCSS(PALETTE.dark, '')}}`;
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const r1 = v => Math.round(v * 10) / 10;

// hops: for each stretch of the original points, the x positions where it hops over another link (in the order
// it meets them); only horizontal stretches have any
function roundPath(pts, r = 7, hops = null) {
  const p = [], seg = [];
  pts.forEach((q, k) => {
    const l = p[p.length - 1];
    if (!l || Math.abs(l.x - q.x) > 0.1 || Math.abs(l.y - q.y) > 0.1) { p.push({ x: q.x, y: q.y }); if (p.length > 1) seg.push(hops ? hops[k - 1] || [] : []); }
  });
  if (p.length < 2) return '';
  const H = 5;
  // the straight run of stretch i, up to (x, y), with its hops: a half circle above the line
  const run = (i, x, y) => {
    let t = '';
    const a = p[i], b = p[i + 1], dir = Math.sign(b.x - a.x);
    for (const hx of seg[i] || []) t += ` L${r1(hx - dir * H)} ${r1(a.y)} A${H} ${H} 0 0 ${dir > 0 ? 1 : 0} ${r1(hx + dir * H)} ${r1(a.y)}`;
    return t + ` L${r1(x)} ${r1(y)}`;
  };
  let d = `M${r1(p[0].x)} ${r1(p[0].y)}`;
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i - 1], b = p[i], c = p[i + 1];
    const l1 = Math.hypot(b.x - a.x, b.y - a.y), l2 = Math.hypot(c.x - b.x, c.y - b.y);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const p1 = { x: b.x - (b.x - a.x) / l1 * rr, y: b.y - (b.y - a.y) / l1 * rr };
    const p2 = { x: b.x + (c.x - b.x) / l2 * rr, y: b.y + (c.y - b.y) / l2 * rr };
    d += run(i - 1, p1.x, p1.y) + ` Q${r1(b.x)} ${r1(b.y)} ${r1(p2.x)} ${r1(p2.y)}`;
  }
  const z = p[p.length - 1];
  return d + run(p.length - 2, z.x, z.y);
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

function tableSVG(n) {
  const out = [];
  const cls = ['box'];
  for (const t of n.tags) cls.push(t);
  const c = cls.join(' ');
  const x = n.x, y = n.y, w = n.w, h = n.h;
  out.push(`<rect class="${c}" x="${r1(x)}" y="${r1(y)}" width="${w}" height="${h}" rx="6"/>`);
  out.push(`<rect class="thead" x="${r1(x + 0.6)}" y="${r1(y + 0.6)}" width="${w - 1.2}" height="${n.headH - 0.6}" rx="5.4"/>`);
  if (n.cols.length) out.push(`<rect class="thead" x="${r1(x + 0.6)}" y="${r1(y + n.headH - 6)}" width="${w - 1.2}" height="6"/>`, `<path class="tsep" d="M${r1(x)} ${r1(y + n.headH)}H${r1(x + w)}"/>`);
  let tx = x + 14;
  if (n.iconMarkup) { out.push(`<g class="ico" transform="translate(${r1(x + 12)} ${r1(y + (n.headH - ICON_SIZE) / 2)}) scale(${r1(ICON_SIZE / 24 * 1000) / 1000})">${n.iconMarkup}</g>`); tx = x + 12 + ICON_SIZE + 8; }
  out.push(`<text class="name fg" x="${r1(tx)}" y="${r1(y + 19.5)}">${esc(n.name)}</text>`);
  n.cols.forEach((col, i) => {
    const ry = y + n.headH + i * n.rowH;
    const marks = col.marks.filter(m => MARK_TEXT[m]).map(m => MARK_TEXT[m]).join(' ');
    if (marks) out.push(`<text class="mk muted" x="${r1(x + 12)}" y="${r1(ry + 15.5)}">${marks}</text>`);
    out.push(`<text class="cn fg${col.marks.includes('pk') ? ' pk' : ''}" x="${r1(x + 12 + n.markW)}" y="${r1(ry + 15.5)}">${esc(col.name)}</text>`);
    if (col.type) out.push(`<text class="ct muted" x="${r1(x + w - 12)}" y="${r1(ry + 15)}" text-anchor="end">${esc(col.type + (col.marks.includes('null') ? '?' : ''))}</text>`);
  });
  out.push(`<rect class="tframe ${n.tags.join(' ')}" x="${r1(x)}" y="${r1(y)}" width="${w}" height="${h}" rx="6"/>`);
  return out.join('');
}

function nodeSVG(n) {
  if (n.kind === 'table') return tableSVG(n);
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
  if (n.kind === 'junction') { out.push(`<rect class="dot" x="${r1(n.x)}" y="${r1(n.y)}" width="${r1(n.w)}" height="${r1(n.h)}" rx="3"/>`); return out.join(''); }
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
  if (n.iconMarkup || n.logoMain) {
    let ix, iy;
    if (n.iconTop) { iy = y + (h - n.textH - ICON_SIZE - 4) / 2; ix = x + w / 2 - ICON_SIZE / 2; top = iy + ICON_SIZE + 4; }
    else { ix = x + n.padX; iy = y + (h - ICON_SIZE) / 2; cx = r1(x + n.padX + ICON_SIZE + 8 + (w - 2 * n.padX - ICON_SIZE - 8) / 2); }
    // a filled logo reads heavier than a line icon: drawn a little smaller, in the same slot
    if (n.iconMarkup) out.push(`<g class="ico" transform="translate(${r1(ix)} ${r1(iy)}) scale(${r1(ICON_SIZE / 24 * 1000) / 1000})">${n.iconMarkup}</g>`);
    else out.push(`<g class="logo" transform="translate(${r1(ix + 1.5)} ${r1(iy + 1.5)}) scale(${r1((ICON_SIZE - 3) / 24 * 1000) / 1000})"><path d="${n.logoD}"/></g>`);
  }
  // marks: their icons stand after the name, at the right of the box; the text centres in what is left
  if (n.markW) {
    cx = r1(cx - n.markW / 2);
    const nameW = n._nameW || 0;
    let mx = Math.min(x + w - n.padX - n.markW + 3, cx + nameW / 2 + 6);
    const my = top + (n.nameLines.length ? 2 : (n.textH - MARK_SIZE) / 2);
    for (const mk of n.marks) {
      out.push(`<g class="mki ink-${mk.ink || 'none'}" transform="translate(${r1(mx)} ${r1(my)}) scale(${r1(MARK_SIZE / 24 * 1000) / 1000})">${mk.iconMarkup || ''}</g>`);
      mx += MARK_SIZE + 5;
    }
  }
  for (const l of n.nameLines) { out.push(`<text class="name fg" x="${cx}" y="${r1(top + 12.5)}" text-anchor="middle">${esc(l)}</text>`); top += 16; }
  n.noteLines.forEach((l, i) => {
    // the small logo and the technology's name are centred together, the logo on the text's middle
    if (i === 0 && n.logoSmall) {
      const tw = n._noteW || 0, gx = cx - (tw + LOGO_SMALL + 4) / 2;
      out.push(`<g class="logo-soft" transform="translate(${r1(gx)} ${r1(top + 10.5 - 4 - LOGO_SMALL / 2)}) scale(${r1(LOGO_SMALL / 24 * 1000) / 1000})"><path d="${n.logoD}"/></g>`);
      out.push(`<text class="note muted" x="${r1(gx + LOGO_SMALL + 4)}" y="${r1(top + 10.5)}">${esc(l)}</text>`);
    } else out.push(`<text class="note muted" x="${cx}" y="${r1(top + 10.5)}" text-anchor="middle">${esc(l)}</text>`);
    top += 14;
  });
  return out.join('');
}

// The end of a link on a node: P is where it meets the node, Q the next point along the link. 1 is two bars,
// n a crow's foot, 01 a bar and a circle, 0n a crow's foot and a circle.
function cardinalitySVG(P, Q, kind) {
  const len = Math.hypot(Q.x - P.x, Q.y - P.y) || 1;
  const u = { x: (Q.x - P.x) / len, y: (Q.y - P.y) / len }, v = { x: -u.y, y: u.x };
  const at = (d, w = 0) => `${r1(P.x + u.x * d + v.x * w)} ${r1(P.y + u.y * d + v.y * w)}`;
  const bar = d => `M${at(d, 5)}L${at(d, -5)}`;
  const foot = `M${at(11, 0)}L${at(0, 6)}M${at(11, 0)}L${at(0, 0)}M${at(11, 0)}L${at(0, -6)}`;
  const circle = d => `<circle class="cardo" cx="${r1(P.x + u.x * d)}" cy="${r1(P.y + u.y * d)}" r="3.6"/>`;
  if (kind === '1') return `<path class="card" d="${bar(7)}${bar(11)}"/>`;
  if (kind === 'n') return `<path class="card" d="${foot}"/>`;
  if (kind === '01') return `<path class="card" d="${bar(7)}"/>${circle(14)}`;
  return `<path class="card" d="${foot}"/>${circle(17)}`;
}

function headId(e, pfx) {
  if (e.tags.includes('bad')) return pfx + 'bad';
  if (e.tags.includes('ok')) return pfx + 'ok';
  if (e.tags.includes('muted')) return pfx + 'mu';
  return pfx + 'a';
}

// The title, the caption (wrapped to the drawing's width) and the cartouche, measured once for the renderer.
function measureHead(model, rm, measure) {
  const head = { title: null, caption: [], cart: null };
  if (model.title) head.title = { text: model.title, w: measure(model.title, FONT_HEAD) };
  const maxW = Math.max(rm.width - 32, 320);
  for (const c of model.caption) {
    let line = '';
    for (const word of c.split(/\s+/)) {
      const t = line ? line + ' ' + word : word;
      if (line && measure(t, FONT_CAP) > maxW) { head.caption.push({ text: line, w: measure(line, FONT_CAP) }); line = word; } else line = t;
    }
    if (line) head.caption.push({ text: line, w: measure(line, FONT_CAP) });
  }
  if (model.cartouche.length) {
    const rows = model.cartouche.map(r => ({ ...r, kw: measure(r.key, FONT_CK), vw: measure(r.value, FONT_CV) }));
    head.cart = { rows, kw: Math.max(...rows.map(r => r.kw)), vw: Math.max(...rows.map(r => r.vw)) };
  }
  return head;
}

// (zones written the same size are evened up again afterwards: sameSizeFrames runs after this)
// A zone whose title has no free place (a narrow zone with a link through its middle) grows, when the room it
// grows into is empty (no node, no other zone, no label, no link running along it): by a title band below its
// contents, else above them, else wide enough to hold the title beside the links that cross its top, to the right
// or to the left. The zones round it grow with it where they would no longer hold it.
function roomForTitles(rm) {
  const B = 18;
  const contains = (g, f) => g !== f && g.x <= f.x + 0.5 && g.y <= f.y + 0.5 && g.x + g.w >= f.x + f.w - 0.5 && g.y + g.h >= f.y + f.h - 0.5;
  const ov = (a, b, m) => a.x < b.x + b.w + m && b.x - m < a.x + a.w && a.y < b.y + b.h + m && b.y - m < a.y + a.h;
  const labBox = r => { const w = r.e.lab.w, x = r.lab.anchor === 'middle' ? r.lab.x - w / 2 : r.lab.anchor === 'end' ? r.lab.x - w : r.lab.x; return { x, y: r.lab.y, w, h: r.e.lab.h }; };
  for (const fr of rm.frames) {
    if (!fr.f.title || titleSpot(rm, fr)) continue;
    const tw = fr.titleFit || fr.f.titleW || fr.f.title.length * 6.5;
    // the links crossing the strip under the top edge, where the title would go
    const xs = rm.edges.filter(r => r.pts && !r.e.lifeline).flatMap(r => r.pts.flatMap((q, i) => {
      if (!i) return [];
      const a = r.pts[i - 1];
      return Math.abs(a.x - q.x) < 0.5 && Math.min(a.y, q.y) < fr.y + 23 && fr.y + 9 < Math.max(a.y, q.y) && a.x > fr.x && a.x < fr.x + fr.w ? [a.x] : [];
    }));
    const wR = xs.length ? Math.max(...xs) + 6 + tw + 12 - (fr.x + fr.w) : 0;
    const wL = xs.length ? fr.x - (Math.min(...xs) - 6 - tw - 12) : 0;
    const tries = [
      { band: { x: fr.x, y: fr.y + fr.h, w: fr.w, h: B }, horiz: true },
      { band: { x: fr.x, y: fr.y - B, w: fr.w, h: B }, horiz: true },
      ...(wR > 0 && wR < tw + 24 ? [{ band: { x: fr.x + fr.w, y: fr.y, w: wR, h: fr.h }, horiz: false }] : []),
      ...(wL > 0 && wL < tw + 24 && fr.x - wL >= 8 ? [{ band: { x: fr.x - wL, y: fr.y, w: wL, h: fr.h }, horiz: false }] : []),
    ];
    for (const { band, horiz } of tries) {
      if (band.y < 0) continue;
      const anc = rm.frames.filter(g => contains(g, fr));
      const free = !rm.nodes.some(n => n.x !== undefined && ov(band, n, 4)) &&
        !rm.frames.some(g => g !== fr && !anc.includes(g) && !contains(fr, g) && ov(band, g, 4)) &&
        !rm.edges.some(r => r.lab && r.e.lab && ov(band, labBox(r), 2)) &&
        !rm.edges.some(r => r.pts && r.pts.some((q, i) => {
          if (!i) return false;
          const a = r.pts[i - 1];
          if (horiz ? Math.abs(q.y - a.y) >= 0.5 : Math.abs(q.x - a.x) >= 0.5) return false;   // a link crossing the band is fine
          return ov(band, { x: Math.min(q.x, a.x), y: Math.min(q.y, a.y), w: Math.abs(q.x - a.x), h: Math.abs(q.y - a.y) }, 2);
        }));
      if (!free) continue;
      const R = { x: Math.min(fr.x, band.x), y: Math.min(fr.y, band.y), x2: Math.max(fr.x + fr.w, band.x + band.w), y2: Math.max(fr.y + fr.h, band.y + band.h) };
      // zones written the same size as this one grow by as much, or this one does not grow
      const grow = { w: R.x2 - R.x - fr.w, h: R.y2 - R.y - fr.h };
      const partners = [];
      for (const ss of (rm.model && rm.model.sameSize) || []) {
        if (ss.kind !== 'frame' || !ss.ids.includes(fr.f.id) || grow[ss.axis] < 0.5) continue;
        for (const id of ss.ids) { const g = rm.frames.find(o => o.f.id === id); if (g && g !== fr && !partners.some(q => q.g === g)) partners.push({ g, axis: ss.axis }); }
      }
      const plans = partners.map(({ g, axis }) => {
        const A = axis === 'w' ? 'x' : 'y', d = grow[axis];
        const ancG = rm.frames.filter(o => contains(o, g));
        for (const pos of [g[A] - d / 2, g[A], g[A] - d]) {
          const c = { ...g, [A]: pos, [axis]: g[axis] + d };
          if (c.x < 8 || c.y < 0) continue;
          if (ancG.some(o => !(c.x >= o.x + 10 && c.y >= o.y + 10 && c.x + c.w <= o.x + o.w - 10 && c.y + c.h <= o.y + o.h - 10))) continue;
          if (rm.frames.some(o => o !== g && o !== fr && !ancG.includes(o) && !contains(g, o) && ov(c, o, 10))) continue;
          if (ov(c, R.x !== undefined ? { x: R.x, y: R.y, w: R.x2 - R.x, h: R.y2 - R.y } : fr, 10)) continue;
          if (rm.nodes.some(n => n.x !== undefined && !contains(g, { x: n.x, y: n.y, w: n.w, h: n.h }) && ov(c, n, 4))) continue;
          return { g, A, axis, pos, size: g[axis] + d };
        }
        return null;
      });
      if (plans.some(q => !q)) continue;
      const all = [fr, ...anc, ...partners.map(q => q.g)], was = all.map(g => [g.x, g.y, g.w, g.h]);
      fr.x = R.x; fr.y = R.y; fr.w = R.x2 - R.x; fr.h = R.y2 - R.y;
      for (const q of plans) { q.g[q.A] = q.pos; q.g[q.axis] = q.size; }
      for (const g of anc) {
        const x = Math.min(g.x, fr.x - 10), y = Math.min(g.y, fr.y - 10);
        const x2 = Math.max(g.x + g.w, fr.x + fr.w + 10), y2 = Math.max(g.y + g.h, fr.y + fr.h + 10);
        g.x = x; g.y = y; g.w = x2 - x; g.h = y2 - y;
      }
      if (titleSpot(rm, fr)) break;
      all.forEach((g, i) => { [g.x, g.y, g.w, g.h] = was[i]; });
    }
  }
  for (const f of rm.frames) { rm.width = Math.max(rm.width, f.x + f.w + 16); rm.height = Math.max(rm.height, f.y + f.h + 16); }
}

// Zones side by side in a row (same parent, same top) put their titles on the same edge: when some sit at the
// bottom (a link crosses their top) the others go to the bottom too, growing by a title band below their contents
// where that room is free, so the row's titles and bottoms line up; else all stay at the top when they can.
function alignTitleEdges(rm) {
  const B = 18;
  const groups = new Map();
  for (const fr of rm.frames) {
    if (!fr.f.title) continue;
    const k = [fr.f.parent && fr.f.parent.id, Math.round(fr.y / 2)].join('|');
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(fr);
  }
  const ov = (a, b, m) => a.x < b.x + b.w + m && b.x - m < a.x + a.w && a.y < b.y + b.h + m && b.y - m < a.y + a.h;
  const contains = (g, f) => g !== f && g.x <= f.x + 0.5 && g.y <= f.y + 0.5 && g.x + g.w >= f.x + f.w - 0.5 && g.y + g.h >= f.y + f.h - 0.5;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const bottom = fr => { const sp = titleSpot(rm, fr); return sp && sp.y > fr.y + fr.h / 2; };
    const nb = list.filter(bottom).length;
    if (!nb || nb === list.length) continue;
    if (list.every(fr => titleSpot(rm, fr, 'top'))) { list.forEach(fr => { fr.titleEdge = 'top'; }); continue; }
    // the others grow by a band below their contents, when it is free
    const was = list.map(fr => fr.h);
    let ok = true;
    for (const fr of list) {
      if (titleSpot(rm, fr, 'bottom')) continue;
      const band = { x: fr.x, y: fr.y + fr.h, w: fr.w, h: B };
      const free = !rm.nodes.some(n => n.x !== undefined && ov(band, n, 4)) &&
        !rm.frames.some(g => g !== fr && !contains(g, fr) && !contains(fr, g) && ov(band, g, 4)) &&
        !rm.edges.some(r => r.pts && r.pts.some((q, i) => i && Math.abs(q.y - r.pts[i - 1].y) < 0.5 && ov(band, { x: Math.min(q.x, r.pts[i - 1].x), y: q.y, w: Math.abs(q.x - r.pts[i - 1].x), h: 0 }, 2)));
      if (!free) { ok = false; break; }
      fr.h += B;
      if (!titleSpot(rm, fr, 'bottom')) { ok = false; break; }
    }
    if (!ok) { list.forEach((fr, i) => { fr.h = was[i]; }); continue; }
    // the row's bottoms line up
    const bot = Math.max(...list.map(fr => fr.y + fr.h));
    for (const fr of list) {
      const band = { x: fr.x, y: fr.y + fr.h, w: fr.w, h: bot - fr.y - fr.h };
      if (band.h > 0.5 && !rm.nodes.some(n => n.x !== undefined && ov(band, n, 2))) fr.h = bot - fr.y;
      fr.titleEdge = 'bottom';
    }
  }
  for (const f of rm.frames) rm.height = Math.max(rm.height, f.y + f.h + 16);
}

// Where a zone's title goes: the first corner where it clears every node, link and label, then the first free
// place along the top edge, then the bottom edge, nearest the right. null when there is none.
function titleSpot(rm, fr, edge) {
  // first corner where the title clears every node (edge 'top' or 'bottom' keeps to that edge)
  const tw = fr.titleFit || fr.f.titleW || fr.f.title.length * 6.5;
  let spots = [
    { x: fr.x + fr.w - 12, y: fr.y + 20, a: 'end' }, { x: fr.x + 12, y: fr.y + 20, a: 'start' },
    { x: fr.x + fr.w - 12, y: fr.y + fr.h - 10, a: 'end' }, { x: fr.x + 12, y: fr.y + fr.h - 10, a: 'start' },
  ];
  if (fr.titleBottom) spots.push(...spots.splice(0, 2));
  if (fr.titleLeft) spots.unshift({ x: fr.x + 10, y: fr.y + 17, a: 'start' });
  if (edge) spots = spots.filter(sp => edge === 'top' ? sp.y < fr.y + fr.h / 2 : sp.y > fr.y + fr.h / 2);
  const clear = sp => {
    const x0 = sp.a === 'end' ? sp.x - tw : sp.x, y0 = sp.y - 11;
    const onLabel = rm.edges.some(r => r.lab && r.e.lab && (() => {
      const b0 = r.lab.anchor === 'middle' ? r.lab.x - r.e.lab.w / 2 : r.lab.anchor === 'end' ? r.lab.x - r.e.lab.w : r.lab.x;
      return b0 < x0 + tw + 4 && x0 - 4 < b0 + r.e.lab.w && r.lab.y < y0 + 14 && y0 < r.lab.y + r.e.lab.h;
    })());
    return !onLabel && !rm.nodes.some(n => n.x < x0 + tw + 4 && x0 - 4 < n.x + n.w && n.y < y0 + 14 && y0 < n.y + n.h) &&
      !rm.edges.some(r => r.pts && !r.e.lifeline && r.pts.some((q, i) => {
        if (!i) return false;
        const a = r.pts[i - 1];
        return Math.min(a.x, q.x) < x0 + tw + 4 && x0 - 4 < Math.max(a.x, q.x) && Math.min(a.y, q.y) < y0 + 14 && y0 < Math.max(a.y, q.y);
      }));
  };
  let sp = spots.find(clear);
  if (!sp) {
    // every corner is taken: the free place along the top edge, then the bottom edge, nearest the right
    const out = [];
    for (const [y, base] of [[fr.y + 20, 0], [fr.y + fr.h - 10, 1]]) if (!edge || (edge === 'top') === !base) for (let x = fr.x + fr.w - 12; x >= fr.x + 12 + tw; x -= 6) out.push({ x, y, a: 'end', base });
    sp = out.find(clear);
  }
  return sp || null;
}

function render(rm, { standalone = false, idPrefix = 'tr', theme = null } = {}) {
  const pfx = idPrefix + '-';
  const model = rm.model;
  let W = Math.ceil(rm.width), H = Math.ceil(rm.height);
  const body = [];

  const late = [];       // zone titles with no free place: drawn over the links
  for (const fr of rm.frames) {
    const t = fr.f.tags;
    const color = (t.find(x => PALETTE.light.zones[x === 'gray' ? 'grey' : x]) || 'green').replace('gray', 'grey');
    body.push(`<rect class="zone zone-${color}${t.includes('dashed') ? ' dashed' : ''}" x="${r1(fr.x)}" y="${r1(fr.y)}" width="${r1(fr.w)}" height="${r1(fr.h)}" rx="10"/>`);
    if (fr.f.title) {
      const tw = fr.titleFit || fr.f.titleW || fr.f.title.length * 6.5;
      let sp = (fr.titleEdge && titleSpot(rm, fr, fr.titleEdge)) || titleSpot(rm, fr), out = body;
      if (!sp) {
        // no free place at all: the corner that the fewest links cross, and the title drawn over the links on a
        // ground of the zone's colour, so they pass under it instead of through its words
        const crossing = c => { const x0 = c.a === 'end' ? c.x - tw : c.x; return rm.edges.reduce((k, r) => k + (r.pts && !r.e.lifeline ? r.pts.filter((q, i) => i && Math.min(r.pts[i - 1].x, q.x) < x0 + tw && x0 < Math.max(r.pts[i - 1].x, q.x) && Math.min(r.pts[i - 1].y, q.y) < c.y + 3 && c.y - 11 < Math.max(r.pts[i - 1].y, q.y)).length : 0), 0); };
        const corners = [{ x: fr.x + fr.w - 12, y: fr.y + 20, a: 'end' }, { x: fr.x + 12, y: fr.y + 20, a: 'start' }, { x: fr.x + fr.w - 12, y: fr.y + fr.h - 10, a: 'end' }, { x: fr.x + 12, y: fr.y + fr.h - 10, a: 'start' }];
        sp = corners.reduce((m, c) => crossing(c) < crossing(m) ? c : m, corners[0]);
        out = late;
        out.push(`<rect class="zone zone-${color} zground" x="${r1((sp.a === 'end' ? sp.x - tw : sp.x) - 4)}" y="${r1(sp.y - 13)}" width="${r1(tw + 8)}" height="17" rx="3"/>`);
      }
      // a title shortened to fit its zone ends with an ellipsis; the whole title is the tooltip
      let ttext = esc(fr.f.title);
      if (fr.titleFit && fr.f.titleW > fr.titleFit) {
        const n = Math.max(4, Math.floor(fr.f.title.length * fr.titleFit / fr.f.titleW) - 1);
        ttext = `${esc(fr.f.title.slice(0, n).trimEnd())}…<title>${esc(fr.f.title)}</title>`;
      }
      const zl = fr.f.logo && logoData(fr.f.logo);
      if (zl) {
        // the logo before the title, both in the title's grey
        const tx0 = sp.a === 'end' ? sp.x - (fr.f.textW || tw - 16) : sp.x + 16;
        out.push(`<g class="logo-soft" transform="translate(${r1(tx0 - 16)} ${r1(sp.y - 10)}) scale(${r1(12 / 24 * 1000) / 1000})"><path d="${zl.d}"/></g>`);
        out.push(`<text class="ztitle muted" x="${r1(tx0)}" y="${r1(sp.y)}">${ttext}</text>`);
      } else out.push(`<text class="ztitle muted" x="${r1(sp.x)}" y="${r1(sp.y)}" text-anchor="${sp.a}">${ttext}</text>`);
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
    // the title goes in the middle of the top edge; if a link runs through it, at the free place nearest the
    // middle along the top edge, else along the bottom edge, else in the middle anyway
    const tw = g.titleW || g.title.length * 6;
    const crossed = (x0, x1, y0, y1) => rm.edges.some(r => r.pts && r.pts.some((p, i) => {
      if (!i) return false;
      const a = r.pts[i - 1];
      return Math.min(a.x, p.x) < x1 && x0 < Math.max(a.x, p.x) && Math.min(a.y, p.y) < y1 && y0 < Math.max(a.y, p.y);
    }));
    const mid = g.x + g.w / 2;
    let spot = null;
    for (const [base, ty] of [[g.y, g.y + 13], [g.y + g.h - 14, g.y + g.h - 4]]) {
      const free = [];
      for (let cx = g.x + tw / 2 + 4; cx <= g.x + g.w - tw / 2 - 4; cx += 4) if (!crossed(cx - tw / 2 - 3, cx + tw / 2 + 3, base + 3, base + 17)) free.push(cx);
      if (free.length) { spot = { x: free.reduce((m, v) => Math.abs(v - mid) < Math.abs(m - mid) ? v : m), y: ty }; break; }
    }
    if (!spot) spot = { x: mid, y: g.y + 13 };
    body.push(`<text class="note muted" x="${r1(spot.x)}" y="${r1(spot.y)}" text-anchor="middle">${esc(g.title)}</text>`);
  }
  const labels = [];
  // where two links cross, the horizontal one hops over the vertical one with a small arc, so a crossing never
  // reads as a junction. Sequence lifelines, rails and the links of one bus are left out.
  const verticals = [];
  for (const r of rm.edges) {
    if (!r.pts || r.e.lifeline || r.e.divider || r.e.rail) continue;
    for (let i = 1; i < r.pts.length; i++) { const a = r.pts[i - 1], b = r.pts[i]; if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) > 0.5) verticals.push({ r, x: a.x, y0: Math.min(a.y, b.y), y1: Math.max(a.y, b.y) }); }
  }
  const hopsFor = r => {
    if (!r.pts || r.e.lifeline || r.e.divider || r.e.rail) return null;
    const out = [];
    for (let i = 1; i < r.pts.length; i++) {
      const a = r.pts[i - 1], b = r.pts[i], xs = [];
      if (Math.abs(a.y - b.y) < 0.5 && Math.abs(a.x - b.x) > 0.5) {
        for (const v of verticals) {
          if (v.r === r || (r.merged && v.r.merged)) continue;
          if (v.x > Math.min(a.x, b.x) + 9 && v.x < Math.max(a.x, b.x) - 9 && a.y > v.y0 + 2 && a.y < v.y1 - 2) xs.push(v.x);
        }
      }
      out.push(xs.sort((u, w) => (b.x - a.x) * (u - w)).filter((x, k, arr) => !k || Math.abs(x - arr[k - 1]) > 12));
    }
    return out.some(h => h.length) ? out : null;
  };
  for (const r of rm.edges) {
    const { e, pts, lab } = r;
    const cls = ['arrow'];
    for (const t of ['ok', 'bad', 'muted']) if (e.tags.includes(t)) cls.push(t);
    if (e.dashed) cls.push('dashed');
    const card = (e.tags || []).map(t => CARD_RE.exec(t)).find(Boolean);
    // a link with cardinalities has its ends drawn as crow's feet, bars and circles instead of arrowheads
    const hp = card ? pts : shorten(pts, e.start, e.end);
    const mk = card ? '' : (e.end ? ` marker-end="url(#${headId(e, pfx)})"` : '') + (e.start ? ` marker-start="url(#${headId(e, pfx)}s)"` : '');
    body.push(`<path class="${cls.join(' ')}" d="${roundPath(hp, 7, hopsFor(r))}"${mk}/>`);
    if (card && pts.length > 1) { body.push(cardinalitySVG(pts[0], pts[1], card[1]), cardinalitySVG(pts[pts.length - 1], pts[pts.length - 2], card[2])); }
    if (lab && e.lab) {
      // in a sequence a message label usually spans lifelines: a halo is too thin to hide them, so the label
      // gets a ground of the page's colour
      if (model.mode === 'sequence' && !e.lifeline) {
        const w = e.lab.w + 6, x0 = lab.anchor === 'middle' ? lab.x - w / 2 : lab.anchor === 'end' ? lab.x - w + 3 : lab.x - 3;
        labels.push(`<rect class="labbg" x="${r1(x0)}" y="${r1(lab.y)}" width="${r1(w)}" height="${r1(e.lab.h)}" rx="2"/>`);
      }
      let y = lab.y + 11;
      for (const l of e.lab.lines) {
        labels.push(`<text class="note muted halo" x="${r1(lab.x)}" y="${r1(y)}" text-anchor="${lab.anchor}">${esc(l)}</text>`);
        y += 13;
      }
    }
  }
  for (const rl of rm.rails || []) for (const d of rl.dots || []) body.push(`<circle class="dot" cx="${r1(d.x)}" cy="${r1(d.y)}" r="2.6"/>`);
  for (const d of rm.joins || []) body.push(`<circle class="dot" cx="${r1(d.x)}" cy="${r1(d.y)}" r="2.6"/>`);
  for (const n of rm.nodes) body.push(nodeSVG(n));
  body.push(...late, ...labels);

  // legend
  const marks = model.marks || [];
  if (model.keys.length || marks.length) {
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
    for (const mk of marks) {
      const tw = (mk._tw || mk.text.length * 6.2);
      const iw = 14 + 8 + tw + 22;
      if (x + iw > maxX && x > 16) { x = 16; y += rowH; }
      items.push(`<g class="mki ink-${mk.ink || 'none'}" transform="translate(${r1(x)} ${r1(y + 4)}) scale(${r1(MARK_SIZE / 24 * 1000) / 1000})">${mk.iconMarkup || ''}</g><text class="note muted" x="${r1(x + 20)}" y="${r1(y + 14)}">${esc(mk.text)}</text>`);
      x += iw;
    }
    body.push(...items);
    H = y + rowH + 10;
  }

  const defs = ['a:head', 'ok:head-ok', 'bad:head-bad', 'mu:head-muted'].map(s => {
    const [id, c] = s.split(':');
    // a head for the end and one for the start, each with plain orient="auto": not every renderer knows
    // auto-start-reverse (resvg, used for the PNGs, does not)
    return `<marker id="${pfx}${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 Z" class="${c}"/></marker>` +
      `<marker id="${pfx}${id}s" viewBox="0 0 10 10" refX="1" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M10 0 L0 5 L10 10 Z" class="${c}"/></marker>`;
  }).join('');
  // the title and caption above the drawing, the cartouche at the bottom right
  const head = rm.head || { title: null, caption: [], cart: null };
  let hh = 0;
  const top = [];
  if (head.title || head.caption.length) {
    let y = 14;
    if (head.title) { top.push(`<text class="dtitle fg" x="16" y="${y + 15}">${esc(head.title.text)}</text>`); y += 24; W = Math.max(W, Math.ceil(head.title.w) + 32); }
    for (const c of head.caption) { top.push(`<text class="cap muted" x="16" y="${y + 12}">${esc(c.text)}</text>`); y += 17; W = Math.max(W, Math.ceil(c.w) + 32); }
    hh = y + 8;
  }
  const shifted = hh ? [`<g transform="translate(0,${hh})">`, ...body, '</g>'] : body.slice();
  H += hh;
  if (head.cart) {
    const c = head.cart, rowH = 18, cw = Math.ceil(10 + c.kw + 16 + c.vw + 10), ch = c.rows.length * rowH + 10;
    W = Math.max(W, cw + 32);
    const x = W - cw - 16, y = H + 4;
    const rows = [`<rect class="card" x="${x}" y="${y}" width="${cw}" height="${ch}" rx="4"/>`];
    c.rows.forEach((r, i) => {
      const by = y + 5 + i * rowH + 13;
      rows.push(`<text class="ck muted" x="${x + 10}" y="${by}">${esc(r.key)}</text><text class="cv fg" x="${x + 10 + Math.ceil(c.kw) + 16}" y="${by}">${esc(r.value)}</text>`);
      if (i) rows.push(`<path class="tsep" d="M${x} ${y + 5 + i * rowH} H${x + cw}"/>`);
    });
    shifted.push(...rows);
    H = y + ch + 14;
  }
  body.length = 0; body.push(...top, ...shifted);
  const aria = esc(model.title || describe(model));
  const style = standalone ? `<style>${standaloneCSS(theme)}</style>` : '';
  // a fixed theme has its own ground, so the file reads the same on any background
  const ground = standalone && theme ? `<rect width="${W}" height="${H}" fill="${PALETTE[theme].panel}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" class="dg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${aria}">${style}<defs>${defs}</defs>${ground}${body.join('')}</svg>`;
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
  // a mark is drawn in the ink of the zone its node stands in (muted grey outside any zone)
  for (const mk of model.marks) {
    mk._tw = measure(mk.text, FONT_NOTE);
    mk.iconMarkup = iconSvg(mk.icon);
    const t = model.nodes.get(mk.id), f = t && frameOfItem(t);
    mk.ink = f ? (f.tags || []).find(v => PALETTE.light.zones[v === 'gray' ? 'grey' : v]) || 'green' : null;
    if (mk.ink === 'gray') mk.ink = 'grey';
  }
  const rm = model.mode === 'sequence' ? await layoutSequence(model, measure) : await layout(model, measure, ELK, opts);
  rm.head = measureHead(model, rm, measure);
  return { model, rm, errors: [], warnings: [...iconsFailed.map(n => `Could not load the icon "${n}" (offline?), drawn without it.`), ...(rm.notes || []), ...(model.alignNotes || []), ...(model.tree && !isTree(model) ? ['tree: this diagram is not a hierarchy (one root, every node with one parent at most, no decision, no reversed or self link, four nodes or more), so it is drawn as usual'] : [])], svg: render(rm, opts), standalone: theme => render(rm, { ...opts, standalone: true, theme: typeof theme === 'string' ? theme : null }) };
}

if (typeof module !== 'undefined') module.exports = { parse, layout, render, compile, diagramCSS, standaloneCSS, PALETTE, FONT_NAME, FONT_NOTE, withIcon };
