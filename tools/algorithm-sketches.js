// Small drawings, one before/after pair per step of the tidy-up, made to show that one idea at a glance
// (docs/how-it-works.md shows them above the real example). Coordinates are in a 260 x 150 panel.
// A sketch: { nodes: [[label, x, y, w?, h?, opts]], links: [[[x, y], ...], opts], frames: [[x, y, w, h, title, colour,
// opts]], dots: [[x, y]], texts: [[text, x, y, anchor?]] }; opts.orange marks what the step changes.
const INK = '#1d2330', MUTED = '#5d6677', ORANGE = '#f08c00', W = 260, H = 150;
const ZONES = { blue: ['#eef2fa', '#9fb0d6'], green: ['#edf6f0', '#9cc7a8'], orange: ['#fbf1e6', '#e0b07a'], grey: ['#f3f4f6', '#c3c8d0'], purple: ['#f3effa', '#b9a7dc'] };

function sketch({ nodes = [], links = [], frames = [], dots = [], texts = [], w = W, h = H }) {
  const o = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="#fff"/>`,
    `<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="${INK}"/></marker>`,
    `<marker id="ao" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="${ORANGE}"/></marker></defs>`];
  const font = (size, weight) => `style="font-family:Inter;font-size:${size}px;font-weight:${weight}"`;
  const late = [];
  for (const [x, y, fw, fh, title, colour = 'blue', opts = {}] of frames) {
    const [fill, stroke] = ZONES[colour];
    o.push(`<rect x="${x}" y="${y}" width="${fw}" height="${fh}" rx="8" fill="${fill}" stroke="${opts.orange ? ORANGE : stroke}" stroke-width="${opts.orange ? 2 : 1}"/>`);
    if (title && opts.titleOnTop) {
      // a title under a node, drawn over it to show the clash
      late.push(`<text x="${x + fw - 8}" y="${y + 13}" text-anchor="end" ${font(9, 600)} fill="#c92a2a">${title}</text>`);
    } else if (title) {
      const tx = opts.titleLeft ? x + 8 : x + fw - 8, ty = opts.titleBottom ? y + fh - 7 : y + 13;
      o.push(`<text x="${tx}" y="${ty}" text-anchor="${opts.titleLeft ? 'start' : 'end'}" ${font(9, 600)} fill="${opts.titleOrange ? ORANGE : MUTED}">${title}</text>`);
    }
  }
  for (const [pts, opts = {}] of links) {
    const d = 'M' + pts.map(p => p.join(' ')).join(' L');
    const col = opts.orange ? ORANGE : INK;
    o.push(`<path d="${d}" fill="none" stroke="${col}" stroke-width="${opts.orange ? 2.2 : 1.3}" stroke-linejoin="round"${opts.dashed ? ' stroke-dasharray="4 3"' : ''}${opts.noArrow ? '' : ` marker-end="url(#${opts.orange ? 'ao' : 'a'})"`}/>`);
    if (opts.label) {
      const [lx, ly, anchor = 'middle'] = opts.label.at;
      o.push(`<text x="${lx}" y="${ly}" text-anchor="${anchor}" ${font(9, 400)} fill="${opts.label.orange ? ORANGE : MUTED}">${opts.label.text}</text>`);
    }
  }
  for (const [label, x, y, nw = 44, nh = 22, opts = {}] of nodes) {
    o.push(`<rect x="${x - nw / 2}" y="${y - nh / 2}" width="${nw}" height="${nh}" rx="${opts.round ? nh / 2 : 6}" fill="#fff" stroke="${opts.orange ? ORANGE : INK}" stroke-width="${opts.orange ? 2.2 : 1.2}"/>`);
    if (label) o.push(`<text x="${x}" y="${y + 4}" text-anchor="middle" ${font(10, 600)} fill="${INK}">${label}</text>`);
  }
  o.push(...late);
  for (const [x, y, orange] of dots) o.push(`<circle cx="${x}" cy="${y}" r="2.8" fill="${orange ? ORANGE : INK}"/>`);
  for (const [t, x, y, anchor = 'middle', orange] of texts) o.push(`<text x="${x}" y="${y}" text-anchor="${anchor}" ${font(9, 400)} fill="${orange ? ORANGE : MUTED}">${t}</text>`);
  o.push('</svg>');
  return o.join('');
}

const O = { orange: true };
// before, after
const SKETCHES = {
  centreParents: [
    { nodes: [['Head', 50, 30], ['A', 50, 115], ['B', 130, 115], ['C', 210, 115]], links: [[[[50, 41], [50, 104]]], [[[50, 41], [50, 70], [130, 70], [130, 104]]], [[[50, 41], [50, 70], [210, 70], [210, 104]]]] },
    { nodes: [['Head', 130, 30, 44, 22, O], ['A', 50, 115], ['B', 130, 115], ['C', 210, 115]], links: [[[[130, 41], [130, 70], [50, 70], [50, 104]], O], [[[130, 41], [130, 104]], O], [[[130, 41], [130, 70], [210, 70], [210, 104]], O]] },
  ],
  placeOnConcentrators: [
    { frames: [[10, 10, 120, 130, 'zone']], nodes: [['A', 60, 35], ['B', 60, 65], ['C', 60, 95], ['D', 60, 125], ['Hub', 215, 75]],
      links: [[[[82, 35], [160, 35], [160, 70], [193, 70]]], [[[82, 65], [150, 65], [150, 73], [193, 73]]], [[[82, 95], [150, 95], [150, 77], [193, 77]]], [[[82, 125], [160, 125], [160, 80], [193, 80]]]] },
    { frames: [[10, 10, 120, 130, 'zone']], nodes: [['A', 50, 35], ['B', 50, 65], ['C', 50, 95], ['D', 50, 125], ['Hub', 215, 80]],
      links: [[[[72, 35], [110, 35], [110, 125], [72, 125]], { ...O, noArrow: true }], [[[72, 65], [110, 65]], { ...O, noArrow: true }], [[[72, 95], [110, 95]], { ...O, noArrow: true }], [[[110, 80], [193, 80]], O]],
      dots: [[110, 65, 1], [110, 95, 1], [110, 80, 1]] },
  ],
  splitDecisions: [
    { nodes: [['ok?', 130, 25, 50, 22, { round: true }], ['Yes', 70, 120], ['No', 190, 120]],
      links: [[[[122, 36], [122, 75], [70, 75], [70, 109]], { label: { text: 'yes', at: [95, 70] } }], [[[138, 36], [138, 85], [190, 85], [190, 109]], { label: { text: 'no', at: [165, 98] } }]] },
    { nodes: [['ok?', 70, 25, 50, 22, { round: true }], ['Yes', 70, 120], ['No', 190, 120]],
      links: [[[[70, 36], [70, 109]], { ...O, label: { text: 'yes', at: [80, 75, 'start'] } }], [[[95, 25], [190, 25], [190, 109]], { ...O, label: { text: 'no', at: [150, 19] } }]] },
  ],
  spanSides: [
    { frames: [[10, 10, 130, 60, 'app'], [10, 80, 130, 60, 'data'], [180, 10, 70, 40, 'logs', 'green']], nodes: [['App', 75, 45], ['DB', 75, 115], ['SIEM', 215, 33]],
      links: [[[[97, 45], [160, 45], [160, 38], [193, 38]]], [[[97, 115], [165, 115], [165, 30], [193, 30]]]] },
    { frames: [[10, 10, 130, 60, 'app'], [10, 80, 130, 60, 'data'], [180, 10, 70, 130, 'logs', 'green', O]], nodes: [['App', 75, 45], ['DB', 75, 115], ['SIEM', 215, 80, 44, 22, O]],
      links: [[[[97, 45], [165, 45], [165, 76], [193, 76]], O], [[[97, 115], [165, 115], [165, 84], [193, 84]], O]] },
  ],
  pullSides: [
    { frames: [[10, 10, 110, 55, 'app'], [10, 85, 180, 55, 'wide zone', 'purple'], [205, 10, 50, 55, 'logs', 'green']], nodes: [['App', 65, 40], ['', 100, 115, 140, 16], ['L', 230, 40, 30]], links: [[[[87, 40], [215, 40]], { dashed: true }]] },
    { frames: [[10, 10, 110, 55, 'app'], [10, 85, 180, 55, 'wide zone', 'purple'], [135, 10, 50, 55, 'logs', 'green', { orange: true }]], nodes: [['App', 65, 40], ['', 100, 115, 140, 16], ['L', 160, 40, 30, 22, { orange: true }]], links: [[[[87, 40], [145, 40]], { dashed: true, orange: true }]] },
  ],
  clearFrames: [
    { frames: [[40, 40, 180, 90, 'zone']], nodes: [['A', 20, 20], ['B', 240, 120]], links: [[[[20, 31], [20, 40], [240, 40], [240, 109]]]] },
    { frames: [[40, 40, 180, 90, 'zone']], nodes: [['A', 20, 20], ['B', 240, 120]], links: [[[[20, 31], [20, 28], [240, 28], [240, 109]], O]] },
  ],
  alignJogs: [
    { nodes: [['A', 60, 25], ['B', 200, 25], ['C', 130, 125]], links: [[[[60, 36], [60, 60], [122, 60], [122, 114]]], [[[200, 36], [200, 90], [138, 90], [138, 114]]]] },
    { nodes: [['A', 60, 25], ['B', 200, 25], ['C', 130, 125]], links: [[[[60, 36], [60, 75], [122, 75], [122, 114]], O], [[[200, 36], [200, 75], [138, 75], [138, 114]], O]] },
  ],
  simplifySnakes: [
    { nodes: [['A', 40, 22], ['B', 220, 128]], links: [[[[40, 33], [40, 55], [130, 55], [130, 80], [60, 80], [60, 100], [220, 100], [220, 117]]]] },
    { nodes: [['A', 40, 22], ['B', 220, 128]], links: [[[[40, 33], [40, 75], [220, 75], [220, 117]], O]] },
  ],
  mergeHubs: [
    { nodes: [['A', 35, 15], ['B', 35, 45], ['C', 35, 75], ['D', 35, 105], ['E', 35, 135], ['IdP', 220, 75]],
      links: [[[[57, 15], [150, 15], [150, 67], [198, 67]], { label: { text: 'token', at: [110, 10] } }], [[[57, 45], [140, 45], [140, 71], [198, 71]], { label: { text: 'token', at: [100, 40] } }], [[[57, 75], [198, 75]], { label: { text: 'token', at: [100, 70] } }], [[[57, 105], [140, 105], [140, 79], [198, 79]], { label: { text: 'token', at: [100, 117] } }], [[[57, 135], [150, 135], [150, 83], [198, 83]], { label: { text: 'token', at: [110, 147] } }]] },
    { nodes: [['A', 35, 15], ['B', 35, 45], ['C', 35, 75], ['D', 35, 105], ['E', 35, 135], ['IdP', 220, 60]],
      links: [[[[57, 15], [90, 15], [90, 135], [57, 135]], { ...O, noArrow: true }], [[[57, 45], [90, 45]], { ...O, noArrow: true }], [[[57, 75], [90, 75]], { ...O, noArrow: true }], [[[57, 105], [90, 105]], { ...O, noArrow: true }], [[[90, 60], [198, 60]], { ...O, label: { text: 'token', at: [145, 54], orange: true } }]],
      dots: [[90, 45, 1], [90, 75, 1], [90, 105, 1], [90, 60, 1]] },
  ],
  rerouteBlocked: [
    { nodes: [['A', 40, 75], ['X', 130, 75, 50, 40], ['B', 220, 75]], links: [[[[62, 75], [198, 75]]]] },
    { nodes: [['A', 40, 75], ['X', 130, 75, 50, 40], ['B', 220, 75]], links: [[[[62, 75], [80, 75], [80, 40], [180, 40], [180, 75], [198, 75]], O]] },
  ],
  straightenSmallJogs: [
    { nodes: [['A', 60, 70], ['B', 200, 80]], links: [[[[82, 70], [130, 70], [130, 80], [178, 80]]]] },
    { nodes: [['A', 60, 75], ['B', 200, 75]], links: [[[[82, 75], [178, 75]], O]] },
  ],
  reorderEnds: [
    { nodes: [['A', 60, 75], ['Top', 200, 25], ['Low', 200, 125]], links: [[[[82, 68], [130, 68], [130, 125], [178, 125]]], [[[82, 82], [140, 82], [140, 25], [178, 25]]]] },
    { nodes: [['A', 60, 75], ['Top', 200, 25], ['Low', 200, 125]], links: [[[[82, 68], [130, 68], [130, 25], [178, 25]], O], [[[82, 82], [130, 82], [130, 125], [178, 125]], O]] },
  ],
  spreadEnds: [
    { nodes: [['A', 50, 25], ['B', 210, 25], ['C', 130, 125, 60]], links: [[[[50, 36], [50, 80], [128, 80], [128, 114]]], [[[210, 36], [210, 80], [132, 80], [132, 114]]]] },
    { nodes: [['A', 50, 25], ['B', 210, 25], ['C', 130, 125, 60]], links: [[[[50, 36], [50, 80], [116, 80], [116, 114]], O], [[[210, 36], [210, 80], [144, 80], [144, 114]], O]] },
  ],
  separateParallels: [
    { nodes: [['A', 30, 30], ['B', 30, 62], ['C', 230, 90], ['D', 230, 120]], links: [[[[52, 30], [132, 30], [132, 90], [208, 90]]], [[[52, 62], [128, 62], [128, 120], [208, 120]]]], texts: [['4px apart: they read as one', 130, 145]] },
    { nodes: [['A', 30, 30], ['B', 30, 62], ['C', 230, 90], ['D', 230, 120]], links: [[[[52, 30], [144, 30], [144, 90], [208, 90]], O], [[[52, 62], [120, 62], [120, 120], [208, 120]], O]] },
  ],
  uncrossSteps: [
    { nodes: [['A', 40, 85], ['B', 40, 125], ['D', 220, 25], ['C', 220, 60]], links: [[[[62, 85], [150, 85], [150, 25], [198, 25]]], [[[62, 125], [110, 125], [110, 60], [198, 60]]]], texts: [['they cross twice', 130, 145]] },
    { nodes: [['A', 40, 85], ['B', 40, 125], ['D', 220, 25], ['C', 220, 60]], links: [[[[62, 85], [110, 85], [110, 25], [198, 25]], O], [[[62, 125], [150, 125], [150, 60], [198, 60]], O]] },
  ],
  resolveOverlaps: [
    { nodes: [['A', 40, 75], ['B', 220, 50], ['C', 220, 100]], links: [[[[62, 75], [140, 75], [140, 50], [198, 50]]], [[[62, 75], [140, 75], [140, 100], [198, 100]]]], texts: [['two links, one line', 100, 95]] },
    { nodes: [['A', 40, 75], ['B', 220, 50], ['C', 220, 100]], links: [[[[62, 69], [140, 69], [140, 50], [198, 50]], O], [[[62, 81], [140, 81], [140, 100], [198, 100]], O]] },
  ],
  slideToStraighten: [
    { nodes: [['A', 50, 25], ['B', 130, 25], ['C', 210, 25], ['N', 138, 120]], links: [[[[50, 36], [50, 85], [130, 85], [130, 109]]], [[[130, 36], [130, 70], [138, 70], [138, 109]]], [[[210, 36], [210, 85], [146, 85], [146, 109]]]] },
    { nodes: [['A', 50, 25], ['B', 130, 25], ['C', 210, 25], ['N', 130, 120, 44, 22, O]], links: [[[[50, 36], [50, 85], [122, 85], [122, 109]]], [[[130, 36], [130, 109]], O], [[[210, 36], [210, 85], [138, 85], [138, 109]]]] },
  ],
  rerouteSiblings: [
    { nodes: [['Hub', 130, 25], ['A', 50, 125], ['B', 130, 125], ['C', 210, 125]], links: [[[[130, 36], [130, 114]]], [[[122, 36], [122, 70], [210, 70], [210, 114]]], [[[138, 36], [138, 90], [50, 90], [50, 114]]]] },
    { nodes: [['Hub', 130, 25], ['A', 50, 125], ['B', 130, 125], ['C', 210, 125]], links: [[[[130, 36], [130, 114]]], [[[138, 36], [138, 70], [210, 70], [210, 114]], O], [[[122, 36], [122, 70], [50, 70], [50, 114]], O]] },
  ],
  squareUp: [
    { nodes: [['A', 50, 70], ['B', 210, 82]], links: [[[[72, 70], [130, 70], [134, 82], [188, 82]]]], texts: [['a stretch a little slanted', 130, 120]] },
    { nodes: [['A', 50, 70], ['B', 210, 82]], links: [[[[72, 70], [132, 70], [132, 82], [188, 82]], O]] },
  ],
  placeLabels: [
    { nodes: [['A', 40, 75], ['B', 220, 75]], links: [[[[62, 75], [198, 75]], { label: { text: '443/tcp', at: [130, 79] } }]] },
    { nodes: [['A', 40, 75], ['B', 220, 75]], links: [[[[62, 75], [198, 75]], { label: { text: '443/tcp', at: [130, 69], orange: true } }]] },
  ],
  roomForTitles: [
    { frames: [[30, 20, 200, 110, 'zone title', 'blue', { titleOnTop: true }]], nodes: [['A', 70, 30, 44, 22], ['B', 190, 30, 44, 22]], links: [[[[92, 30], [168, 30]]]] },
    { frames: [[30, 12, 200, 126, 'zone title', 'blue', { orange: true, titleBottom: true, titleOrange: true }]], nodes: [['A', 70, 40, 44, 22], ['B', 190, 40, 44, 22]], links: [[[[92, 40], [168, 40]]]] },
  ],
  alignTitleEdges: [
    { frames: [[10, 20, 115, 110, 'one'], [135, 20, 115, 110, 'two', 'green', { titleBottom: true }]], nodes: [['A', 67, 75], ['B', 192, 75]] },
    { frames: [[10, 20, 115, 110, 'one', 'blue', { titleBottom: true, titleOrange: true }], [135, 20, 115, 110, 'two', 'green', { titleBottom: true }]], nodes: [['A', 67, 75], ['B', 192, 75]] },
  ],
  sameSizeFrames: [
    { frames: [[70, 10, 120, 38, 'edge', 'orange'], [20, 56, 220, 38, 'app'], [95, 102, 70, 38, 'data', 'purple']], nodes: [['', 130, 32, 30, 14], ['', 130, 78, 30, 14], ['', 130, 124, 30, 14]] },
    { frames: [[20, 10, 220, 38, 'edge', 'orange', O], [20, 56, 220, 38, 'app'], [20, 102, 220, 38, 'data', 'purple', O]], nodes: [['', 130, 32, 30, 14], ['', 130, 78, 30, 14], ['', 130, 124, 30, 14]] },
  ],
  fitCanvas: [
    { frames: [[4, 4, 252, 142, '', 'grey']], nodes: [['A', 60, 50], ['B', 140, 50]], links: [[[[82, 50], [118, 50]]]], texts: [['empty room', 180, 120]] },
    { frames: [[30, 30, 140, 40, '', 'grey', O]], nodes: [['A', 60, 50], ['B', 140, 50]], links: [[[[82, 50], [118, 50]]]] },
  ],
};

module.exports = { sketch, SKETCHES };
