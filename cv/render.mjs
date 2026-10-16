// Renders resume data into a one-page A4 PDF with pdf-lib.
// Like always-fit-resume, it binary searches the largest font size that fits on the page,
// then grows line height to fill the remaining space. Measuring and drawing share one
// layout pass, so what fits is exactly what gets drawn.
// No filesystem access here, so this also runs in the browser.
import { PDFDocument, PDFString, rgb, setCharacterSpacing } from "pdf-lib";

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 36;
const FS_MIN = 7;
const FS_MAX = 11;
const LH_MIN = 1.25;
const LH_MAX = 1.6;

const COLORS = {
  name: "#111111",
  title: "#555555",
  heading: "#999999",
  entry: "#111111",
  text: "#333333",
  meta: "#888888",
  link: "#1f5fbf",
  rule: "#dddddd",
};

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const DOMAIN = /\b(?:[a-z0-9-]+\.)+(?:com|org|io|coop|net|dev|app|se)(?:\/[\w\-./%~]*[\w\-/%~])?/i;

const hex = (h) => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255);

// Split text into runs, turning emails and domains into links.
function autolink(text, style) {
  const runs = [];
  let rest = text;
  while (rest) {
    const e = EMAIL.exec(rest);
    const d = DOMAIN.exec(rest);
    const m = e && (!d || e.index <= d.index) ? e : d;
    if (!m) {
      runs.push({ text: rest, style });
      break;
    }
    if (m.index) runs.push({ text: rest.slice(0, m.index), style });
    const url = m === e ? `mailto:${m[0]}` : `https://${m[0]}`;
    runs.push({ text: m[0], style: { ...style, color: COLORS.link, url } });
    rest = rest.slice(m.index + m[0].length);
  }
  return runs;
}

const domainOf = (url) => url.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");

function textWidth(text, style) {
  const w = style.font.widthOfTextAtSize(text, style.size);
  return style.spacing ? w + style.spacing * text.length : w;
}

// Words can span several styled runs ("(voteid.io," is three pieces). A "·" separator is
// glued to the word before it, so lines never start with one.
function toWords(runs) {
  const words = [];
  let cur = null;
  let space = null;
  for (const run of runs) {
    for (const part of run.text.split(/( )/)) {
      if (part === "") continue;
      if (part === " ") {
        if (cur) words.push(cur);
        cur = null;
        space = run.style;
        continue;
      }
      if (!cur) {
        cur = { pieces: [], space };
        space = null;
      }
      cur.pieces.push({ text: part, style: run.style });
    }
  }
  if (cur) words.push(cur);
  const glued = [];
  for (const w of words) {
    const prev = glued[glued.length - 1];
    if (prev && w.pieces.length === 1 && w.pieces[0].text === "·") {
      prev.pieces.push({ text: " ", style: w.space || w.pieces[0].style }, w.pieces[0]);
    } else glued.push(w);
  }
  return glued;
}

// Greedy line breaking. Returns lines of positioned pieces (x relative to the block).
function wrap(runs, maxW) {
  const lines = [];
  let line = [];
  let lineW = 0;
  for (const word of toWords(runs)) {
    const ww = word.pieces.reduce((s, p) => s + textWidth(p.text, p.style), 0);
    const sw = word.space ? textWidth(" ", word.space) : 0;
    if (line.length && lineW + sw + ww > maxW) {
      lines.push(line);
      line = [];
      lineW = 0;
    }
    let x = line.length ? lineW + sw : 0;
    for (const p of word.pieces) {
      const w = textWidth(p.text, p.style);
      line.push({ ...p, x, w });
      x += w;
    }
    lineW = x;
  }
  if (line.length) lines.push(line);
  return lines;
}

