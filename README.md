# Stellar Schematic

Stellar Schematic is a VS Code extension that scans JavaScript modules in the current workspace and renders a relationship diagram.

## What It Does

- Scans workspace JavaScript files (`.js`, `.cjs`, `.mjs`, `.jsx`)
- Detects classes, top-level functions, fields, imports, and exports
- Builds a Mermaid-based relationship graph
- Runs directly in a VS Code webview panel
- Opens source files directly from graph/detail selections

## Commands

- `SS: Start`

## Development

Install dependencies:

```bash
npm install
```

Lint:

```bash
npm run lint
```

Package for Marketplace:

```bash
npm run package
```

Run extension in debug mode:

1. Open this project in VS Code
2. Press `F5`
3. Run `SS: Start` command from the Command Palette

## Architecture Notes

- `extension.js`: VS Code entrypoint, command registration, webview controller
- `src/app/workspaceScanner.js`: Babel AST-based workspace scanner
- `src/app/frontend/scripts/store.js`: UI state management and scan orchestration
- `src/app/frontend/scripts/workspace-ui.js`: UI rendering and event handling
- `src/app/frontend/scripts/graph.js`: Mermaid diagram generation, zoom, pan

## Scope

- Focused on JavaScript-family files
- Uses static code analysis (runtime behavior is not executed)

## License

- Project license: [MIT](LICENSE)
- Third-party dependency summary: [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md)
