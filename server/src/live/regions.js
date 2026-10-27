// PingOne regions -> top-level domain. The host names are built from parts, never written out whole.
export const REGIONS = { com: 'com', eu: 'eu', asia: 'asia', ca: 'ca', au: 'com.au', 'com.au': 'com.au', sg: 'sg' };
export const regionTld = (region) => (Object.hasOwn(REGIONS, region) ? REGIONS[region] : null);
export const authHost = (tld) => ['auth', 'pingone', tld].join('.');
export const apiHost = (tld) => ['api', 'pingone', tld].join('.');
export const ENV_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
