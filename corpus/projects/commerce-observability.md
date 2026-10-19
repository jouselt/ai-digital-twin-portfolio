---
id: commerce-observability
title: Structured logging across Commerce APIs
client: Disney Parks (WDW)
role: Senior Fullstack Developer
period: 2021-present
stack: [Splunk, Node.js, TypeScript, correlation ids]
---

## Context

The Commerce surface is a set of APIs maintained by several teams. When a guest reported
a failure, the investigation started with a timestamp and a conversation, then moved to
four or five services whose logs used different shapes. Diagnosis time was dominated by
matching records by hand, not by fixing the defect.

## What I did

I created Splunk dashboards on top of a structured logging pattern built around
correlation ids. Instead of logging free text, the services emit events with a shared
identifier, so a single guest journey becomes one filterable trace.

The pattern was not a library rollout. It was a convention, documented and demonstrated
through dashboards that made the benefit visible: a support ticket could be answered by
one query instead of a cross-team search.

## Outcome

The pattern and the dashboards were **adopted across 6+ Commerce APIs**. Correlation ids
propagate through the Quick Quote API and the commerce flows it hands off to.

## Tradeoffs

Structured logging costs discipline: every new endpoint has to emit the identifier, and a
service that forgets it silently breaks the trace rather than failing. The trade is
deliberate, because the alternative (unstructured logs) breaks the trace in a way nobody
notices until an incident.

## Why this is in a portfolio about grounding

This project is the reason the chat in this portfolio exposes a trace id. The idea is the
same one: show the person asking the question the path that produced the answer, instead
of asking them to trust it.
