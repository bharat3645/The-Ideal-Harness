# Security Policy

The Ideal Harness is, in large part, a security tool — its `guard` module is an
enforcement floor that runs below the model. We hold the project to the standard it asks
of others.

## Threat model

The harness assumes:

- **All external content is hostile** until proven otherwise — tool results, web pages,
  MCP output, repository files, package scripts. The `guard` module wraps such content as
  untrusted and scans it for injection cues.
- **A guardrail will eventually be bypassed.** Enforcement is layered (deny-wins policy +
  OS sandbox + secret redaction + skill vetting), and the design assumes no single layer
  is sufficient — defense in depth, with blast-radius containment.
- **The model is not trusted to police itself.** Every safety rule is deterministic code,
  not a prompt instruction.

Aligned with Anthropic's agent security guidance and OWASP LLM06 (Excessive Agency).

## What `guard` enforces

- Deny-wins, fail-closed policy over every tool call (unmatched requests require approval).
- `denyRead` on credential paths (`~/.aws`, `~/.ssh`, `.env`) and self-policy write
  protection (the agent cannot rewrite its own guardrails).
- Always-on secret redaction so secrets never reach the model, logs, or a subprocess.
- A skill-vetting gate (threat signatures + homoglyph/hidden-character detection) that
  scans any third-party skill before it loads.
- An OS sandbox command builder (Seatbelt / bubblewrap) + subprocess env-scrub.

## Reporting a vulnerability

Please report security issues privately via a GitHub Security Advisory on the repository,
or by opening an issue marked `security` if private reporting is unavailable. Include a
reproduction and the affected module. We aim to acknowledge within a few days.

Do not open public issues containing working exploits against the enforcement floor until
a fix is available.
