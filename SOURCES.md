# EaseScore.AI — sources, tools, and disclosures

Every AI tool, dataset, API, library, service, and asset this project uses. Maintained throughout the build (contest rule: disclose every AI tool; cite every dataset, API, and library).

## Needs citation
_None yet._

## AI tools (development)
| Tool | Version / model | Used for |
|---|---|---|
| Claude Code (Anthropic) | Claude Opus 5.5 (`claude-opus-5-5`) | Pair-programming, planning, code generation, review agents |
| oh-my-claudecode | Claude Code plugin | Multi-agent orchestration inside Claude Code |

## AI in the product
_None yet._ (Rule: the LLM only explains; it never produces a number.)

## Datasets
_None yet._

## APIs and services
| Service | Purpose | Notes |
|---|---|---|
| GitHub | Source hosting | Public repo at submission |
| Vercel | Web hosting and deploys | |
| Supabase | Postgres database (Row Level Security on) | Browser uses publishable key only |
| Anthropic API | Plain-language explanations | Server-only; model TBD |

## Libraries and dev tools
| Name | Version | License | Used for |
|---|---|---|---|
| gitleaks | 8.30.1 | MIT | Secrets scan in the pre-commit check and full-history scan |

## Assets
_None yet._

## Assumptions
_None yet._
