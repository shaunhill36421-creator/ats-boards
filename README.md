# ats-boards

Read job listings straight from the ATS a company actually uses: **Workday, Greenhouse, Ashby, Lever, Workable, SmartRecruiters, BambooHR, Breezy, Personio, Recruitee and Rippling**. One function, one normalized job record, no proxies.

```js
import { fetchJobs } from './src/ats.mjs';

const jobs = await fetchJobs('greenhouse', 'stripe', { limit: 50 });
// [{ ats, companySlug, jobId, title, url, location, department,
//    remote, employmentType, postedAt, compensation, description }]
```

## Why this exists

Job-board scrapers fight anti-bot systems every day: residential proxies, blocked runs, broken selectors. But the companies themselves publish their openings on purpose, as JSON, on endpoints that are not defending themselves against you. Reading those endpoints is cheaper, faster and does not break.

This repo is the adapter layer: eleven platforms, one shape.

## Supported platforms

| Platform | Board reference | Example |
|---|---|---|
| Greenhouse | `slug` | `stripe` |
| Ashby | `slug` | `ramp` |
| Lever | `slug` | `spotify` |
| Workable | `slug` | `skroutz` |
| SmartRecruiters | `slug` | `SmartRecruiters` |
| BambooHR | `subdomain` | `zapier` |
| Breezy | `subdomain` | `breezy` |
| Personio | `subdomain` | `personio` |
| Recruitee | `subdomain` | `bunq` |
| Rippling | `board slug` | `rippling` |
| Workday | `tenant.wdN/SiteName` | `nvidia.wd5/NVIDIAExternalCareerSite` |

### The Workday catch

Workday is where most large employers live and it is the one platform you cannot guess from a careers page, because the board is almost never linked from it. You need three pieces: the **tenant**, the **pod** (`wd1`, `wd3`, `wd5`, `wd10`, `wd12`…) and the **site name**. Listings come from a POST to:

```
https://<tenant>.<pod>.myworkdayjobs.com/wday/cxs/<tenant>/<site>/jobs
```

A second trap: a company's careers link can point at a **different** tenant after an acquisition, so `hopin.com` resolves to RingCentral's board and quietly returns the wrong company's jobs. Check that the domain still appears in the board reference before you trust it.

## Rate limits, honestly

`429` means slow down, not "board is dead". Neither does a `303` to `community.workday.com/maintenance-page`: Workday patches one pod at a time, so every tenant on `wd1` or `wd5` can fail together for hours while the boards themselves are fine. Keep `redirect: 'manual'` on the Workday POST or that window reaches you as an unexplained HTML parse error. Workable in particular will rate-limit a burst of parallel requests. Retry with backoff and respect `Retry-After`; never delete a board from your list because one burst returned 429.

## How this actually works

A longer write-up of the eleven endpoints and the four traps that cost real time (Workday's hidden tenant/pod/site, careers links that belong to a parent company after an acquisition, why `429` must never be read as "board is dead", and the maintenance redirect that fails a whole pod at once):

**[docs/reading-ats-job-boards.md](docs/reading-ats-job-boards.md)**

## Hosted version

If you want this as a ready-to-run API with **709 companies already resolved** (Nike, Target, Comcast, Caterpillar, Chevron, HP, Medtronic, 3M, NVIDIA, Stripe and 699 more, 92 of them on Workday), holding **106,829 open roles** when last counted, it runs on Apify:

**https://apify.com/alexdany/company-jobs-api**

Give it a company domain, or no companies at all and a keyword, and it returns normalized jobs. From $1.50 per 1,000 jobs.

## License

MIT.
