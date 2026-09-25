/**
 * Which build is the deployed API actually serving?
 *
 *   node scripts/check-deployed-build.js
 *   node scripts/check-deployed-build.js --url=https://skims.onrender.com
 *   node scripts/check-deployed-build.js --quiet        # one line, for a cron or a pre-demo check
 *
 * Exit codes: 0 current · 1 stale · 2 unreachable. So this can gate something later.
 *
 * ## Why this exists
 *
 * On 2026-09-25 the live API was found serving code from 2026-08-19 — 38 days and five merged PRs
 * behind — while the Netlify frontend was current. A September frontend against an August backend
 * produced a dead barangay filter, 404s on programme approval, and registrations silently landing
 * as the retired `public_user` role. All of it looked like application bugs, and none of it was.
 *
 * The cause recurs. Render's free tier has suspended roughly monthly, and **a suspended service does
 * not queue deploys** — pushes that land while it is down are dropped, not replayed. When the
 * allotment resets the service resumes its last built image and serves it indefinitely. Nothing
 * announces this: `/api/health` returns 200 the whole time, because the old build is perfectly
 * healthy. It is simply old.
 *
 * So health checks cannot answer the question. Only behaviour can.
 *
 * ## How the markers work, and the trap to avoid
 *
 * Each marker is a request whose RESPONSE differs between builds, paired with the commit that made
 * it so. The newest marker that passes is the floor: the build is at least that recent.
 *
 * ⚠️ A marker is only valid on a router WITHOUT a blanket `protect`. `routes/youth.js` and
 * `routes/users.js` call `router.use(protect)`, so every path under them answers 401 whether the
 * route exists or not — and `/documents/recycle-bin` is swallowed by `/:id` for the same reason.
 * Probing those will tell you a route exists when it does not. This cost an hour the first time.
 *
 * Safe routers: /api/auth, /api/programs, /api/municipalities, /api/public.
 *
 * To add a marker when you ship something: pick a route on a safe router, give it the date and
 * commit, and put it at the end of the list.
 */
const MARKERS = [
  {
    date: '2026-06-17',
    commit: 'first commit',
    what: 'baseline API',
    // 422 (validation) proves the route exists; 404 would mean this is not SKIMS at all.
    check: async (base) => (await status(base, 'POST', '/api/auth/resend-verification')) === 422,
  },
  {
    date: '2026-08-28',
    commit: 'a0993f4',
    what: 'programme approval workflow',
    // 401 = the route is there and wants auth. 404 = it does not exist in this build.
    check: async (base) => (await status(base, 'PATCH', '/api/programs/000000000000000000000000/submit')) === 401,
  },
  {
    date: '2026-08-28',
    commit: '3d04b47',
    what: 'municipality required at registration',
    /*
     * The most reliable marker of the set, and it creates nothing: the payload fails validation in
     * every build, so no account is made either way. What changes is the ERROR LIST — older builds
     * do not mention the municipality at all.
     */
    check: async (base) => {
      const body = await json(base, 'POST', '/api/auth/register', { role: 'sk_chairperson' });
      return (body?.errors || []).some((e) => /municipality is required/i.test(e.msg || ''));
    },
  },
  {
    date: '2026-09-04',
    commit: 'PR #4',
    what: 'province-wide barangay list',
    check: async (base) => (await status(base, 'GET', '/api/municipalities/barangays')) === 200,
  },
  {
    date: '2026-09-25',
    commit: 'PR #9',
    what: 'barangay scope round (email-change request)',
    check: async (base) => (await status(base, 'POST', '/api/auth/me/email-change')) === 401,
  },
];

const BASE = (process.argv.find((a) => a.startsWith('--url=')) || '--url=https://skims.onrender.com')
  .slice('--url='.length)
  .replace(/\/$/, '');
const QUIET = process.argv.includes('--quiet');

const TIMEOUT_MS = 30000;

/** Render's free tier sleeps after ~15 minutes idle and takes ~50s to wake, so be patient once. */
const request = async (base, method, path, body) => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return res;
};

const status = async (base, method, path) => (await request(base, method, path)).status;

const json = async (base, method, path, body) => {
  const res = await request(base, method, path, body);
  try {
    return await res.json();
  } catch (_) {
    return null;
  }
};

const run = async () => {
  if (!QUIET) console.log(`\nChecking ${BASE}\n`);

  try {
    const health = await status(BASE, 'GET', '/api/health');
    if (health !== 200) {
      console.error(`API is not healthy (/api/health returned ${health}).`);
      process.exit(2);
    }
  } catch (err) {
    // A suspended Render service serves an HTML "Service Suspended" page rather than refusing.
    console.error(`Could not reach ${BASE}: ${err.message}`);
    process.exit(2);
  }

  let floor = null;
  const results = [];

  for (const marker of MARKERS) {
    let present;
    try {
      present = await marker.check(BASE);
    } catch (err) {
      present = null; // inconclusive rather than absent — do not report a timeout as a stale build
    }
    results.push({ ...marker, present });
    if (present === true) floor = marker;
  }

  if (!QUIET) {
    results.forEach((r) => {
      const mark = r.present === true ? '✓' : r.present === false ? '✗' : '?';
      console.log(`  ${mark}  ${r.date}  ${String(r.commit).padEnd(13)} ${r.what}`);
    });
    console.log('');
  }

  const newest = MARKERS[MARKERS.length - 1];
  const current = floor === newest;

  if (current) {
    console.log(`Deployed build is CURRENT as far as these markers reach (${newest.date}, ${newest.commit}).`);
    if (!QUIET) console.log('Add a marker for anything shipped after that, or this stops being able to tell.\n');
    process.exit(0);
  }

  const missing = results.filter((r) => r.present === false);
  console.log(`⚠️  Deployed build is STALE. Newest confirmed: ${floor ? `${floor.date} (${floor.commit})` : 'none — older than every marker'}.`);
  console.log(`   Missing: ${missing.map((m) => `${m.what} (${m.date})`).join(', ')}`);
  if (!QUIET) {
    console.log('\n   Render dashboard → the service → Manual Deploy → Deploy latest commit.');
    console.log('   Then check Settings → Build & Deploy: Auto-Deploy = Yes, Branch = main, GitHub still authorised.');
    console.log('   A suspension drops pushes silently; it does not queue them.\n');
  }
  process.exit(1);
};

run().catch((err) => {
  console.error('Check failed:', err.message);
  process.exit(2);
});
