// Génère la page d'accueil (public/index.html) à partir du README, au déploiement.
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { marked } from "marked";

const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
const body = marked.parse(readme);

const html = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>guest-suite-mcp</title>
<meta name="description" content="Serveur MCP pour envoyer des demandes d'avis à Guest Suite depuis Claude.">
<style>
:root{--bg:#fbfaf7;--fg:#1f2421;--muted:#5d655f;--line:#e2e0d8;--code:#f0eee7;--accent:#1f6f50;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#161a18;--fg:#e8e6df;--muted:#a3aaa4;--line:#2e3430;--code:#212724;--accent:#7fd1a8}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:760px;margin:0 auto;padding:40px max(20px,env(safe-area-inset-left)) 64px}
h1{font-size:2rem;margin:0 0 .4em}h2{margin-top:2em;padding-bottom:.3em;border-bottom:1px solid var(--line)}h3{margin-top:1.6em}
a{color:var(--accent)}
code{font:.9em ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--code);padding:.1em .35em;border-radius:4px;overflow-wrap:anywhere}
pre{background:var(--code);padding:14px 16px;border-radius:8px;overflow-x:auto}pre code{padding:0;background:none}
table{border-collapse:collapse;width:100%;display:block;overflow-x:auto}th,td{text-align:left;vertical-align:top;padding:8px 10px;border-bottom:1px solid var(--line)}
img{max-width:100%}
td code{white-space:nowrap;overflow-wrap:normal}
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;

await mkdir(new URL("../public/", import.meta.url), { recursive: true });
await writeFile(new URL("../public/index.html", import.meta.url), html);
console.log("public/index.html généré");
