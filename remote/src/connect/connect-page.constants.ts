// Palette lifted from the project icon: its navy ground, the pale branch and
// the red merge dot. Red is spent in one place only — the merge line.
export const PAGE_STYLE = `
:root {
    color-scheme: light dark;
    --ground: #f3f5f8;
    --sheet: #ffffff;
    --ink: #101820;
    --slate: #5b6675;
    --branch: #e7ecf3;
    --rule: #dde2e9;
    --merge: #ff5a4e;
    --claude: #d97757;
    --ok: #1f7a4d;
    --error: #b42318;
    --focus: #2563eb;
    --on-ink: #ffffff;
}
@media (prefers-color-scheme: dark) {
    :root {
        --ground: #0b1117;
        --sheet: #121a23;
        --ink: #e7ecf3;
        --slate: #9aa6b4;
        --branch: #1b2531;
        --rule: #243040;
        --ok: #4ade80;
        --error: #f97066;
        --focus: #60a5fa;
        --on-ink: #101820;
    }
}

* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body {
    margin: 0;
    min-height: 100vh;
    background: var(--ground);
    color: var(--ink);
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    padding: 48px 16px;
}
.sheet {
    width: 100%;
    max-width: 440px;
    background: var(--sheet);
    border: 1px solid var(--rule);
    border-radius: 20px;
    padding: 36px 32px 28px;
}
@media (max-width: 480px) {
    body { padding: 0; }
    .sheet { border: 0; border-radius: 0; min-height: 100vh; padding: 32px 20px 24px; }
}

.lockup { display: flex; align-items: center; justify-content: center; gap: 4px; margin-bottom: 28px; }
.lockup-solo { margin-bottom: 20px; }
.tile {
    width: 56px; height: 56px; flex: none;
    display: grid; place-items: center;
    border-radius: 14px; overflow: hidden;
}
.tile img { width: 100%; height: 100%; display: block; }
.tile-standup { box-shadow: 0 0 0 1px var(--rule); }
.tile-client { background: var(--branch); color: var(--claude); }
.monogram { font-size: 22px; font-weight: 650; color: var(--ink); }
.mark { width: 20px; height: 20px; fill: currentColor; flex: none; }
.tile .mark-claude { width: 30px; height: 30px; }

.merge { width: 104px; height: 48px; overflow: visible; }
.merge path { fill: none; stroke-width: 4; stroke-linecap: round; stroke-linejoin: round; }
.merge-base { stroke: var(--branch); }
.merge-branch { stroke: var(--merge); stroke-dasharray: 1; stroke-dashoffset: 0; }
.merge-dot { transform-box: fill-box; transform-origin: center; }
.merge-dot { fill: var(--merge); }
@media (prefers-reduced-motion: no-preference) {
    .merge-branch { animation: draw 700ms 150ms cubic-bezier(.65, 0, .35, 1) both; }
    .merge-dot { animation: land 220ms 800ms ease-out both; }
}
@keyframes draw { from { stroke-dashoffset: 1; } }
@keyframes land { from { transform: scale(0); } }

h1 { font-size: 21px; line-height: 1.3; font-weight: 650; letter-spacing: -0.01em; text-align: center; margin: 0 0 8px; }
.lede { color: var(--slate); text-align: center; margin: 0 0 6px; text-wrap: balance; }
.return { color: var(--slate); text-align: center; font-size: 13px; margin: 0 0 24px; text-wrap: balance; }
.return strong { color: var(--ink); font-weight: 600; }
.lede strong { color: var(--ink); font-weight: 600; }

.error {
    margin: 0 0 20px; padding: 10px 12px;
    border-radius: 10px; border: 1px solid var(--error);
    color: var(--error); overflow-wrap: anywhere;
}

.scope { list-style: none; margin: 0 0 28px; padding: 14px 16px; border-radius: 12px; background: var(--branch); }
.scope li { display: flex; gap: 10px; align-items: flex-start; padding: 3px 0; }
.scope svg { width: 20px; height: 20px; flex: none; margin-top: 1px; }
.scope .can svg { color: var(--ok); }
.scope .cannot { color: var(--slate); }

.block { margin-bottom: 8px; }
h2 { font-size: 15px; font-weight: 650; margin: 0 0 10px; }

.accounts { list-style: none; margin: 0 0 12px; padding: 0; }
.account {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 0; border-bottom: 1px solid var(--rule);
}
.account:first-child { border-top: 1px solid var(--rule); }
.account-mark { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 8px; background: var(--branch); }
.account-name { flex: 1; min-width: 0; display: grid; }
.account-name strong { font-weight: 600; overflow-wrap: anywhere; }
.account-name span { color: var(--slate); font-size: 13px; overflow-wrap: anywhere; }
.empty { color: var(--slate); margin: 0 0 12px; }

.providers { display: grid; gap: 8px; margin-bottom: 10px; }
.provider {
    display: flex; align-items: center; justify-content: center; gap: 10px;
    min-height: 44px; padding: 0 16px;
    border: 1px solid var(--rule); border-radius: 10px;
    background: var(--sheet); color: var(--ink);
    font-weight: 600; text-decoration: none;
}
.provider:hover { border-color: var(--slate); }
.mark-gitlab { color: #fc6d26; }

.hint { color: var(--slate); font-size: 13px; margin: 0 0 12px; }
.hint a, .trust a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
code { font: 12.5px ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--branch); padding: 1px 5px; border-radius: 5px; }

.disclosure { border-top: 1px solid var(--rule); }
.disclosure-last { border-bottom: 1px solid var(--rule); }
.disclosure summary {
    display: flex; align-items: center; gap: 8px;
    min-height: 48px; cursor: pointer; list-style: none; font-weight: 600;
}
.disclosure summary::-webkit-details-marker { display: none; }
.disclosure summary::after {
    content: ""; margin-left: auto; width: 8px; height: 8px;
    border-right: 2px solid var(--slate); border-bottom: 2px solid var(--slate);
    transform: rotate(45deg) translate(-2px, -2px);
}
.disclosure[open] summary::after { transform: rotate(-135deg) translate(-2px, -2px); }
.optional { color: var(--slate); font-weight: 400; font-size: 13px; }
.fields { display: grid; gap: 12px; padding-bottom: 16px; }
.fields .fields { padding-bottom: 0; }
.saved { margin: 0; font-size: 13px; overflow-wrap: anywhere; }

label { display: grid; gap: 6px; font-size: 13px; font-weight: 600; }
input, select {
    font: inherit; font-weight: 400; width: 100%; min-height: 42px; padding: 0 12px;
    border: 1px solid var(--rule); border-radius: 10px;
    background: var(--sheet); color: var(--ink);
}

button { font: inherit; cursor: pointer; }
.primary, .secondary { min-height: 46px; border-radius: 10px; font-weight: 600; width: 100%; }
.primary { margin-top: 24px; border: 0; background: var(--ink); color: var(--on-ink); }
.primary:disabled { opacity: .35; cursor: not-allowed; }
.secondary { min-height: 42px; border: 1px solid var(--rule); background: var(--branch); color: var(--ink); }
.quiet { border: 0; background: none; padding: 6px 2px; color: var(--slate); font-size: 13px; }
.quiet:hover { color: var(--ink); }
.cancel { text-align: center; margin-top: 6px; }

a:focus-visible, button:focus-visible, input:focus-visible, select:focus-visible, summary:focus-visible {
    outline: 2px solid var(--focus); outline-offset: 2px;
}

.trust {
    display: flex; gap: 10px; align-items: flex-start;
    margin-top: 24px; padding-top: 18px; border-top: 1px solid var(--rule);
    color: var(--slate); font-size: 12.5px;
}
.trust svg { width: 18px; height: 18px; flex: none; margin-top: 1px; }
.trust p { margin: 0; }
`
