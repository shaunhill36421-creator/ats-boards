# Reading job boards straight from an ATS

Most job data is scraped the hard way: point a crawler at Indeed or LinkedIn, buy residential proxies, fight the anti-bot system, watch runs fail, repeat. That work exists because the aggregator does not want you there.

The companies themselves are the opposite. They publish their openings on purpose, in JSON, on endpoints that are not defending themselves, because an unseen job posting is a job posting that failed. If you read those endpoints instead, there is nothing to get past.

This is a map of the ten applicant tracking systems that cover most of the market, and the four traps that cost real time.

## The ten platforms

| Platform | Board reference | Shape of the endpoint |
|---|---|---|
| Greenhouse | `slug` | `boards-api.greenhouse.io/v1/boards/<slug>/jobs` |
| Ashby | `slug` | GraphQL POST against the public job board API |
| Lever | `slug` | `api.lever.co/v0/postings/<slug>` |
| Workable | `slug` | `apply.workable.com/api/v1/widget/accounts/<slug>` |
| SmartRecruiters | `slug` | `api.smartrecruiters.com/v1/companies/<slug>/postings` |
| BambooHR | `subdomain` | `<subdomain>.bamboohr.com/careers/list` |
| Breezy | `subdomain` | `<subdomain>.breezy.hr/json` |
| Personio | `subdomain` | `<subdomain>.jobs.personio.de/search.json` |
| Rippling | `board slug` | `api.rippling.com/platform/api/ats/v1/board/<slug>/jobs` |
| Workday | `tenant.wdN/SiteName` | POST `…/wday/cxs/<tenant>/<site>/jobs` |

Nine of those take a single slug you can usually read off the company's careers link. Then there is Workday.

## Trap 1: Workday needs three pieces, and hides all of them

Workday is where most large employers live, and its board reference is not one value but three: the **tenant**, the **pod** (`wd1`, `wd3`, `wd5`, `wd10`, `wd12`…) and the **site name**, which the company chooses. `nvidia.wd5/NVIDIAExternalCareerSite` and `micron.wd1/External` are both normal.

None of that is derivable from the domain. Worse, the board is usually not linked from the careers page at all: the page is a marketing site that funnels you through a redirect. So you either read the company's own pages and follow the trail, or you probe the combinations.

Probing works because a wrong guess fails cheaply:

```js
const r = await fetch(
  `https://${tenant}.${pod}.myworkdayjobs.com/wday/cxs/${tenant}/${site}/jobs`,
  { method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: '' }) },
);
const total = r.ok ? (await r.json())?.total : 0;   // > 0 means this board is real
```

The tenant is usually the domain's base word, sometimes shortened: Caterpillar is `cat`, Prudential is `pru`, Duke Energy is `dukeenergy`. Site names cluster hard: `External`, `ExternalCareerSite`, `Careers`, `Search`, `External_Experienced`, `jobs`. Seven pods times twenty site names is 140 cheap requests per company, and it resolves a large share of the Fortune 500.

Also note Workday caps a listing call at 20 results, reports the true count in `total`, and its list pages carry no description, no exact date and no employment type. Those cost one extra request per job, so make them optional.

## Trap 2: a careers link can belong to a different company

After an acquisition, the careers page of the acquired brand often points at the parent's board. Ask for `hopin.com` and a naive resolver happily returns RingCentral's openings. Nothing errors. You just quietly ship the wrong company's jobs, and whoever consumes your data has no way to notice.

The cheap guard is to require that the domain still appears inside the board reference before accepting a cross-tenant match:

```js
const belongs = (domain, slug) => {
  const base = domain.replace(/^www\./, '').split('.')[0].toLowerCase();
  return slug.toLowerCase().includes(base);
};
```

It is not perfect, and short names need a second look: a board slug of `up` is not Union Pacific, and `hilton.breezy.hr` is a single franchise office rather than Hilton Worldwide. Verify short or generic slugs by eye: fetch one job and read its title and URL.

## Trap 3: 429 is not a dead board

Write a checker that walks your company list and drops anything that fails, run it with eight requests in parallel, and Workable will rate-limit you. If "failed" means "delete", you have just thrown away live companies and you will not find out until someone asks why their board disappeared.

Only `404` and `410` mean gone. `429` means slow down. A timeout means the network, not the company.

```js
if (/\b(404|410)\b/.test(err.message)) dead.push(entry);
else suspect.push(entry);          // retried later, serially, never deleted
```

The same rule applies in reverse: an empty board is not a dead board. Companies pause hiring and come back.

## Trap 4: Workday sleeps a whole pod at once, and it looks exactly like death

On 2026-11-07 a check across 66 Workday boards reported 60 of them broken, with the same error from each: `Unexpected token '<', "<!DOCTYPE "...`. The six survivors had one thing in common that was not obvious at first glance: their pods were `wd12`, `wd115`, `wd501` and `wd504`. Every failure sat on `wd1`, `wd3` or `wd5`.

The endpoint was not returning HTML. It was returning a redirect, and `fetch` was following it:

```
HTTP/2 303
location: https://community.workday.com/maintenance-page
```

Workday patches its infrastructure one pod at a time, and during that window every tenant on the pod answers the jobs API with a 303 to that page. Follow the redirect and you get a marketing page; parse it as JSON and you get a syntax error that names no cause. Run a checker that deletes anything that fails, and in one pass you lose Nike, Target, Intel, NVIDIA, Boeing, Chevron, Caterpillar, Medtronic and fifty more — companies whose boards are perfectly alive and will answer again in a few hours.

Stop following the redirect, and the cause names itself:

```js
const r = await fetch(url, { method: 'POST', redirect: 'manual', /* … */ });
if (r.status >= 300 && r.status < 400) {
  const loc = r.headers.get('location') || '';
  if (/maintenance|community\.workday\.com/i.test(loc)) {
    throw new Error('WORKDAY_MAINTENANCE: pod is in a maintenance window, not a dead board');
  }
}
```

Two things follow from this being per-pod rather than per-company. Retrying is pointless: a maintenance window runs for hours, so four backoff attempts only cost you time. And the first board that reports maintenance tells you about every other tenant sharing that pod, so you can skip them all in the same run instead of spending one request each to learn the same fact fifty more times:

```js
const pod = (slug.match(/\.(wd\d+)\b/) || [])[1];
if (pod && sleepingPods.has(pod)) continue;      // learned from an earlier board
```

The honest way to report it is to say which pods were asleep and that those boards are live, not missing. A caller who sees "60 companies failed" starts hunting for a bug in your code. A caller who sees "60 companies on wd1 and wd5 are in a Workday maintenance window, run again later" simply runs again later.

## Normalizing dates

Workday list pages say `Posted Yesterday` and `Posted 30+ Days Ago`. Turn those into real dates or no date filter can work. Map `30+` to exactly 30 days, never further: the source does not know, and inventing a number is how a dataset becomes untrustworthy.

## The code

The ten readers above are MIT-licensed: **https://github.com/shaunhill36421-creator/ats-boards**

If you would rather not keep a company-to-board map yourself, the hosted version ships 653 companies already resolved, 66 of them on Workday: **https://apify.com/alexdany/company-jobs-api**
