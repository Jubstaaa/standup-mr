export const PAGE_STYLE = `
:root {
    color-scheme: light dark;
    --bg: #fafaf9;
    --fg: #1c1917;
    --muted: #78716c;
    --line: #e7e5e4;
    --accent: #2563eb;
    --error: #b91c1c;
}
@media (prefers-color-scheme: dark) {
    :root {
        --bg: #0c0a09;
        --fg: #f5f5f4;
        --muted: #a8a29e;
        --line: #292524;
        --accent: #60a5fa;
        --error: #f87171;
    }
}
* { box-sizing: border-box; }
body {
    margin: 0;
    background: var(--bg);
    color: var(--fg);
    font: 16px/1.5 system-ui, -apple-system, sans-serif;
}
main { max-width: 34rem; margin: 0 auto; padding: 2rem 1rem 3rem; }
h1 { font-size: 1.5rem; margin: 0 0 .5rem; }
h2 { font-size: 1rem; margin: 0 0 .5rem; }
section { border-top: 1px solid var(--line); padding: 1.25rem 0; }
.muted { color: var(--muted); }
.small { font-size: .875rem; }
.error { color: var(--error); border: 1px solid var(--error); border-radius: .5rem; padding: .5rem .75rem; }
.accounts { list-style: none; padding: 0; margin: 0 0 1rem; }
.accounts li { display: flex; justify-content: space-between; align-items: center; gap: .5rem; padding: .375rem 0; overflow-wrap: anywhere; }
.row { display: flex; flex-wrap: wrap; gap: .5rem; }
.stack { display: grid; gap: .5rem; }
label { display: grid; gap: .25rem; font-size: .875rem; }
input, select {
    font: inherit; width: 100%; padding: .5rem .625rem;
    border: 1px solid var(--line); border-radius: .5rem; background: transparent; color: inherit;
}
button, .button {
    font: inherit; display: inline-block; text-decoration: none; cursor: pointer;
    padding: .5rem .875rem; border-radius: .5rem;
    border: 1px solid var(--line); background: transparent; color: inherit;
}
.primary { width: 100%; margin-top: 1rem; background: var(--accent); border-color: var(--accent); color: #fff; }
.primary:disabled { opacity: .5; cursor: not-allowed; }
.link { border: 0; padding: .25rem 0; color: var(--accent); background: none; }
a { color: var(--accent); }
footer { margin-top: 2rem; }
`
