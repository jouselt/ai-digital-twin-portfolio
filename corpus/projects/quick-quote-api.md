---
id: quick-quote-api
title: Quick Quote API and its observability
client: Disney Parks (WDW)
role: Senior Fullstack Developer
period: 2021-present
stack: [Node.js, TypeScript, Splunk, REST]
---

## Context

Quick Quote receives traffic from deep links: a marketing page, a search result or an
affiliate sends a guest straight into the funnel with query parameters that describe
dates, party mix and destination. Those links arrive from partners who control the
parameters, so the endpoint has to be defensive about what it is handed.

## What I did

I designed the **Quick Quote API**: a deep link endpoint for the metasearch flow. It
validates incoming parameters, handles the redirect to the right market surface, manages
cookies across the handoff, and writes structured logs.

Logging uses the team's structured pattern with `diagLog` and **correlation ids**, so one
guest journey can be followed across the services it touches instead of being stitched
together by timestamp.

## Outcome

Because the endpoint emitted correlation ids, I was able to build Splunk dashboards over
it and over the commerce flows that share the identifier. Those dashboards and the
logging pattern were adopted by more than six Commerce APIs.

## Tradeoffs

Validating parameters at the edge means rejecting some deep links that a human would
consider valid, because the partner sent something slightly off-spec. I preferred a
predictable rejection with a logged reason over accepting a malformed link and failing
later inside the funnel, where the guest sees an error and the reason is gone.
