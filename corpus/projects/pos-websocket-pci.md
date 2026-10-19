---
id: pos-websocket-pci
title: WebSocket bridge to POS terminals
client: Carnival Cruise Line
role: Senior Fullstack Developer
period: 2023-2024
stack: [WebSockets, Angular, TypeScript, PCI]
---

## Context

Built for Carnival Cruise Line, where payments on board happen at a POS terminal while the flow starts in a web application. The
web app and the terminal are separate worlds: the browser cannot talk to the device
directly, and the device fleet is mixed, with new Ingenico terminals alongside legacy
Verifone units that had to keep working.

## What I did

I designed and implemented a **WebSocket solution** for communication between the web
applications and the POS devices, with support for the new Ingenico terminals and
compatibility for the legacy Verifone devices.

I integrated **electronic signature and payment flows under PCI compliance**: the card
data path never crosses the browser, and the web application only orchestrates the flow.

## Outcome

The bridge let the web application drive signature and payment on the device while keeping
the legacy fleet in service, so the upgrade did not require replacing hardware before the
software could ship.

## Also on this engagement

I refactored legacy Angular code carrying technical debt, migrating mixed patterns to
modern standards without interrupting operation, and I ran the technical onboarding and
knowledge transfer for new team members.

## Tradeoffs

PCI scope is a design constraint, not a checklist. Keeping card data out of the browser
meant the web layer could not "just" show the full transaction state, and some debugging
that would have been trivial on the frontend became an exercise in reading device and
service logs instead.
