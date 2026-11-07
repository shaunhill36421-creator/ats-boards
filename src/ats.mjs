// Readers for the ATS each company runs itself. Public endpoints only: no keys, no proxies.
// Every reader returns the SAME job record shape.

const UA = 'xuong-cho-jobs/1.0 (+public job board aggregation)';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Retry with backoff. The source is not fighting you, but networks still hiccup (429, 502).
// This is where naive clients silently drop listings.
const J = async (url, attempts = 4) => {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, {
        headers: { 'user-agent': UA, accept: 'application/json' },
        signal: AbortSignal.timeout(25000),
      });
      if (r.ok) return r.json();
      if (r.status === 404 || r.status === 403) throw new Error(`HTTP ${r.status}`);
      const retryAfter = Number(r.headers.get('retry-after'));
      last = new Error(`HTTP ${r.status}`);
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 20000) : 800 * 2 ** i);
    } catch (e) {
      if (/HTTP (404|403)/.test(e.message)) throw e;
      last = e;
      await sleep(800 * 2 ** i);
    }
  }
  throw last ?? new Error('request failed');
};
// Workday only answers POST, so it needs its own sender. Same backoff as above.
const JP = async (url, body, attempts = 4) => {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(url, {
        method: 'POST',
        headers: { 'user-agent': UA, accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(25000),
        redirect: 'manual',
      });
      if (r.ok) return r.json();
      // Workday takes a whole pod offline with a 303 to its maintenance page. Let fetch follow
      // that redirect and you get HTML back, then conclude the board is dead. It is not: it is asleep.
      if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get('location') || '';
        if (/maintenance|community\.workday\.com/i.test(loc)) {
          throw new Error('WORKDAY_MAINTENANCE: this Workday pod is in a maintenance window, not a dead board - retry later');
        }
        throw new Error(`HTTP ${r.status} -> ${loc.slice(0, 80)}`);
      }
      if (r.status === 404 || r.status === 403 || r.status === 400) throw new Error(`HTTP ${r.status}`);
      const retryAfter = Number(r.headers.get('retry-after'));
      last = new Error(`HTTP ${r.status}`);
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1000, 20000) : 800 * 2 ** i);
    } catch (e) {
      if (/HTTP (404|403|400)|WORKDAY_MAINTENANCE|HTTP 3\d\d ->/.test(e.message)) throw e;
      last = e;
      await sleep(800 * 2 ** i);
    }
  }
  throw last ?? new Error('request failed');
};

const txt = (h) => (h == null ? null : String(h)
  .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<\/(p|div|li|br|h\d)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(d))
  .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim());

