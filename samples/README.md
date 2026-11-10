# Live samples

Each file is a slice of job openings read straight from the applicant tracking
system every company runs itself. No aggregator is in the path, so nothing here
is a repost of another board's listing.

Generated 10 November 2026 from 677 company boards holding 106,829 open roles,
23,800 of them posted in the preceding seven days.

Every `url` in every file was requested before the file was written, and rows
whose link did not resolve were dropped rather than shipped. Click any of them.

| file | cut | rows |
|---|---|---|
| `all-industries.csv` | the whole set, spread across companies | 60 |
| `engineering.csv` | titles naming engineer / developer / architect | 60 |
| `remote.csv` | roles the company itself marks as remote | 60 |
| `mobile.csv` | iOS, Android, Flutter, React Native, Swift, Kotlin | 60 |
| `devops.csv` | DevOps, SRE, platform and infrastructure engineering | 60 |
| `food.csv` | food, beverage, culinary, grocery | 51 |
| `insurance.csv` | insurance, underwriting, actuarial, claims | 60 |
| `data-ml-ai.csv` | data science, ML, AI, analytics engineering | 60 |
| `healthcare-bio.csv` | clinical, pharma, biotech, medical | 60 |
| `fintech-finance.csv` | payments, risk, treasury, accounting, quant | 60 |
| `security.csv` | infosec, appsec, GRC, threat, IAM | 60 |
| `sales-gtm.csv` | AE, SDR, solutions engineering, customer success | 60 |
| `marketing-growth.csv` | growth, SEO, demand gen, product marketing | 60 |
| `product-mgmt.csv` | product management | 60 |
| `design-ux.csv` | product design, UX, research, design systems | 60 |
| `devops-platform.csv` | the same cut by job family rather than title keyword | 60 |
| `hardware-robotics.csv` | robotics, firmware, embedded, aerospace, RF | 60 |
| `supply-logistics.csv` | supply chain, logistics, procurement, fulfillment | 60 |
| `climate-energy.csv` | climate, renewables, grid, battery, hydrogen | 50 |
| `qa-test.csv` | QA, SDET, test and quality engineering | 60 |
| `trust-safety.csv` | trust and safety, moderation, fraud, integrity | 60 |
| `devrel-docs.csv` | developer relations, advocacy, technical writing | 60 |
| `crypto-web3.csv` | crypto, web3, smart contracts | 26 |

Columns: `company, title, location, department, posted, remote, url, url_ats`.

`url` is the link the company publishes. `url_ats` is filled in only where the
published link sits behind a company domain that blocks automated requests; it
is the same posting on the ATS host, and it was verified against both the US and
EU Greenhouse regions rather than guessed.

The reader that produced these is the library in this repository. To pull a cut
yourself, see the root README, or run the hosted version at
https://apify.com/alexdany/company-jobs-api
