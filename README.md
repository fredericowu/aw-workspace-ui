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
3. **Aponta pro backend de produção por enquanto.** `aw.tekflox.com` (porta
   9123, o awserv legado) já tem CORS credentialed + WS Origin check
   liberado para este frontend (ver `src/api/app.py` no repo principal,
   commit `4248185`). O novo `repos/aw-backend` (porta 9025) ainda roda só
   como replica em paralelo — quando ele for promovido a leader, este
   frontend re-aponta pra lá. Não migrar essa URL sem checar esse status
   primeiro.
4. **Testes vivem aqui.** BDD (Gherkin, via `aw-architecture` MCP) +
   Playwright de front ficam neste repo, não mais só como requisitos
   externos — parte do CI deste projeto daqui pra frente.

## Topologia

| | aw-frontend | ux-proto (protótipo) |
|---|---|---|
| onde roda | a definir (dev: Vite local; prod: a decidir — Docker custom app ou hospedagem própria) | `src/custom_apps/ux-proto`, container `aw-custom-ux-proto` |
| backend | `aw.tekflox.com` (produção, direto) | idem, direto |
| build step | Vite + JSX real | nenhum (ESM via esm.sh, `createElement` manual) |
| propósito | implementação real | espaço de exploração/validação rápida |

Ver card Notion "AW Redesign — decoupled frontend/backend" (target
`aw-microfrontend-architecture`) para o histórico completo de decisões.
