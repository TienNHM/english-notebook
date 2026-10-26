# Documentation

| Document | For | Content |
|---|---|---|
| [USER-GUIDE.md](USER-GUIDE.md) | Learners (Vietnamese) | Using the app, review, rewards, PWA, sharing, AI agent. |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Developers | System landscape, components, flows (sequence diagrams), data model, deployment, security, design decisions. |
| [OPERATIONS.md](OPERATIONS.md) | Owner / operator | Setup and deploy of Firebase, Pages, Worker, MCP/plugin; releases; secrets; cost; troubleshooting. |
| [../worker/README.md](../worker/README.md) | Developers | Agent API reference and tests. |
| [MCP repo](https://github.com/TienNHM/english-notebook-mcp#readme) | Agent users | MCP tools, plugin install, English Coach skill. |

`docs/screenshots/` are the pictures used in the main README.

## Diagrams

`docs/diagrams/` holds each diagram as `.html` (source of truth, self-contained, opens in any browser), `.svg` (used in the docs) and `.png` (slides, chat).
They follow the app palette through the diagram-design profile named in the `.diagram-design` file at the repo root. To change one: edit its `.html`, then export again with the diagram-design skill (`/diagram-design:export-diagram <file>`).
