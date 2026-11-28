import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DEFAULT_CAST, DEFAULT_VERTICAL, VERTICALS, fill, unfilled, verticalFrom } from '../src/cast.js';
import * as D from '../src/exchangeData.js';
import { withServer } from './helpers.js';

// The brands the family has retired or that belong to the other packs. None may show in the airline run.
const RETIRED = /Northwind|Contoso|Fabrikam|Harbor|Vellum|Meridian|Skyline|Tessera|Larkspur|retail|orders-app|claims-app|payments-app/i;
const post = (url, body, vertical = '') => fetch(`${url}/api/exchange${vertical ? `?vertical=${vertical}` : ''}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: url }, body: JSON.stringify(body) });

test('the default vertical is airlines: AirGuard Airlines, a fictional airline on .example hosts', () => {
  assert.equal(DEFAULT_VERTICAL, 'airlines');
  assert.equal(DEFAULT_CAST, VERTICALS.airlines);
  assert.deepEqual(DEFAULT_CAST, { castBrand: 'AirGuard Airlines', castApp: 'booking-app', castResource: 'booking', castHost: 'airguard' });
  assert.equal(verticalFrom('does-not-exist'), 'airlines', 'an unknown vertical falls back to the airline default');
  assert.equal(verticalFrom('retail'), 'retail');
  assert.match(fill('{{castBrand}} is a made-up customer', DEFAULT_CAST), /^AirGuard Airlines is a made-up customer/);
  assert.deepEqual(unfilled('{{castBrand}} {{castApp}} {{castResource}} {{castHost}} {{castNope}}', DEFAULT_CAST), ['castNope'], 'the airline pack defines all four tokens');
});

test('a fresh run with no config shows AirGuard Airlines and no retired brand in the airline run: vendors, setup, every diagram, every exchange, the wire and the setup calls', async () => {
  await withServer(async (url) => {
    const seen = [];
    const vendors = await (await fetch(`${url}/api/vendors`)).json();
    assert.equal(vendors.cast.castBrand, 'AirGuard Airlines');
    assert.deepEqual(vendors.verticals.sort(), ['airlines', 'finance', 'health', 'retail']);
    const { verticals, ...rendered } = vendors; // the selector lists the other pack ids by name
    seen.push(JSON.stringify(rendered), JSON.stringify(await (await fetch(`${url}/api/setup`)).json()), JSON.stringify(await (await fetch(`${url}/api/compare`)).json()));
    for (const v of D.VENDORS) {
      for (const tokenState of ['valid', 'expired', 'wrong-issuer', 'bad-signature']) {
        const j = await (await post(url, { vendorId: v.id, tokenState })).json();
        seen.push(JSON.stringify(j));
        seen.push(JSON.stringify(await (await fetch(`${url}/api/diagram?vendorId=${v.id}&tokenState=${tokenState}`)).json()));
      }
      seen.push(JSON.stringify(await (await fetch(`${url}/api/diagram?vendorId=${v.id}&nbfRequired=true`)).json()));
    }
    seen.push(JSON.stringify(await (await fetch(`${url}/api/wire`)).json()));
    const text = seen.join('\n');
    assert.ok(text.includes('AirGuard Airlines') && text.includes('booking-app') && text.includes('api.airguard.example/booking'));
    assert.equal(text.match(RETIRED), null, `retired brand in the airline run: ${text.match(RETIRED)?.[0]}`);
  });
});

test('the checked-in talk track, content pack and example config carry the airline default', () => {
  const root = new URL('../../', import.meta.url);
  for (const f of ['docs/talk-track.md', 'content-pack.json', 'customer.config.example.json']) {
    const text = fs.readFileSync(new URL(f, root), 'utf8');
    assert.equal(text.match(RETIRED), null, `${f}: ${text.match(RETIRED)?.[0]}`);
  }
  assert.match(fs.readFileSync(new URL('docs/talk-track.md', root), 'utf8'), /AirGuard Airlines is a made-up customer/);
});

test('retail, health and finance still render their own brand and no airline wording; a saved config that names another brand keeps working', async () => {
  const brands = { retail: 'Northwind Retail', health: 'Contoso Health', finance: 'Fabrikam Bank' };
  await withServer(async (url) => {
    for (const [id, brand] of Object.entries(brands)) {
      const j = await (await fetch(`${url}/api/vendors?vertical=${id}`)).json();
      assert.equal(j.cast.castBrand, brand);
      assert.ok(JSON.stringify(j).includes(brand), id);
      assert.ok(!/AirGuard|airguard|booking/.test(JSON.stringify(j)), `${id} leaks the airline`);
      const run = await (await post(url, { vendorId: 'okta' }, id)).json();
      assert.equal(run.ok, true, id);
    }
  });
});
