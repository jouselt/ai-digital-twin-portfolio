---
id: castaway-club-find-me
title: Find Me, adding past sailings to a guest profile
client: Disney Cruise Line
role: Senior Fullstack Developer
period: 2022-2023
stack: [Angular, TypeScript, REST]
---

## Context

Castaway Club is the loyalty programme for Disney Cruise Line. Guests who had sailed
before could not reliably attach those past sailings to their profile, which blocked the
benefits that depend on sailing history.

## What I did

I built new functionality for the Castaway Club platform, including the **Find Me** modal,
which lets a guest find and add previous sailings to their profile.

Alongside the feature work I improved interface performance and resolved critical incidents
on the platform.

## Outcome

Guests can attach their sailing history themselves, inside the platform they already use,
instead of going through a support channel.

## Tradeoffs

Self-service on historical records means the match has to be conservative: a wrong match
attaches someone else's sailing to a guest profile. The modal prefers asking the guest to
confirm over matching silently, which is slower for the happy path and correct for the case
that matters.
