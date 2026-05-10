---
name: code-review
description: Use when the user asks for a code review, asks you to look at a PR, diff, or
  asks "what's wrong with this code". Focuses on security, correctness, clarity, and
  consistency with surrounding code.
version: 1.0.0
---

# Code Review Skill

When the user asks for a code review, follow this checklist in order.

## 1. Security first

- SQL injection: any string concatenation in queries?
- Command injection: any `exec`/`spawn`/`system` with user-controlled args?
- Hardcoded secrets, API keys, passwords, JWTs?
- Insecure deserialization: `pickle.loads`, `yaml.load` (not safe_load), `eval`?
- Cross-site issues (XSS, CSRF) in web code?
- Path traversal in file operations?

If any of these are present, flag them with **security:** prefix and explain the attack vector.

## 2. Correctness

- Off-by-one errors in loops?
- Null/undefined dereferences? In TS: are non-null assertions (`!`) justified?
- Race conditions: shared mutable state accessed without locks/atomics?
- Resource leaks: file handles, connections, timers, subscriptions not closed?
- Error swallowing: `try { ... } catch {}` without logging?
- Edge cases: empty input, single element, very large input?

## 3. Style and clarity

Match the surrounding code style. Don't impose your own preferences if the project clearly uses a different convention.

- Are variable names descriptive?
- Are functions doing one thing each?
- Is there dead code or unreachable branches?
- Are comments explaining *why*, not *what*?

## 4. Output format

Group findings by severity:

- **🔴 Blocker** — security or correctness bug, must fix.
- **🟡 Should-fix** — design/clarity issue worth addressing.
- **🟢 Nit** — minor preference, optional.

Quote the relevant lines, explain the problem, suggest a fix. Keep each finding under 5 sentences. Don't repeat what the code *does* — focus on what's wrong or risky.

If the code looks fine, say so explicitly: "No blockers or should-fix issues found. The code is in good shape." Don't invent problems to seem useful.
