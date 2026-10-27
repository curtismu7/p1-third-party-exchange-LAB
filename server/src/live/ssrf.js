// SSRF guard for the ONE user-typed third-party origin of the "Real exchange (local)" tab. https only, no credentials in the URL, no IP
// literals, no localhost or internal-looking names, and every address the name resolves to must be public. (Loopback http is allowed only
// when the app is pointed at the test stub.) The check on resolved addresses narrows, but cannot fully close, a DNS-rebinding window between
// this lookup and the fetch's own lookup; the owner types the URL themselves and runs this locally.
import net from 'node:net';
import dns from 'node:dns';
import { isLoopbackHost } from '../safety.js';

export class UrlRefused extends Error { constructor(message) { super(message); this.code = 'refused_url'; } }

const v4 = (a) => a.split('.').map(Number);
export function isPrivateAddress(addr) {
  let a = String(addr).toLowerCase().replace(/^\[|\]$/g, '');
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (mapped) a = mapped[1];
  if (net.isIPv4(a)) {
    const [p, q] = v4(a);
    return p === 0 || p === 10 || p === 127 || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) || (p === 100 && q >= 64 && q <= 127) || (p === 192 && q === 0) || (p === 198 && (q === 18 || q === 19)) || p >= 224;
  }
  if (net.isIPv6(a)) return a === '::' || a === '::1' || /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || /^ff/.test(a) || a.startsWith('64:ff9b');
  return true; // not an address we understand: refuse
}

/** Returns the parsed URL or throws UrlRefused. `stub` (a loopback http origin) is the test stand-in and is the only loopback exception. */
export function checkPublicUrl(raw, { stub = false } = {}) {
  if (typeof raw !== 'string' || raw.length > 2000 || /[\s\u0000-\u001f\\]/.test(raw)) throw new UrlRefused('not a plain URL');
  let u;
  try { u = new URL(raw); } catch { throw new UrlRefused('not a URL'); }
  if (u.username || u.password) throw new UrlRefused('credentials in the URL');
  if (stub && u.protocol === 'http:' && isLoopbackHost(u.hostname)) return u;
  if (u.protocol !== 'https:') throw new UrlRefused('https only');
  const host = u.hostname.toLowerCase();
  if (net.isIP(host.replace(/^\[|\]$/g, '')) || host.startsWith('[')) throw new UrlRefused('IP addresses are not allowed: use a host name');
  if (!host.includes('.') || host === 'localhost' || /\.(localhost|local|internal|lan|home|corp|invalid)$/.test(host)) throw new UrlRefused('internal-looking host name');
  if (/^[0-9.]+$/.test(host) || /^0x/i.test(host)) throw new UrlRefused('numeric host name');
  if (u.port && !/^\d{1,5}$/.test(u.port)) throw new UrlRefused('bad port');
  return u;
}

/** Resolve the host and refuse unless EVERY address is public. `lookup` is injectable for tests. */
export async function assertPublicHost(host, lookup = (h) => dns.promises.lookup(h, { all: true })) {
  let addrs;
  try { addrs = await lookup(host); } catch { throw new UrlRefused('the host name does not resolve'); }
  if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) throw new UrlRefused('the host resolves to a private, loopback or link-local address');
  return addrs;
}
