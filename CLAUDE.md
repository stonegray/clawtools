# CLAUDE.md

## Project Context

**clawtools** is a platform-agnostic adapter NPM library that exposes OpenClaw's tools and connectors to external services.

### Purpose
This library serves as a bridge between OpenClaw's tool and connector systems and third-party software. It implements no domain-specific features—it only exposes the underlying OpenClaw capabilities.

### Architecture
- **tools/**: Interface and adapters for OpenClaw's tool system
- **connectors/**: Interface and adapters for OpenClaw's connector system to external services
- **openclaw/**: Submodule containing the actual OpenClaw implementation

### Key Principles
1. Platform-agnostic: Works across different environments
2. Minimal wrapper: Exposes functionality without adding business logic
3. Third-party friendly: Designed as an NPM library for external consumption

### Dependencies
- OpenClaw (via git submodule at `./openclaw`)

## Development Notes

- Uses TypeScript for type safety
- Tests are in `tests/`
- respec/ contains architecture documentation
