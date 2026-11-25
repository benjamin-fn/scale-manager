import test from 'node:test'
import assert from 'node:assert/strict'
import { money, toDisplay, toSek } from '../src/currency.mjs'

test('SEK and USD preserve equivalent values at the illustrative exchange rate', () => {
  for (const amount of [0, 10.01, 1234.56, 200000]) {
    assert.equal(toSek(toDisplay(amount, 'en'), 'en'), amount)
    assert.equal(toDisplay(amount, 'sv'), amount)
  }
  assert.equal(money(1250, 'en'), '$125')
  assert.match(money(1250, 'sv'), /1\s250\s+kr/)
})
