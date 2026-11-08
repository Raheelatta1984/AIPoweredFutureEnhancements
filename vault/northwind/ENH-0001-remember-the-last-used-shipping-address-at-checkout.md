---
ref: ENH-0001
title: Remember the last used shipping address at checkout
status: Submitted
tenant: northwind
app: Northwind Customer Portal
submitted_by: noah.bennett@northwind.demo
submitted_on: "2026-11-06T13:00:21.288Z"
area: Checkout
votes: 2
app_sections:
  - sec.cart-summary
  - sec.checkout-payment
ai_fields: []
source: enhancements-hub/vault
---

# ENH-0001 — Remember the last used shipping address at checkout

> Customers want the cart to remember their last shipping address so repeat orders take two clicks instead of twelve.

## Brief

Repeat customers re-enter the same address on every order, which shows up as abandoned carts in the funnel report.

## Requirements

- Pre-select the most recent shipping address
- Allow switching to any saved address
- Never pre-fill payment details

## Impacts

Cart summary and payment step; address records unchanged.

## Expected outcome

Repeat orders complete faster and abandonment drops.

## Success criteria

1. Returning customers see their last address selected.
2. Switching addresses still works.
3. No payment data is cached.

## Outcome

Fewer abandoned repeat orders.

## App sections

- `sec.cart-summary`
- `sec.checkout-payment`

## Author notes

## Remember the last shipping address

Repeat customers retype the same address on every order.

### Requirements

- Pre-select the most recent address
- Allow switching
- Never cache payment details

---

_No AI-drafted fields — this document was written by noah.bennett@northwind.demo._
