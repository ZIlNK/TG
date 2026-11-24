import { test } from "node:test";
import assert from "node:assert/strict";
import { sceneByLocation, sceneFor } from "../src/client/scene/locations";
import { timeWeights } from "../src/client/scene/time";

const near = (actual: number, expected: number, tolerance = 1e-9): void => {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} is not within ${tolerance} of ${expected}`,
  );
};

test("scene light peaks at the four art times and stays continuous", () => {
  const expected: [number, number[]][] = [
    [6 * 60, [1, 0, 0, 0]],
    [12 * 60, [0, 1, 0, 0]],
    [18 * 60, [0, 0, 1, 0]],
    [0, [0, 0, 0, 1]],
    [9 * 60, [0.5, 0.5, 0, 0]],
    [15 * 60, [0, 0.5, 0.5, 0]],
    [21 * 60, [0, 0, 0.5, 0.5]],
  ];
  for (const [minute, weights] of expected) {
    timeWeights(minute).forEach((weight, index) =>
      near(weight, weights[index]),
    );
  }
});

test("scene light weights are normalised and non-negative all day", () => {
  for (let minute = 0; minute < 1440; minute += 7) {
    const weights = timeWeights(minute);
    assert.equal(weights.length, 4);
    assert.ok(weights.every((weight) => weight >= 0 && weight <= 1));
    near(
      weights.reduce((sum, weight) => sum + weight, 0),
      1,
    );
    assert.ok(new Set(weights.filter((weight) => weight > 0)).size <= 2);
  }
});

test("every game area maps to its scene and unknown areas fall back by region", () => {
  const ids = [
    "Bedroom/bedroom_main",
    "Street/street_main",
    "Street/food_stall",
    "Street/convenience_store_entrance",
    "Street/bus_stop",
    "Park/park_entrance",
    "Park/park_path",
    "Park/fountain",
    "Park/benches",
    "Shop/shop_entrance",
    "Shop/shop_aisles",
    "Shop/shop_counter",
  ];
  ids.forEach((id) => assert.equal(sceneFor(id), sceneByLocation[id]));
  assert.equal(sceneFor("Park/some_new_area"), "park");
  assert.equal(sceneFor("Unknown/place"), "street");
});