// One layout pass. With fonts and sizes fixed it returns the total height plus the
// draw ops, so measuring and drawing can never disagree.
function layout(data, fonts, logos, photo, fs, lhMult) {
  const ops = [];
  const links = [];
  const wrapped = [];
  let y = MARGIN;
  const contentW = PAGE_W - MARGIN * 2;

  const style = (o) => ({ font: fonts.regular, size: fs, color: COLORS.text, ...o });

  // Lays out a block of runs at x, advancing y. Returns the number of lines.
  const block = (runs, x, width, lineH) => {
    const lines = wrap(runs, width);
    for (const line of lines) {
      const size = Math.max(...line.map((p) => p.style.size));
      const baseline = y + lineH / 2 + size * 0.36;
      let link = null;
      const flush = () => link && links.push(link);
      for (const p of line) {
        ops.push({ type: "text", text: p.text, x: x + p.x, baseline, style: p.style });
        if (p.style.url && link && link.url === p.style.url) link.x1 = x + p.x + p.w;
        else {
          flush();
          link = p.style.url ? { url: p.style.url, x0: x + p.x, x1: x + p.x + p.w, top: baseline - size * 0.9, bottom: baseline + size * 0.28 } : null;
        }
      }
      flush();
      y += lineH;
    }
    return lines.length;
  };

  // Header: optional photo in the top left, uncropped in its own aspect ratio, with name,
  // title and contact beside it and vertically centered on the photo.
  const photoH = photo ? fs * 8 : 0;
  const photoW = photo ? (photoH * photo.width) / photo.height : 0;
  const headerX = photo ? MARGIN + photoW + fs * 1.3 : MARGIN;
  const headerW = PAGE_W - MARGIN - headerX;
  const headerTop = y;
  const opsStart = ops.length;
  const linksStart = links.length;
  const nameSize = fs * 2.1;
  block([{ text: data.name, style: style({ font: fonts.semibold, size: nameSize, color: COLORS.name }) }], headerX, headerW, nameSize * 1.2);
  block([{ text: data.title, style: style({ size: fs * 1.1, color: COLORS.title }) }], headerX, headerW, fs * 1.1 * lhMult);
  const contactStyle = style({ size: fs * 0.86, color: COLORS.meta });
  const contactRuns = data.contact.flatMap((item, i) => [...(i ? [{ text: " · ", style: contactStyle }] : []), ...autolink(item, contactStyle)]);
  // Balance the contact line: use the narrowest width that needs no extra lines,
  // so a wrap splits it evenly instead of leaving one item alone on the last line.
  const contactLines = wrap(contactRuns, headerW).length;
  let narrow = headerW / contactLines;
  let wide = headerW;
  while (wide - narrow > 1) {
    const mid = (narrow + wide) / 2;
    if (wrap(contactRuns, mid).length > contactLines) narrow = mid;
    else wide = mid;
  }
  block(contactRuns, headerX, wide, fs * 0.86 * lhMult);
  if (photo) {
    const shift = Math.max(0, (photoH - (y - headerTop)) / 2);
    for (const op of ops.slice(opsStart)) op.baseline += shift;
    for (const l of links.slice(linksStart)) {
      l.top += shift;
      l.bottom += shift;
    }
    ops.push({ type: "photo", img: photo, x: MARGIN, top: headerTop, w: photoW, h: photoH });
    y = Math.max(y + shift, headerTop + photoH);
  }
  y += fs * 0.8;
  ops.push({ type: "rule", x0: MARGIN, x1: PAGE_W - MARGIN, y });
  y += fs * 0.8;
  block(autolink(data.summary, style()), MARGIN, contentW, fs * lhMult);

  const lineH = fs * lhMult;
  const logoGap = fs * 0.9;
  const bulletIndent = fs * 0.9;

  // Lays out one entry: logo on the left, title line with date and location, then bullets.
  // Nested projects (entry.projects) use the same layout with a smaller logo, indented under
  // the entry's text.
  const entryBlock = (entry, x0, logoBox) => {
    const top = y;
    const textX = x0 + logoBox + logoGap;
    const textW = PAGE_W - MARGIN - textX;
    const titleStyle = style({ font: fonts.semibold, color: COLORS.entry, url: entry.url });
    const titleRuns = [{ text: entry.title, style: titleStyle }];
    if (entry.url) titleRuns.push({ text: `  ${domainOf(entry.url)}`, style: style({ size: fs * 0.88, color: COLORS.link, url: entry.url }) });
    const metaStyle = style({ size: fs * 0.86, color: COLORS.meta });
    const meta = [entry.date, entry.location].filter(Boolean).join(" · ");
    const titleW = toWords(titleRuns).reduce((s, w, j) => s + (j && w.space ? textWidth(" ", w.space) : 0) + w.pieces.reduce((t, p) => t + textWidth(p.text, p.style), 0), 0);
    const metaW = textWidth(meta, metaStyle);
    const bullets = entry.bullets || [];

    // Date and location go on the title line when there is room and the entry has bullets.
    // Otherwise they get their own line, which also keeps every entry at least two lines tall
    // for the logo.
    if (!meta) {
      block(titleRuns, textX, textW, lineH);
    } else if (bullets.length && titleW + fs * 1.5 + metaW <= textW) {
      // Title is drawn first so text extraction (copy/paste, ATS parsers) reads it before the date.
      const baseline = y + lineH / 2 + fs * 0.36;
      block(titleRuns, textX, textW, lineH);
      ops.push({ type: "text", text: meta, x: PAGE_W - MARGIN - metaW, baseline, style: metaStyle });
    } else {
      block(titleRuns, textX, textW, lineH);
      block([{ text: meta, style: metaStyle }], textX, textW, fs * 0.86 * lhMult);
    }

    for (const b of bullets) {
      ops.push({ type: "text", text: "•", x: textX, baseline: y + lineH / 2 + fs * 0.36, style: style() });
      if (block(autolink(b, style()), textX + bulletIndent, textW - bulletIndent, lineH) > 1) wrapped.push(b);
    }

    for (const project of entry.projects || []) {
      y += fs * 0.35;
      entryBlock(project, textX, Math.min(fs * 1.9, lineH * 1.5));
    }

    if (entry.logo) {
      const img = logos[entry.logo];
      if (!img) throw new Error(`Missing logo "${entry.logo}" for "${entry.title}"`);
      const k = Math.min(logoBox / img.width, logoBox / img.height);
      const w = img.width * k;
      const h = img.height * k;
      const boxTop = top + Math.max(0, (Math.min(y - top, lineH * 2) - logoBox) / 2);
      ops.push({ type: "image", img, x: x0 + (logoBox - w) / 2, top: boxTop + (logoBox - h) / 2, w, h });
      y = Math.max(y, boxTop + logoBox);
    }
  };

  for (const section of data.sections) {
    y += fs * 1.1;
    const headingStyle = style({ font: fonts.semibold, size: fs * 0.78, color: COLORS.heading, spacing: fs * 0.06 });
    block([{ text: section.heading.toUpperCase(), style: headingStyle }], MARGIN, contentW, fs * 0.78 * lhMult);
    y += fs * 0.3;

    if (section.text) {
      // Keep each "·" separated item whole, so a multi-word skill like "Iroh P2P" never splits.
      const text = section.text.split(" · ").map((item) => item.replace(/ /g, "\u00a0")).join(" · ");
      block(autolink(text, style()), MARGIN, contentW, lineH);
      continue;
    }

    section.entries.forEach((entry, i) => {
      if (i) y += fs * 0.7;
      entryBlock(entry, MARGIN, Math.min(fs * 2.3, lineH * 1.85));
    });
  }

  return { height: y - MARGIN, ops, links, wrapped };
}

