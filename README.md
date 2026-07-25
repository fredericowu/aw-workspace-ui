# aw-frontend

Frontend dedicado do Agentic Workspace (AW) — dashboard React novo, extraído
como **novo lar** do frontend. Repositório novo, **sem git history** do repo
principal.

Nasce a partir do trabalho de redesign validado no UX-Proto (projeto
`aw-redesign`, prototipado em `src/custom_apps/ux-proto/`), não do
`src/app/` legado — mas mantendo paridade funcional completa com ele
(mapeada via `aw-architecture` MCP: 53 requisitos BDD + inventário de
controles granular por componente).

## Princípios

1. **Novo repo, não é fork.** Estrutura e identidade visual (Direção B —
   Signal Amber, `#f5a623`, fonte Inter, logo "Wordmark + prompt chevron")
   já decididas e validadas no protótipo; aqui é a implementação real —
   JSX de verdade com build step (Vite), não mais `React.createElement`
   manual como no protótipo (que não tinha build step).
2. **Componentização por janela.** Cada tipo de janela (App, Terminal,
   Settings, Diff, KB, Plans, Whiteboard, Debugger, Presentation, Tasks,
   Tests, Remote Desktop, Docker Components, Mobile-shell) é um módulo
   independente compondo o `WindowShell` compartilhado (chrome: título,
   ícones, drag/resize/foco/z-order) — decisão do Architect (run `2fa7f8d5`,
   target `aw-microfrontend-architecture`): composição, não herança.
3. **Aponta direto pro `aw-backend` novo, não pro awserv legado.**
   `https://api.aw.tekflox.com` (`repos/aw-backend`, porta 9025) já está no
   ar e com o mesmo CORS credenciado + WS Origin check que o awserv legado
   tinha (`_cors_allowed_origins()` em `repos/aw-backend/src/api/app.py`,
   que já libera `next.{AW_DOMAIN}` — possível domínio reservado pro shell
   novo). `aw.tekflox.com` (awserv legado, porta 9123) não é mais o alvo
   deste frontend — assim que saímos do protótipo pro app real, já vamos
   direto pro backend novo, por decisão do Frederico.
4. **Testes vivem aqui.** BDD (Gherkin, via `aw-architecture` MCP) +
   Playwright de front ficam neste repo, não mais só como requisitos
   externos — parte do CI deste projeto daqui pra frente.

## Topologia

| | aw-frontend | ux-proto (protótipo) |
|---|---|---|
| onde roda | dev: `aw-frontend.app.aw.tekflox.com` (container dev-mode via aw-app-builder); prod: `www.aw.tekflox.com` (build estático servido direto pelo Caddy) | `src/custom_apps/ux-proto`, container `aw-custom-ux-proto` |
| backend | `api.aw.tekflox.com` (`repos/aw-backend`, direto) | `aw.tekflox.com` (awserv legado, direto) |
| build step | Vite + JSX real | nenhum (ESM via esm.sh, `createElement` manual) |
| propósito | implementação real | espaço de exploração/validação rápida |

Ver card Notion "AW Redesign — decoupled frontend/backend" (target
`aw-microfrontend-architecture`) para o histórico completo de decisões.
