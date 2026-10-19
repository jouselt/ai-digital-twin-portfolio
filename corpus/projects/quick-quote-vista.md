---
id: quick-quote-vista
title: Quick Quote Vista web component
client: Disney Parks (WDW)
role: Senior Fullstack Developer
period: 2021-present
stack: [Stencil.js, Web Components, TypeScript, SCSS, Angular]
---

## Context

Quick Quote is the first step of the booking funnel for Walt Disney World and Disneyland
Resort: a guest picks dates, party mix and a resort before being handed to the booking
engine. The component had to live inside several host applications, some of them Angular
and some not, and it had to serve guests in several languages and markets at once.

## What I did

I built Quick Quote Vista from scratch as a **Stencil.js web component**, chosen over an
Angular component because the host applications were not all Angular and a framework
component would have forced every host to adopt that framework. The component ships a
date picker, party mix validation, a resort selector, and responsive layouts.

It is deployed in **eight international variants**: WDW and DLR, the Latin America and
Caribbean locales in es-CO, es-MX, es-AR, es-PE, es-CL and pt-BR, plus UK and EU.

## Outcome

The component serves **more than 20,000 users per day**. I also fixed 15+ UI bugs across
mobile, tablet and desktop breakpoints, cleaned up the SCSS, and raised unit test
coverage on the component.

## Tradeoffs

A web component means paying for cross-boundary concerns that a framework component gets
for free: property and event contracts have to be explicit, styles have to be isolated,
and the host cannot rely on its own change detection to update the component. That cost
is what bought the ability to embed the same component in every brand surface without
asking any host application to change its stack.
