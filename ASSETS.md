# GamesKeep — Assets & Setup Guide

> Quick reference for the **owner**: where to put your logo, text, images, keys, and company info. The agent leaves clearly-named placeholders at each location below. Replace the placeholder, and it appears on the site — no code editing required.
>
> **For the agent:** every item below must have a defined, documented placeholder location (a config file, an admin field, or an assets folder). Nothing in this list should require editing source code to change. Where an item is "admin field", expose it in Control Panel → Settings.

## 1. Brand identity
| Item | Where it goes | Format / notes |
|---|---|---|
| Company / platform name | admin field (Settings) | "GamesKeep" (placeholder) |
| Legal company name + details | admin field (Settings) | for footer / Terms / impressum |
| Logo (light + dark variants) | assets folder | SVG preferred; placeholder shown until replaced |
| Logo concept (for the designer) | — | keep/fortress + 2 fired arrows above the tower + lowered banner in a window mid-tower, banner shows a checkerboard (4+ squares) |
| Favicon | assets folder | provided by owner |
| Brand colors | theme config | dark base (warm charcoal) + amber/gold accent; defaults set, tunable |
| Font preference | theme config | owner sets; sensible premium default until then |
| Slogan / tagline | admin field (Settings) | for hero / meta tags / About |

## 2. Text content (owner writes; agent can draft on request)
| Item | Where it goes |
|---|---|
| About text | admin field / static page |
| **Methodology** text | admin field / static page (agent provides a polished draft) |
| Contact details + contact email | admin field (Settings) | placeholder: `wrathsystems@gmail.com` |
| Privacy Policy | static page (needs legal review for EU/GDPR) |
| Terms | static page (needs legal review) |

## 3. External accounts & API keys (PRODUCTION only — demo runs on mock)
| Key / account | Used for | Where it goes |
|---|---|---|
| IGDB (Twitch OAuth) | game metadata (primary) | env / Settings (secret) |
| RAWG API key | game metadata (fallback) | env / Settings (secret) |
| Steam Web API key | player counts, prices, review %, completion | env / Settings (secret) |
| YouTube Data API v3 key | game-page videos | env / Settings (secret) |
| Cloudflare account | bot/DDoS protection | infra config |
| Transactional email provider | verification / notifications / subscribe | env / Settings (secret) |
| OAuth apps (Steam/Google/Discord) | social login (optional) | env / Settings (secret) |

> **Secrets never committed to source control.** Agent must document exactly which env vars / settings fields hold each key, and the demo must run fully without any of them.

## 4. Visual assets
| Item | Where it goes | Notes |
|---|---|---|
| Placeholder images | assets folder | agent may generate neutral placeholders |
| Default avatars | assets folder | |
| Empty-state illustrations | assets folder | |
| Game covers / screenshots | auto from IGDB/RAWG (prod) / seed (demo) | not owner-supplied |

## 5. Parked assets (not used until activated)
| Item | Location | Status |
|---|---|---|
| ColorGuess mini-game | owner-provided zip (React+Vite) | parked; integrate only if platform gains traction |

---

### One-line summary for the owner
Put your **logo & favicon** in the assets folder, write your **About/Methodology/Contact/Legal** text in Control Panel → Settings (or the static-page editors), and paste your **API keys** into the documented secret fields when you go to production. The demo works with none of these.
