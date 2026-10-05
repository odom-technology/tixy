# Security policy

Report vulnerabilities through **Security → Report a vulnerability** in this
repository. If unavailable, use the private form at <https://tixy.lol/feedback>.

Do not publish credentials, personal data, exploitable details, or database
exports in issues or PRs. Reproduce issues with synthetic local accounts; include
affected paths, steps, and likely impact.

Contributor CI uses GitHub-hosted runners and disposable databases. It receives
no production credentials or authorized production database access. Production
deployment is managed separately after maintainer review.

Runtime env files, production secrets, backups, and customer data must never be
committed to application or operations repositories.
