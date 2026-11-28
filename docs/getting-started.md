# Getting started

## Install

Trace is not on npm yet. Clone the repository and install its dependencies (tested with Node 20):

```
git clone <this repository> trace
cd trace
npm install
```

## Your first diagram

Write a file, `shop.trace`:

```
direction down
title "Shop"

pill user [user]: Customer
frame web "web" [blue] {
  app [server]: Shop app | Node.js
}
store db [database postgresql]: Orders DB

user -> app : HTTPS
app -> db : orders
```

Draw it:

```
node tools/render.js shop.trace shop.svg            # an SVG that follows light and dark mode
node tools/render.js shop.trace shop.png --zoom 2   # a PNG (--dark for the dark theme)
node tools/render.js shop.trace shop.svg --watch    # draw again whenever the file changes
```

Mistakes are printed with their line number and what to write instead. The [manual](manual.md) has everything
you can write.

## The playground

```
npm run build
```

Open `dist/playground.html` in a browser: the text on the left, the drawing on the right, updated as you type.
The same build writes `dist/showcase.html` (twenty real diagrams with notes), `dist/features.html` (every
feature, with and without) and `dist/compare.html` (Trace beside Mermaid on real diagrams).

## From your own code

In Node:

```js
const ELK = require('elkjs/lib/elk.bundled.js');
const { compile } = require('./src/trace.js');
const { measure } = require('./tools/measure.js');

const res = await compile(source, measure, ELK, {});
if (res.errors.length) console.error(res.errors);   // [{ line, msg }]
const svg = res.standalone('light');                // or 'dark', or no argument to follow the reader's theme
```

In a web page, load elkjs (`https://cdn.jsdelivr.net/npm/elkjs@0.9.3/lib/elk.bundled.js`) and `src/trace.js`,
and give `compile` a function that measures text with a canvas, as the playground does:

```js
const ctx = document.createElement('canvas').getContext('2d');
const measure = (text, font) => { ctx.font = font; return ctx.measureText(text).width; };
const res = await compile(source, measure, ELK, {});
element.innerHTML = res.svg;
```

`res.warnings` lists what could be drawn but not as asked (an icon that could not load, a hint whose place was
taken).
