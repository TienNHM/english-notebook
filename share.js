// Sharing achievements: text, social links and a share-card image drawn on a canvas.
// The image is drawn on the user's device. It has no name or email, only numbers and badge icons.

export const SITE_URL = "https://english-notebook.tiennhm.io.vn/";
export const SITE_HOST = "english-notebook.tiennhm.io.vn";

// d = { streak, best, level, xp, reviews, badges, badgesTotal, icons[], cards }
export function shareText(d) {
  const bits = [];
  if (d.streak > 0) bits.push(`🔥 ${d.streak}-day streak`);
  bits.push(`Level ${d.level}`);
  if (d.reviews > 0) bits.push(`${d.reviews} cards recalled`);
  if (d.badges > 0) bits.push(`${d.badges}/${d.badgesTotal} badges`);
  return `${bits.join(" · ")} on English Notebook! I'm learning English from what I read and write at work. 📒`;
}

// Links that open each site's own share page with the text and the link filled in.
// (They cannot attach the image: the user adds the downloaded image there.)
export function shareLinks(text, url = SITE_URL) {
  const t = encodeURIComponent(text), u = encodeURIComponent(url);
  return {
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${u}&quote=${t}`,
    x: `https://x.com/intent/post?text=${t}&url=${u}&hashtags=EnglishLearning`,
    linkedin: `https://www.linkedin.com/sharing/share-offsite/?url=${u}`,
    telegram: `https://t.me/share/url?url=${u}&text=${t}`,
  };
}

// ---------- canvas drawing (neo-brutalism, same look as the app) ----------
const C = { paper: "#fff8e7", ink: "#111111", yellow: "#ffd93d", pink: "#ff7eb6", blue: "#6bc5ff", green: "#79e08a", violet: "#b69cff" };
const FONT = `system-ui, "Segoe UI", "Helvetica Neue", Arial, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif`;
const font = (px, w = 800) => `${w} ${px}px ${FONT}`;

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function box(ctx, x, y, w, h, { fill, r = 26, bw = 6, sh = 10 }) {
  rr(ctx, x + sh, y + sh, w, h, r); ctx.fillStyle = C.ink; ctx.fill();
  rr(ctx, x, y, w, h, r); ctx.fillStyle = fill; ctx.fill();
  ctx.lineWidth = bw; ctx.strokeStyle = C.ink; ctx.stroke();
}
function text(ctx, s, x, y, { size, w = 800, align = "left", color = C.ink, base = "alphabetic" }) {
  ctx.font = font(size, w); ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = base;
  ctx.fillText(s, x, y);
}
function wrap(ctx, s, maxW) {
  const lines = []; let line = "";
  for (const word of s.split(" ")) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = word; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}
function background(ctx, w, h) {
  ctx.fillStyle = C.paper; ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "rgba(17,17,17,.22)";
  for (let y = 16; y < h; y += 32) for (let x = 16; x < w; x += 32) { ctx.beginPath(); ctx.arc(x, y, 2.2, 0, 6.3); ctx.fill(); }
}
function chip(ctx, label, x, y, h, size, fill) { // returns the width used
  ctx.font = font(size);
  const w = ctx.measureText(label).width + h * 0.9;
  box(ctx, x, y, w, h, { fill, r: h / 2, bw: 5, sh: 6 });
  text(ctx, label, x + w / 2, y + h / 2 + 1, { size, align: "center", base: "middle" });
  return w;
}

