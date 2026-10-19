---
id: ai-assisted-engineering
title: Spec-driven development with AI agents
client: Globant
role: Senior Fullstack Developer
period: 2021-present
stack: [MCP servers, AI agents, SDD, AI-DLC]
---

## Context

AI coding assistants are easy to adopt badly. The common failure is a conversation that
produces code nobody can audit later: no specification, no decision record, and a diff that
cannot be explained six weeks on. A large consultancy has the additional problem of running
this across many client teams with different repositories and different compliance rules.

## What I did

I work daily with Globant's internal **toolchain of AI agents and MCP servers**, which
connects assisted work to JIRA, Confluence, Splunk and GitHub Enterprise. That is the part
that makes AI useful at scale: the agent reads the same systems the team reads, instead of
depending on whatever was pasted into a chat window.

The work is structured with **AI-DLC** (the Inception, Construction and Operations phases)
and with **Spec Driven Development**: specifications are structured, persistent artifacts
that live in the repository, so the implementation can be checked against them later rather
than remembered.

## Outcome

Specifications that outlive the conversation, and a review trail that includes AI-assisted
work on the same footing as hand-written work. I also direct 20+ technical sign-offs and
architecture reviews per year, which is where the discipline either holds or does not.

## Tradeoffs

Writing the specification first is slower than prompting straight to code, and the gap is
paid back only if the spec is actually used for review. Done half-way, it becomes
documentation that nobody reads, which is worse than not having it because it looks like
control while providing none. The test is whether a reviewer can reject a change by citing
the spec.
