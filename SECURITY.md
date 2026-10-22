# Security Policy

opencost is an internal PerfOps microservice (default port 4051).

- **Report a vulnerability:** open a private security advisory on this repo
  (GitHub → Security → Advisories) or contact the owner listed in
  [`muntianus/.github`](https://github.com/muntianus/.github/blob/main/SECURITY.md).
- **Secrets:** none are required. Never commit `.env`; only `.env.example`
  (placeholder values) is tracked. GitGuardian scans every pull request for
  secrets.
- The API is unauthenticated and sends `Access-Control-Allow-Origin: *`; it only serves cost estimates. Keep it on loopback / behind Caddy, never expose it with write access to real infrastructure.
