---
id: latam-upgrades-platform
title: Internal Angular app from concept to production in four months
client: LATAM Airlines
role: Senior Fullstack Developer
period: 2023
stack: [Angular, TypeScript, state management]
---

## Context

LATAM Airlines needed an internal tool to track passenger upgrade eligibility. The work started with a
process that lived in spreadsheets and conversations, and the mandate was a working
application, not a prototype: concept to production in **four months**.

## What I did

I led the application in **Angular** from the initial component architecture through to
production. That meant designing reusable components, choosing a state management approach
that would survive the second and third feature instead of only the first, and building the
eligibility tracking flows.

I also established the frontend standards and practices for the team, so the codebase had
a shape other developers could follow after the initial delivery.

## Outcome

The application shipped to production inside the four-month window, with reusable component
architecture and scalable state management as the foundation rather than as a later
refactor.

## Tradeoffs

Four months is short enough that every architectural decision is made with incomplete
information. The compromise was to invest early in the component boundaries and state shape,
and deliberately defer polish (animation, empty states, the last ten percent of visual
finish) until the flows were proven. That ordering is what made the deadline survivable
without a rewrite afterwards.
