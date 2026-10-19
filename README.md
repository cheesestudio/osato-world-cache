# OSaTo public world cache

Only the snapshot publisher and workflow are committed. Public snapshots are
deployed as GitHub Pages artifacts and never committed to Git history. Artifacts
expire after one day. No profile, email, account identifiers or private replies
are exported.

The workflow refreshes about every 15 minutes; GitHub may delay scheduled jobs.
When the website's separate world budget is exhausted, the last snapshot stays
available and sending from the world pauses until the next UTC day. Account
limits use Beijing days: 10 world bottles and 30 world lobby messages per day.

Known D1 daily read/write limits defer publication and appear in the run summary.
Network failures and HTTP 500/502/503/504 are retried up to three times, then
still fail if recovery is unsuccessful. Authentication and schema errors fail
immediately. Failed or deferred runs never replace the published cache. The
workflow runs publisher regression tests before requesting data.

Static downloads do not invoke the website's Cloudflare Worker. The legitimate
world workload reserves at most 20,000 requests, 2,000,000 D1 read rows and 40,000
D1 written rows daily, with at most 1,000 submissions and 100 exports. These are
application reservations, not a guarantee about billed invocations during DDoS.
Cloudflare counts rejected HTTP invocations too; exact isolation during an
arbitrary attack requires an independent quota or upstream protection.
