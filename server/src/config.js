// Deployment configuration: the MODE switch (rule 18). One image serves the local standalone and the hosted SE build.
// MODE=mock is the default. MODE=live is only a REQUEST: live.gate (live/gate.js) decides whether it is honoured (it needs
// P1TPX_ALLOW_LIVE=1, a loopback bind and a non-hosted build); the hosted image can never pass. Any other value is an error.
export function modeFrom(env = process.env) {
  const m = env.MODE === undefined || env.MODE === '' ? 'mock' : env.MODE;
  if (m !== 'mock' && m !== 'live') throw new Error(`MODE=${String(m).slice(0, 20)} is not available: use mock (default) or live (owner-run, local only)`);
  return m;
}

// P1TPX_HOSTED=1 marks the SE build: the banner says HOSTED SIMULATION. It changes wording only, never behaviour.
export const hostedFrom = (env = process.env) => env.P1TPX_HOSTED === '1';
