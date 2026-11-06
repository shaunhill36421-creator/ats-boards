// node example.mjs
import { ADAPTERS, fetchJobs } from './src/ats.mjs';

const targets = [
  ['greenhouse', 'stripe'],
  ['ashby', 'ramp'],
  ['lever', 'spotify'],
  ['workday', 'nvidia.wd5/NVIDIAExternalCareerSite'],
];

for (const [ats, slug] of targets) {
  const jobs = await fetchJobs(ats, slug, { limit: 3, includeDescription: false });
  console.log(`\n${ats}:${slug} -> ${jobs.length} jobs`);
  for (const j of jobs) console.log(`  ${j.title} | ${j.location || '-'}`);
}

console.log('\nplatforms:', Object.keys(ADAPTERS).join(', '));
