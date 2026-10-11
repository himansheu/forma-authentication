/*
 * The FORMA mark: a 2x2 grid of geometric primitives.
 * Every shape is derived deterministically from the username, so the mark you
 * assemble while registering is the same one the dashboard shows later.
 */

const NS = 'http://www.w3.org/2000/svg';
const SHAPES = ['circle', 'square', 'triangle', 'quarter', 'half'];
const COLORS = ['sun', 'cobalt', 'coral'];

export function hash(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  let s = seed || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

/** What goes in cell `i` for a given name. Pure function: same input, same shape. */
export function cellSpec(name, i) {
  const next = rng(hash(`${String(name).toLowerCase()}:${i}`));
  next(); // first output of xorshift is weakly mixed
  const shape = SHAPES[Math.floor(next() * SHAPES.length)];
  const turn = Math.floor(next() * 4) * 90;
  const color = COLORS[Math.floor(next() * COLORS.length)];
  return { shape, turn, color };
}

function drawShape(group, spec) {
  group.replaceChildren();
  const inner = el('g', { transform: `rotate(${spec.turn} 50 50)`, class: `fill-${spec.color}` }, group);
  switch (spec.shape) {
    case 'circle':
      el('circle', { cx: 50, cy: 50, r: 40 }, inner);
      break;
    case 'square':
      el('rect', { x: 10, y: 10, width: 80, height: 80 }, inner);
      break;
    case 'triangle':
      el('polygon', { points: '10,90 90,90 10,10' }, inner);
      break;
    case 'quarter':
      el('path', { d: 'M10 90 L10 10 A80 80 0 0 1 90 90 Z' }, inner);
      break;
    case 'half':
      el('path', { d: 'M10 50 A40 40 0 0 1 90 50 Z' }, inner);
      break;
  }
}

/**
 * Builds the SVG inside `svg` and returns a small controller.
 * `label` is called with the number of placed cells so assistive tech gets a live description.
 */
export function createMark(svg, { name = '' } = {}) {
  svg.setAttribute('viewBox', '0 0 200 200');
  svg.setAttribute('role', 'img');
  svg.replaceChildren();

  let seed = name;
  const placed = [false, false, false, false];
  const cells = [];

  for (let i = 0; i < 4; i++) {
    const g = el('g', { transform: `translate(${(i % 2) * 100} ${Math.floor(i / 2) * 100})`, class: 'mark__cell' }, svg);
    el('rect', { x: 1, y: 1, width: 98, height: 98, class: 'mark__slot' }, g);
    const shape = el('g', { class: 'mark__shape' }, g);
    cells.push({ g, shape });
  }

  function describe() {
    const n = placed.filter(Boolean).length;
    svg.setAttribute(
      'aria-label',
      n === 4 ? 'Your mark is complete.' : `Your mark: ${n} of 4 shapes placed.`
    );
  }

  function redraw(i) {
    drawShape(cells[i].shape, cellSpec(seed || 'forma', i));
  }

  const api = {
    setName(next) {
      seed = next;
      cells.forEach((_, i) => placed[i] && redraw(i));
    },
    place(i, on) {
      if (placed[i] === on) return;
      placed[i] = on;
      if (on) redraw(i);
      cells[i].g.classList.toggle('is-placed', on);
      describe();
    },
    count: () => placed.filter(Boolean).length,
    /** Place every cell in turn. Resolves when the last one lands. */
    async complete(stepMs = 140) {
      for (let i = 0; i < 4; i++) {
        api.place(i, true);
        await new Promise((r) => setTimeout(r, stepMs));
      }
    },
    busy(on) {
      svg.classList.toggle('is-busy', on);
    },
    error(on) {
      svg.classList.toggle('is-error', on);
    },
  };
  describe();
  return api;
}
