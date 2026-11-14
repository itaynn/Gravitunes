// Shared validation corpus: the Python validator (python/tests/test_corpus.py) runs the same file.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateScore } from "../../js/score.js";

const corpus = JSON.parse(readFileSync(new URL("../fixtures/validation-corpus.json", import.meta.url), "utf8"));

for (const c of corpus.cases) {
  test(`corpus: ${c.name}`, () => {
    const r = validateScore(c.score);
    assert.equal(r.valid, c.valid, `expected ${c.valid ? "valid" : "invalid"}; errors: ${r.errors.join("; ")}`);
  });
}