// Draws the card into `canvas`. opts.wide = 1200x630 (link preview), otherwise 1080x1080 (feed).
// opts.promo = generic card for the link preview (no personal numbers).
export function drawShareCard(canvas, d, opts = {}) {
  const wide = !!opts.wide, W = wide ? 1200 : 1080, H = wide ? 630 : 1080;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  background(ctx, W, H);
  if (opts.promo) return drawPromo(ctx, W, H);

  const big = d.streak > 0 ? { icon: "🔥", n: d.streak, label: "day streak" } : { icon: "📚", n: d.cards || 0, label: "cards saved" };
  const stats = [
    { v: `Lv ${d.level}`, l: "level", fill: C.violet },
    { v: String(d.reviews), l: "cards recalled", fill: C.green },
    { v: `${d.badges}/${d.badgesTotal}`, l: "badges", fill: C.blue },
  ];
  const icons = (d.icons || []).slice(0, wide ? 6 : 8).join("  ");

  if (!wide) {
    chip(ctx, "📒 English Notebook", 70, 70, 74, 40, C.yellow);
    box(ctx, 70, 190, 940, 500, { fill: C.yellow, r: 40, bw: 8, sh: 14 });
    text(ctx, big.icon, 540, 335, { size: 130, align: "center", base: "middle" });
    text(ctx, String(big.n), 540, 515, { size: String(big.n).length > 3 ? 170 : 220, w: 900, align: "center", base: "middle" });
    text(ctx, big.label, 540, 645, { size: 54, align: "center", base: "middle" });
    stats.forEach((s, i) => {
      const x = 70 + i * 325;
      box(ctx, x, 770, 290, 150, { fill: s.fill, r: 28, bw: 6, sh: 9 });
      text(ctx, s.v, x + 145, 830, { size: 60, align: "center", base: "middle" });
      text(ctx, s.l, x + 145, 888, { size: 28, w: 700, align: "center", base: "middle" });
    });
    if (icons) text(ctx, icons, 540, 985, { size: 56, align: "center", base: "middle" });
    text(ctx, SITE_HOST, 540, 1046, { size: 30, w: 700, align: "center", base: "middle" });
  } else {
    chip(ctx, "📒 English Notebook", 50, 40, 64, 34, C.yellow);
    box(ctx, 50, 140, 500, 420, { fill: C.yellow, r: 36, bw: 8, sh: 12 });
    text(ctx, big.icon, 300, 235, { size: 100, align: "center", base: "middle" });
    text(ctx, String(big.n), 300, 385, { size: String(big.n).length > 3 ? 150 : 190, w: 900, align: "center", base: "middle" });
    text(ctx, big.label, 300, 480, { size: 46, align: "center", base: "middle" });
    stats.forEach((s, i) => {
      const y = 140 + i * 142;
      box(ctx, 620, y, 530, 116, { fill: s.fill, r: 26, bw: 6, sh: 8 });
      text(ctx, s.v, 660, y + 58, { size: 56, base: "middle" });
      text(ctx, s.l, 1110, y + 60, { size: 30, w: 700, align: "right", base: "middle" });
    });
    if (icons) text(ctx, icons, 885, 590, { size: 40, align: "center", base: "middle" });
    text(ctx, SITE_HOST, 1150, 40 + 32, { size: 26, w: 700, align: "right", base: "middle" });
  }
}

function drawPromo(ctx, W, H) {
  box(ctx, 50, 50, W - 100 - 12, H - 100 - 12, { fill: C.yellow, r: 40, bw: 8, sh: 14 });
  text(ctx, "📒", 150, 170, { size: 110, base: "middle" });
  text(ctx, "English Notebook", 90, 305, { size: 100, w: 900 });
  ctx.font = font(40, 700);
  const lines = wrap(ctx, "Learn English from what you read and write at work.", W - 160);
  lines.forEach((ln, i) => text(ctx, ln, 92, 380 + i * 54, { size: 40, w: 700 }));
  let x = 92; const y = 470;
  for (const [label, fill] of [["🔥 Daily streak", C.pink], ["🧠 Spaced review", C.green], ["💬 Context cards", C.blue]]) x += chip(ctx, label, x, y, 70, 32, fill) + 26;
  text(ctx, SITE_HOST, W - 90, 105, { size: 26, w: 700, align: "right", base: "middle" });
}