export async function renderResume({ data, fonts, logos, photo, fontkit }) {
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.registerFontkit(fontkit);
  doc.setTitle(`${data.name} CV`);
  doc.setAuthor(data.name);
  doc.setCreator("cv/build.mjs");
  doc.setProducer("pdf-lib");
  const embedded = {
    regular: await doc.embedFont(fonts.regular, { subset: true }),
    semibold: await doc.embedFont(fonts.semibold, { subset: true }),
  };
  const images = {};
  for (const [name, bytes] of Object.entries(logos)) images[name] = await doc.embedPng(bytes);
  const isPng = (b) => b[0] === 0x89 && b[1] === 0x50;
  const photoImg = photo ? await (isPng(photo) ? doc.embedPng(photo) : doc.embedJpg(photo)) : null;

  const avail = PAGE_H - MARGIN * 2;
  const fits = (fs, lh) => layout(data, embedded, images, photoImg, fs, lh).height <= avail;

  if (!fits(FS_MIN, LH_MIN)) throw new Error(`Resume does not fit on one page even at ${FS_MIN}pt, shorten the content`);
  let lo = FS_MIN;
  let hi = FS_MAX;
  if (fits(hi, LH_MIN)) lo = hi;
  while (hi - lo > 0.01) {
    const mid = (lo + hi) / 2;
    if (fits(mid, LH_MIN)) lo = mid;
    else hi = mid;
  }
  const fontSize = Math.floor(lo * 100) / 100;
  let lhLo = LH_MIN;
  let lhHi = LH_MAX;
  if (fits(fontSize, lhHi)) lhLo = lhHi;
  while (lhHi - lhLo > 0.001) {
    const mid = (lhLo + lhHi) / 2;
    if (fits(fontSize, mid)) lhLo = mid;
    else lhHi = mid;
  }
  const lineHeight = Math.floor(lhLo * 1000) / 1000;

  const result = layout(data, embedded, images, photoImg, fontSize, lineHeight);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  for (const op of result.ops) {
    if (op.type === "text") {
      const s = op.style;
      if (s.spacing) page.pushOperators(setCharacterSpacing(s.spacing));
      page.drawText(op.text, { x: op.x, y: PAGE_H - op.baseline, size: s.size, font: s.font, color: hex(s.color) });
      if (s.spacing) page.pushOperators(setCharacterSpacing(0));
    } else if (op.type === "image") {
      page.drawImage(op.img, { x: op.x, y: PAGE_H - op.top - op.h, width: op.w, height: op.h });
    } else if (op.type === "photo") {
      page.drawImage(op.img, { x: op.x, y: PAGE_H - op.top - op.h, width: op.w, height: op.h });
    } else if (op.type === "rule") {
      page.drawLine({ start: { x: op.x0, y: PAGE_H - op.y }, end: { x: op.x1, y: PAGE_H - op.y }, thickness: 0.6, color: hex(COLORS.rule) });
    }
  }
  for (const l of result.links) {
    const annot = doc.context.register(doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [l.x0, PAGE_H - l.bottom, l.x1, PAGE_H - l.top],
      Border: [0, 0, 0],
      A: { Type: "Action", S: "URI", URI: PDFString.of(l.url) },
    }));
    page.node.addAnnot(annot);
  }

  return { bytes: await doc.save(), fontSize, lineHeight, wrapped: result.wrapped, links: result.links.length };
}
