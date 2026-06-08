# Loro Platform — CLAUDE.md

**Repo:** `philsumner-pixel/loro-platform`
**Supabase:** `jnxhxqwbysrylnoqigdd` (eu-west-1)
**Stack:** Next.js 14 · TypeScript · Supabase · Vercel (no Tailwind)
**Live:** Connect repo to Vercel to deploy — auto-deploys on push to main

---

## Session start

1. Read this file
2. Phil pastes the GitHub PAT (expires Aug 18 2026)
3. Clone: `git clone https://x-access-token:$PAT@github.com/philsumner-pixel/loro-platform.git`
4. `git config user.email "claude@anthropic.com"`
5. Check `app/globals.css` for current token values before writing any CSS

---

## Design system — non-negotiable rules

This is the **Loro** system. Separate from CVO Light and 333 Dark. Never mix.

| Property | Value |
|---|---|
| Accent | Lapis blue `#1A3A6B` (`var(--blue)`) |
| Background | `#FFFFFF` (`var(--paper)`) |
| Serif (headlines only) | Playfair Display |
| UI / body | Inter |
| Data / numbers | IBM Plex Mono — ALWAYS for rates, amounts, latency |
| Border-radius | 0 (sharp) everywhere — pills only: `20px` |
| Box-shadow | Never |
| Gradients | Never |
| Dark mode | Never |
| CVO vermillion `#D4380D` | Never in Loro |

**Class naming:** All classes prefixed `loro-`. Never use `card`, `Card`, `nav`,
`button`, `input`, `aside` as class name substrings.

---

## File map

| File | Purpose |
|------|---------|
| `app/globals.css` | ALL styles. Tokens + component classes. No !important. |
| `app/layout.tsx` | Root layout, Google Fonts, metadata |
| `app/page.tsx` | Homepage composition |
| `components/TickerStrip.tsx` | `use client` — live FX ticker (Frankfurter API) |
| `components/Masthead.tsx` | Site header + nav |
| `components/HeroSection.tsx` | Hero article + secondary stack |
| `components/DataStrip.tsx` | `use client` — 4 live data widgets |
| `components/ArticleGrid.tsx` | Article grid (intelligence / markets variants) |
| `components/NewsletterSection.tsx` | Newsletter CTA |
| `components/SiteFooter.tsx` | Site footer |

---

## Responsive breakpoints (mobile-first)

- Base: 375px (mobile)
- `@media (min-width: 640px)` — small tablet
- `@media (min-width: 768px)` — tablet
- `@media (min-width: 1024px)` — desktop
- `@media (min-width: 1200px)` — wide desktop

Write base styles for mobile. Add breakpoints for wider screens.

---

## Supabase tables (Loro namespace)

| Table | Status | Purpose |
|-------|--------|---------|
| `loro_corridors` | Live — 26 seeded | FX corridor registry |
| `loro_fx_rates` | Live | Daily ECB rate snapshots |
| `loro_ingest_log` | Live | Ingestion audit log |
| `loro_articles` | To build | Article content + metadata |
| `loro_authors` | To build | Author profiles (E-E-A-T) |
| `loro_article_translations` | To build | Multilingual content (de, fr, it) |

---

## Environment variables

Create `.env.local` (never commit):
```
NEXT_PUBLIC_SUPABASE_URL=https://jnxhxqwbysrylnoqigdd.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

---

## Editorial evidence standard (contemporary-by-design — locked)

Loro is built for how people find information now: generative answer-engines that
synthesise one answer and cite their sources, not just ranked blue links. Peer-reviewed
research (Aggarwal et al., Princeton/Georgia Tech, arXiv:2311.09735) found three content
tactics each lift source visibility in AI answers by 30–40% — direct quotes, specific
statistics, and named credible citations — while keyword stuffing was the ONLY tactic with
a consistently negative outcome. Finance/regulated content benefits most from leading with
statistics, and mid-/un-ranked domains gain the most (a #5 page saw +115% citation share),
which is exactly Loro's position as a new entrant.

Loro is structurally optimal for this: its sources (FCA PDMR, SEC EDGAR, Companies House,
market data) are inherently statistic-dense, primary-source-cited and quotable. We do not
retrofit credibility signals onto thin content — the engine emits them natively.

Therefore every content generator (`generate-brief`, `generate-digest`, `generate-social`)
must enforce the same evidence standard:
- Specific sourced numbers, never vague quantifiers ("fell 12.4%", not "fell sharply")
- Each substantive claim attributed to its named primary source (name the filing/register)
- A named, attributable quote wherever the source material contains one
- Clear fluent prose for a skeptical professional reader; never keyword padding
This is the single rule that makes content both citable by an answer-engine and trustworthy
to a human editor. Keep it in every brief, audit and scoring criterion. Do not remove it.

---

## Git workflow

- Commit email: `claude@anthropic.com`
- Push directly to `main` for surgical changes
- One commit per session where possible
- Always: `git pull --rebase origin main && git push`
- Use `[skip vercel]` in commit message for non-deploy changes

---

## Build status

**Phase:** Foundation scaffold — homepage live

**Live data:** GBP/EUR + 4 pairs in ticker (Frankfurter API) · GBP/EUR in data strip widget

**Placeholder (connect when pipeline ready):**
- Funding widget → `loro_funding_rounds` table (to build)
- Settlement widget → `loro_settlement_index` table (to build)
- Ownership widget → `loro_pdmr_filings` table (to build, FCA PDMR ingestion)
- All article content → `loro_articles` table (to build)

**Not built yet:**
- Article page template (`/news/[slug]`)
- FX Tracker page (`/data/fx-tracker`)
- Editorial inbox (journalist review queue)
- Author pages (`/authors/[slug]`)
- Sitemap + robots.txt
- NewsArticle JSON-LD schema
- Multilingual routes (`/de`, `/fr`, `/it`)

---

## Session end protocol

Always log to Supabase:
1. `claude_session_log`
2. `business_time_log`
3. `knowledge_entries` for decisions/lessons
