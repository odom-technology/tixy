/* The pure SHA-256 fallback must match node:crypto byte for byte, since
   slots and plinko rebuild a round's animation from it. */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';

import { sha256Pure } from '../src/features/arcade/lib/sha256';

const cases: Uint8Array[] = [new Uint8Array(0), new TextEncoder().encode('abc')];
for (let len = 1; len <= 200; len++) cases.push(new Uint8Array(randomBytes(len)));
for (let i = 0; i < 500; i++) cases.push(new TextEncoder().encode(`${Math.floor(Math.random() * 2 ** 31)}:plinko-path`));
for (const bytes of cases) {
  const expected = createHash('sha256').update(bytes).digest('hex');
  const actual = Buffer.from(sha256Pure(bytes)).toString('hex');
  assert.equal(actual, expected, `sha256 of ${bytes.length} bytes`);
}
console.log(`sha256 fallback matches node:crypto on ${cases.length} inputs`);
