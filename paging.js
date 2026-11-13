// Library list helpers: filter, index and paging. Pure functions (no DOM), so they are easy to test.
export const PAGE_SIZE = 40;   // cards drawn at first, and added each time the reader scrolls to the end

// One pass over the cards: id -> card, and how many expressions (kids) each sentence has.
// (The list used to search the whole array for every card: 1,000 cards = 1,000,000 steps per redraw.)
export function buildIndex(items) {
  const byId = new Map(), kids = new Map();
  for (const i of items) {
    byId.set(i.id, i);
    if (i.sourceId) kids.set(i.sourceId, (kids.get(i.sourceId) || 0) + 1);
  }
  return { byId, kids };
}

// type: "" = all. tag: "" = all. query: already lower-case.
export function filterItems(items, { type = "", tag = "", query = "" } = {}) {
  return items.filter(i =>
    (!type || i.type === type) && (!tag || i.tags.includes(tag)) &&
    (!query || [i.text, i.meaning, i.example, i.note, i.original].join(" ").toLowerCase().includes(query)));
}

// How many cards to show after one more page.
export const nextShown = (shown, total, size = PAGE_SIZE) => Math.min(total, Math.max(0, shown) + size);

// "Hiển thị 40 / 1000": numbers for the footer under the list.
export function pageInfo(shown, total, size = PAGE_SIZE) {
  const n = Math.min(shown, total);
  return { shown: n, total, more: n < total, next: Math.min(size, total - n) };
}
