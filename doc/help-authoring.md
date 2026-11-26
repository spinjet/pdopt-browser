# Edit help and tutorial text

[Documentation index](README.md)

Edit the Markdown files in [help](help/). The filename matches the view ID used in [HelpPanel.vue](../src/HelpPanel.vue). View IDs are `data`, `network`, `states`, `queries`, `graph`, `distribution`, `samples`, `setup`, `run` and `explore`. The Help panel selects the matching file when the user changes view. The tutorial selector loads [cantilever.md](help/cantilever.md). The About dialog uses [about.md](about.md).

1. Update the appropriate Markdown file. Use headings, lists, tables, fenced code blocks and readable equations in plain text. Raw HTML is disabled.
2. Start `npm run dev` from the repository root and open Vite’s local URL. Choose **Help/Tutorial**, select **Help for this view** or **Cantilever tutorial**, and check the updated content at a narrow and wide panel width.
3. For a new view, add its ID to the help view type, route to it in the app, and add a matching Markdown file. For a new diagram referenced by a help page, import the asset in the help component and map the Markdown path to the bundled URL, as the cantilever SVG does.
4. Run `npm run build` to verify that the Markdown and assets are bundled. Mermaid diagrams in the maintainer manual render on GitHub.
