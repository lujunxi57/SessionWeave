# SessionWeave

A local-first visual orchestrator for persistent coding-agent sessions.

SessionWeave connects real, long-lived Codex, OpenCode, and other coding-agent conversations into observable, steerable, and recoverable workflows.

## Project direction

- Treat a conversation as a persistent resource and a graph node as one execution step.
- Pass an upstream assistant result into downstream sessions through prompt templates.
- Use native harness protocols for discovery, messaging, status, completion, and recovery.
- Keep workflow execution local-first while supporting remote hosts through SSH.
- Allow users to pause scheduling, edit future steps, approve actions, and take over a live session.

## Documentation

- [设计思路](docs/设计思路.md)
- [开源仓库调研与复用建议](docs/开源仓库调研与复用建议.md)

## Status

Early design and prototyping.
