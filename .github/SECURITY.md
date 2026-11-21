# Security

Please do not report security problems in public issues or pull requests.

Report them privately through GitHub's private vulnerability reporting for this repository: open
the repository's **Security** tab and choose **Report a vulnerability**. Include what is affected
(the specification, the conformance checker, or the example kit), how to reproduce it, and what
an attacker could do.

Examples of what to report:

- a requirement in `spec/` whose wording lets a conforming kit or harness read or write outside its
  workspace, run what it should not, or leak data;
- a way for a kit under test to escape or mislead `khp check` (its containment, probes, or
  sandbox) so that a violation is reported as a pass;
- a vulnerability in the example kit or in the checker's own code or dependencies.

We acknowledge a report as soon as we can, agree on a fix and a disclosure date with the reporter,
and credit the reporter unless they ask us not to. Fixed problems are recorded in
[CHANGES.md](../CHANGES.md) when they change the specification.
