import assert from "node:assert/strict";
import { shuffle, orderQueue, normOrder } from "../review-order.js";
let t = 0; const ok = (name, fn) => { fn(); t++; console.log("ok -", name); };
const cards = [5, 1, 4, 2, 3].map(due => ({ id: "c" + due, due }));

ok("shuffle keeps every card exactly once and does not change the input", () => {
  const before = JSON.stringify(cards), out = shuffle(cards);
  assert.equal(JSON.stringify(cards), before);
  assert.deepEqual(out.map(c => c.id).sort(), cards.map(c => c.id).sort());
});
ok("shuffle follows the random numbers it is given (deterministic in tests)", () => {
  assert.deepEqual(shuffle([1, 2, 3, 4], () => 0).join(), "2,3,4,1");
  assert.deepEqual(shuffle([1, 2, 3, 4], () => 0.999).join(), "1,2,3,4");
  assert.deepEqual(shuffle([], () => 0.5), []);
  assert.deepEqual(shuffle([7], () => 0.5), [7]);
});
ok("every position can get every card (uniform enough over many shuffles)", () => {
  const seen = new Set();
  for (let i = 0; i < 400; i++) seen.add(shuffle([1, 2, 3])[0]);
  assert.equal(seen.size, 3);
});
ok("orderQueue: due = oldest due first, random = shuffled copy, input untouched", () => {
  assert.deepEqual(orderQueue(cards, "due").map(c => c.due), [1, 2, 3, 4, 5]);
  assert.deepEqual(orderQueue(cards, "random", () => 0).map(c => c.id), shuffle(cards, () => 0).map(c => c.id));
  assert.deepEqual(cards.map(c => c.due), [5, 1, 4, 2, 3]);
});
ok("normOrder only accepts the two known values", () => {
  assert.equal(normOrder("random"), "random");
  for (const v of ["due", "", null, undefined, "x"]) assert.equal(normOrder(v), "due");
});
console.log(`\n${t} tests passed`);
