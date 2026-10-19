---
id: commerce-bff
title: Node.js BFF for commerce APIs
client: Disney Parks (WDW)
role: Senior Fullstack Developer
period: 2021-present
stack: [Node.js, TypeScript, REST, .NET APIs]
---

## Context

The commerce frontends needed data composed from several backend services in one round
trip. Calling each service from the browser multiplied latency, exposed backend details to
the client, and pushed composition logic into every frontend that needed the same view.

## What I did

I implemented a **BFF (backend for frontend) architecture with Node.js** for the commerce
APIs: the BFF owns composition, caching and the shape the frontend actually consumes.

I worked with the **.NET backend teams** on API design and data contracts, so the BFF was
not guessing at payload shapes that the backend considered internal.

## Outcome

The frontend consumes one shaped response per view instead of orchestrating several
services in the browser, and the contract conversations moved upstream into design rather
than into bugs after release.

## Tradeoffs

A BFF is another deployable with its own failure modes; when it is down, every frontend
that depends on it is down with it. Keeping it thin, with no business rules that belong in
the domain services, is what keeps that risk acceptable. It composes, it does not decide.
