# Finance module

Pure, deterministic TypeScript for the question "does it pencil?". Same inputs give the same outputs. No
randomness, no clock, no network, and no language model touches the math.

## Rules

- **Every output is a receipt.** Each output is `{ status, value, label, formula, inputs }`. The label puts
  plain language first and the acronym second, e.g. "Return per year on your cash (levered IRR)".
- **Missing is not zero.** If a required input is missing, the output is
  `{ value: null, status: "insufficient evidence", missing: [...] }`, and anything computed from it inherits the
  same missing list. Math with no answer (divide by zero, cash flows that never change sign) gives
  `status: "not computable"` with a reason.
- **No invented numbers.** The module has no default prices, rates, cap rates, vacancy, or cost per sq ft.
  Market references (rents, rates, comps) come from the database, and cost assumptions come from the user. A
  test scans the source for numeric literals to keep it that way. The only rate schedule in the code is the
  cited PA DEP mine subsidence insurance chart.
- **Optional lines.** In `hardSiteLines`, `softSiteLines` and `opexLines`, leaving a line out means it does not
  apply. Setting it to `null` means it applies but the amount is unknown, which counts as missing. Enter `0` for
  "applies, costs nothing".
- Rates and shares are decimals (`0.065` = 6.5%). Millage is in mills (dollars per $1,000 of assessed value).
  Times are whole months, and the hold period is whole years.

## Contents

| File | What it covers |
|---|---|
| `receipt.ts` | Receipt types, `compute`, optional-line sums, either/or inputs |
| `tvm.ts` | NPV, IRR (Newton, falling back to bisection; `null` when there is no sign change), payment, balance, amortization schedule, payback, equity multiple, bisection |
| `msi.ts` | Mine subsidence insurance premium: $3.75 + $0.25 per $1,000 of coverage (PA DEP rate chart, effective 2021-07-01) |
| `costs.ts` | Schedule and delays, land, hard, soft, contingency, holding, construction interest, financing, TDC/CAPEX, cost per unit and per sq ft, OPEX |
| `income.ts` | GPR, vacancy, EGI, NOI, cap rate, stabilized value, yield on cost, development spread, for-sale sales, selling costs, profit and margin |
| `financing.ts` | LTC, LTV, equity required (net of grants), monthly payment, debt service, DSCR, supportable debt |
| `returns.ts` | Monthly cash-flow timelines, NPV/IRR receipts, payback, equity multiple, cash-on-cash |
| `proforma.ts` | `rentalProForma`, `forSaleProForma`, `affordableProForma` (funding gap and capital stack) |
| `scenarios.ts` | Base / Conservative / Optimistic sets (structure only), sweeps, tornado data, break-even rent and cost increase |

## Timing ("time is money")

Cash flows run by month, and IRRs are annualized as (1 + monthly)^12 − 1. Approval and construction delays
push income later and add holding cost. A construction delay also adds construction-loan interest (average
drawn balance × rate × months).

## Required footer

Wherever finance results appear, the UI must show:

> Decision support. Verify with your lender, accountant, and the permitting office.

(exported as `FINANCE_DISCLAIMER`)
