// Order of the cards in a review session: "due" = oldest due date first (default), "random" = shuffled.
export const ORDERS = { due: "Theo hạn (cũ nhất trước)", random: "Ngẫu nhiên" };

// Fisher-Yates shuffle on a copy. rnd() returns a number in [0, 1), so tests can pass a fixed sequence.
export function shuffle(list, rnd = Math.random) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function orderQueue(list, mode, rnd = Math.random) {
  return mode === "random" ? shuffle(list, rnd) : [...list].sort((a, b) => a.due - b.due);
}

export const normOrder = v => (v === "random" ? "random" : "due");
