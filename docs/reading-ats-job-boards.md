# Reading job boards straight from an ATS

Most job data is scraped the hard way: point a crawler at Indeed or LinkedIn, buy residential proxies, fight the anti-bot system, watch runs fail, repeat. That work exists because the aggregator does not want you there.

The companies themselves are the opposite. They publish their openings on purpose, in JSON, on endpoints that are not defending themselves, because an unseen job posting is a job posting that failed. If you read those endpoints instead, there is nothing to get past.

This is a map of the nine applicant tracking systems that cover most of the market, and the three traps that cost real time.

## The nine platforms

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
| Workday | `tenant.wdN/SiteName` | POST `…/wday/cxs/<tenant>/<site>/jobs` |

Eight of those take a single slug you can usually read off the company's careers link. Then there is Workday.

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

## Normalizing dates

Workday list pages say `Posted Yesterday` and `Posted 30+ Days Ago`. Turn those into real dates or no date filter can work. Map `30+` to exactly 30 days, never further: the source does not know, and inventing a number is how a dataset becomes untrustworthy.

## The code

The nine readers above are MIT-licensed: **https://github.com/shaunhill36421-creator/ats-boards**

If you would rather not keep a company-to-board map yourself, the hosted version ships 653 companies already resolved, 66 of them on Workday: **https://apify.com/alexdany/company-jobs-api**
