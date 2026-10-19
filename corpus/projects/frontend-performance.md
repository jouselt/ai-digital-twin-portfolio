---
id: frontend-performance
title: Cutting the initial bundle by 40 percent
client: Disney Parks (WDW)
role: Senior Fullstack Developer
period: 2021-present
stack: [Angular, TypeScript, lazy loading, change detection]
---

## Context

The commerce frontends are used by guests on mobile connections, often from inside a park.
A large initial bundle is not an abstract performance metric there: it is a guest waiting
on a white screen before they can look at dates.

## What I did

I worked on **change detection strategy and lazy loading**. The change detection work was
about telling Angular which parts of the tree actually depend on which state, instead of
letting it re-evaluate broadly. The lazy loading work was about moving route-level code out
of the initial payload so the first paint does not pay for screens the guest may never
reach.

## Outcome

The **initial bundle size dropped by 40%** on the Disney Parks work.

## Tradeoffs

Both changes trade immediacy for weight: lazy loading introduces a loading boundary where
code used to be present, and `OnPush` change detection makes a stale view possible if the
component lies about its inputs. The discipline that keeps it honest is tests per component
and reviewing the input contracts, not just measuring the bundle afterwards.