// Workday list pages only give relative dates ("Posted Yesterday", "Posted 30+ Days Ago").
// Turn them into real dates so a postedWithinDays filter works. "30+" maps to exactly 30 days, never further.
// A Workday job path carries the location: "/job/US-CA-Santa-Clara/Name_JR1".
// Pull it out so the list page has a location column without one extra request.
const wdLoc = (path) => {
  const m = String(path || '').match(/^\/job\/([^/]+)\//);
  if (!m) return null;
  const v = decodeURIComponent(m[1]).replace(/---/g, ' - ').replace(/--/g, ' ').replace(/-/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return v && !/^job$/i.test(v) ? v : null;
};
const wdPostedAt = (t) => {
  if (!t) return null;
  const s = String(t).toLowerCase();
  const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
  if (/today|just posted/.test(s)) return day(0);
  if (/yesterday/.test(s)) return day(1);
  const m = s.match(/(\d+)\+?\s*(day|week|month)/);
  if (!m) return null;
  const n = Number(m[1]);
  return day(m[2] === 'week' ? n * 7 : m[2] === 'month' ? n * 30 : n);
};

const base = (ats, slug) => ({ ats, companySlug: slug });


const X = async (url) => {
  const r = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(25000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.text();
};
const tag = (block, name) => {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return null;
  return txt(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')) || null;
};

export const ADAPTERS = {
  greenhouse: {
    test: s => `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`,
    async fetch(s) {
      const d = await J(`https://boards-api.greenhouse.io/v1/boards/${s}/jobs?content=true`);
      return (d.jobs || []).map(j => ({
        ...base('greenhouse', s),
        jobId: String(j.id),
        title: j.title,
        url: j.absolute_url,
        location: j.location?.name ?? null,
        department: j.departments?.[0]?.name ?? null,
        postedAt: j.updated_at ?? j.first_published ?? null,
        remote: /remote/i.test(j.location?.name || '') || null,
        description: txt(j.content),
      }));
    },
  },
  ashby: {
    test: s => `https://api.ashbyhq.com/posting-api/job-board/${s}`,
    async fetch(s) {
      const d = await J(`https://api.ashbyhq.com/posting-api/job-board/${s}?includeCompensation=true`);
      return (d.jobs || []).map(j => ({
        ...base('ashby', s),
        jobId: String(j.id),
        title: (j.title || '').trim(),
        url: j.jobUrl ?? j.applyUrl ?? null,
        location: j.location ?? null,
        department: j.department ?? j.team ?? null,
        postedAt: j.publishedAt ?? null,
        remote: j.isRemote ?? null,
        employmentType: j.employmentType ?? null,
        compensation: j.compensation?.compensationTierSummary ?? null,
        description: txt(j.descriptionPlain ?? j.descriptionHtml),
      }));
    },
  },
  lever: {
    test: s => `https://api.lever.co/v0/postings/${s}?mode=json&limit=1`,
    async fetch(s) {
      const d = await J(`https://api.lever.co/v0/postings/${s}?mode=json`);
      return (Array.isArray(d) ? d : []).map(j => ({
        ...base('lever', s),
        jobId: String(j.id),
        title: j.text,
        url: j.hostedUrl ?? j.applyUrl ?? null,
        location: j.categories?.location ?? null,
        department: j.categories?.team ?? j.categories?.department ?? null,
        postedAt: j.createdAt ? new Date(j.createdAt).toISOString() : null,
        remote: /remote/i.test(j.categories?.location || j.workplaceType || '') || null,
        employmentType: j.categories?.commitment ?? null,
        description: txt(j.descriptionPlain ?? j.description),
      }));
    },
  },
  smartrecruiters: {
    test: s => `https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=1`,
    async fetch(s) {
      const out = [];
      for (let off = 0; off < 2000; off += 100) {
        const d = await J(`https://api.smartrecruiters.com/v1/companies/${s}/postings?limit=100&offset=${off}`);
        const c = d.content || [];
        out.push(...c.map(j => ({
          ...base('smartrecruiters', s),
          jobId: String(j.id),
          title: j.name,
          url: `https://jobs.smartrecruiters.com/${s}/${j.id}`,
          location: ([j.location?.city, j.location?.region, j.location?.country].filter(Boolean).join(', ') || null),
          department: j.department?.label ?? j.function?.label ?? null,
          postedAt: j.releasedDate ?? null,
          remote: j.location?.remote ?? null,
          employmentType: j.typeOfEmployment?.label ?? null,
          description: null,
        })));
        if (c.length < 100) break;
      }
      return out;
    },
  },

  bamboohr: {
    test: s => `https://${s}.bamboohr.com/careers/list`,
    async fetch(s) {
      const d = await J(`https://${s}.bamboohr.com/careers/list`);
      return (d.result || []).map(j => ({
        ...base('bamboohr', s),
        jobId: String(j.id),
        title: j.jobOpeningName,
        url: `https://${s}.bamboohr.com/careers/${j.id}`,
        location: [j.location?.city, j.location?.state, j.location?.country].filter(Boolean).join(', ') || j.location?.name || null,
        department: j.departmentLabel ?? j.department ?? null,
        postedAt: j.datePosted ?? null,
        remote: j.isRemote === 'true' || j.locationType === 'remote' || null,
        employmentType: j.employmentStatusLabel ?? null,
        description: null,
      }));
    },
  },
  breezy: {
    test: s => `https://${s}.breezy.hr/json`,
    async fetch(s) {
      const d = await J(`https://${s}.breezy.hr/json`);
      return (Array.isArray(d) ? d : []).map(j => ({
        ...base('breezy', s),
        jobId: String(j.id ?? j.friendly_id),
        title: j.name,
        url: j.url ?? `https://${s}.breezy.hr/p/${j.friendly_id}`,
        location: [j.location?.city, j.location?.country?.name].filter(Boolean).join(', ') || null,
        department: j.department ?? null,
        postedAt: j.published_date ?? j.creation_date ?? null,
        remote: j.location?.is_remote ?? null,
        employmentType: j.type?.name ?? null,
        description: txt(j.description),
      }));
    },
  },
  // Rippling ATS. Bảng công khai, trả mảng thẳng, không cần khoá.
  // Trang danh sách không kèm mô tả, ngày đăng hay loại hợp đồng: Rippling không phát ra.
  // Thà để trống còn hơn bịa, nên các trường đó là null.
  rippling: {
    test: s => `https://api.rippling.com/platform/api/ats/v1/board/${s}/jobs`,
    async fetch(s) {
      const d = await J(`https://api.rippling.com/platform/api/ats/v1/board/${s}/jobs`);
      return (Array.isArray(d) ? d : []).map(j => {
        const noi = j.workLocation?.label ?? j.workLocation?.id ?? null;
        return {
          ...base('rippling', s),
          jobId: String(j.uuid),
          title: String(j.name ?? '').trim() || null,
          url: j.url ?? `https://ats.rippling.com/${s}/jobs/${j.uuid}`,
          location: noi,
          department: j.department?.label ?? j.department?.id ?? null,
          postedAt: null,
          remote: noi ? /remote|anywhere/i.test(noi) : null,
          employmentType: null,
          description: null,
        };
      });
    },
  },
  personio: {
    test: s => `https://${s}.jobs.personio.de/xml`,
    async fetch(s) {
      const xml = await X(`https://${s}.jobs.personio.de/xml`);
      const blocks = xml.split(/<position>/i).slice(1).map(b => b.split(/<\/position>/i)[0]);
      return blocks.map(b => {
        const id = tag(b, 'id');
        return {
          ...base('personio', s),
          jobId: id ? String(id) : null,
          title: tag(b, 'name'),
          url: id ? `https://${s}.jobs.personio.de/job/${id}` : null,
          location: tag(b, 'office'),
          department: tag(b, 'department') ?? tag(b, 'recruitingCategory'),
          postedAt: tag(b, 'createdAt'),
          remote: /remote/i.test(tag(b, 'office') || '') || null,
          employmentType: tag(b, 'employmentType'),
          description: tag(b, 'jobDescriptions'),
        };
      }).filter(j => j.jobId && j.title);
    },
  },
  workable: {
    test: s => `https://apply.workable.com/api/v1/widget/accounts/${s}`,
    async fetch(s) {
      const d = await J(`https://apply.workable.com/api/v1/widget/accounts/${s}`);
      return (d.jobs || []).map(j => ({
        ...base('workable', s),
        jobId: String(j.shortcode ?? j.id),
        title: j.title,
        url: j.url ?? j.application_url ?? null,
        location: ([j.city, j.state, j.country].filter(Boolean).join(', ') || null),
        department: j.department ?? null,
        postedAt: j.published_on ?? null,
        remote: j.telecommuting ?? null,
        employmentType: j.employment_type ?? null,
        description: txt(j.description),
      }));
    },
  },
  // Workday: where most large employers live. A board reference looks like "tenant.wdN/SiteName",
  // e.g. nvidia.wd5/NVIDIAExternalCareerSite. You cannot guess it from the domain alone.
  workday: {
    guessable: false,
    parse(s) {
      const m = String(s).trim().match(/^([a-z0-9][a-z0-9-]{1,38})\.(wd\d{1,3})[\/|]+(.+)$/i);
      if (!m) return null;
      const site = m[3].replace(/^\/+|\/+$/g, '').split(/[?#]/)[0];
      if (!site) return null;
      return {
        tenant: m[1].toLowerCase(),
        pod: m[2].toLowerCase(),
        site,
        api: `https://${m[1].toLowerCase()}.${m[2].toLowerCase()}.myworkdayjobs.com/wday/cxs/${m[1].toLowerCase()}/${site}`,
        web: `https://${m[1].toLowerCase()}.${m[2].toLowerCase()}.myworkdayjobs.com/en-US/${site}`,
      };
    },
    test: () => null,
    // Probe with a single POST; returns the total job count when the board is alive.
    async probe(s) {
      const p = ADAPTERS.workday.parse(s);
      if (!p) return null;
      try {
        const d = await JP(`${p.api}/jobs`, { appliedFacets: {}, limit: 1, offset: 0, searchText: '' }, 2);
        return Number(d?.total) > 0 ? Number(d.total) : null;
      } catch { return null; }
    },
    async fetch(s, opt = {}) {
      const p = ADAPTERS.workday.parse(s);
      if (!p) throw new Error(`Malformed Workday board reference, expected "tenant.wdN/SiteName": ${s}`);
      const cap = Number(opt.limit) > 0 ? Number(opt.limit) : 1000;

      // The first page reports the total, then fetch the rest in batches. Workday caps each call at 20.
      const PAGE = 20;
      const first = await JP(`${p.api}/jobs`, { appliedFacets: {}, limit: PAGE, offset: 0, searchText: '' });
      const total = Math.min(Number(first?.total) || 0, cap);
      const raw = (first?.jobPostings || []).slice();

      const offsets = [];
      for (let o = PAGE; o < total; o += PAGE) offsets.push(o);
      // Four requests in parallel: fast enough without hammering the source.
      for (let i = 0; i < offsets.length; i += 4) {
        const lot = await Promise.all(offsets.slice(i, i + 4).map(async (o) => {
          try {
            const d = await JP(`${p.api}/jobs`, { appliedFacets: {}, limit: PAGE, offset: o, searchText: '' });
            return d?.jobPostings || [];
          } catch { return []; }
        }));
        for (const part of lot) raw.push(...part);
        if (raw.length >= total) break;
      }

      const list = raw.slice(0, total);

      const shape = (j, extra = {}) => ({
        ...base('workday', s),
        jobId: String(j.bulletFields?.[0] ?? extra.jobReqId ?? j.externalPath ?? '').trim() || null,
        title: (j.title || '').trim() || null,
        url: j.externalPath ? `${p.web}${j.externalPath}` : null,
        location: extra.location ?? (() => {
          const many = /^(\d+) Locations?$/i.exec(j.locationsText || '');
          const primary = wdLoc(j.externalPath) ?? (many ? null : (j.locationsText || null));
          if (!primary) return j.locationsText || null;
          // Multi-location roles: keep the primary location and say how many more, so nobody reads it as one.
          return many && Number(many[1]) > 1 ? `${primary} (+${Number(many[1]) - 1} more)` : primary;
        })(),
        department: null,
        postedAt: extra.startDate ?? wdPostedAt(j.postedOn),
        remote: extra.remote ?? (/remote|anywhere/i.test([j.locationsText, j.title].join(' ')) || null),
        employmentType: extra.employmentType ?? null,
        description: extra.description ?? null,
      });

      // Workday list pages carry no description, exact date or employment type.
      // Only when a description is asked for do we hit each job detail, 6 at a time.
      if (!opt.includeDescription) return list.map((j) => shape(j)).filter((j) => j.jobId && j.title);

      const out = [];
      for (let i = 0; i < list.length; i += 6) {
        const lot = await Promise.all(list.slice(i, i + 6).map(async (j) => {
          if (!j.externalPath) return shape(j);
          try {
            const d = await J(`${p.api}${j.externalPath}`, 2);
            const info = d?.jobPostingInfo || {};
            const locs = [info.location, ...(info.additionalLocations || [])].filter(Boolean);
            return shape(j, {
              jobReqId: info.jobReqId,
              location: locs.join(' | ') || null,
              startDate: info.startDate || null,
              employmentType: info.timeType || null,
              remote: /remote|anywhere/i.test(locs.join(' ')) || null,
              description: txt(info.jobDescription),
            });
          } catch { return shape(j); }
        }));
        out.push(...lot);
      }
      return out.filter((j) => j.jobId && j.title);
    },
  },
};

export const ATS_NAMES = Object.keys(ADAPTERS);

export async function fetchJobs(ats, slug, opt = {}) {
  const a = ADAPTERS[ats];
  if (!a) throw new Error(`Unsupported ATS: ${ats}. Known: ${Object.keys(ADAPTERS).join(', ')}`);
  const jobs = await a.fetch(slug, opt);
  // Some boards page in chunks and hand back more than asked for; keep the promise of `limit`.
  return Number.isFinite(opt.limit) ? jobs.slice(0, opt.limit) : jobs;
}
