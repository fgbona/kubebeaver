# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

### [1.5.2](https://github.com/fgbona/kubebeaver/compare/v1.5.1...v1.5.2) (2026-02-19)


### Documentation

* CHANGELOG.md ([5b30c1e](https://github.com/fgbona/kubebeaver/commit/5b30c1ee4c5327fabb098809a772c81de7809792))

## [1.5.0](https://github.com/fgbona/kubebeaver/compare/v1.4.0...v1.5.0) (2026-02-19)


### Features

* Reliability + explainability upgrades ([18f6da7](https://github.com/fgbona/kubebeaver/commit/18f6da7a9d9950e70987e8a7c95565b793c9642c))

## [1.4.0](https://github.com/fgbona/kubebeaver/compare/v1.3.1...v1.4.0) (2026-02-19)


### Features

* updated README.md ([af912b7](https://github.com/fgbona/kubebeaver/commit/af912b75cda0e6a8254c389c0ddb088a4b88304f))

### [1.3.1](https://github.com/fgbona/kubebeaver/compare/v1.3.0...v1.3.1) (2026-02-19)


### Bug Fixes

* fix commit script ([107c8d0](https://github.com/fgbona/kubebeaver/commit/107c8d00b028026c380c418089a43087692d0f9b))

## [1.3.0](https://github.com/fgbona/kubebeaver/compare/v1.2.0...v1.3.0) (2026-02-19)


### Features

* Scheduled scans + notifications (webhook) ([a1cb73b](https://github.com/fgbona/kubebeaver/commit/a1cb73bcc5ca291acd4f486484430ac904b87afb))

## [1.2.0](https://github.com/fgbona/kubebeaver/compare/v1.1.0...v1.2.0) (2026-02-19)


### Features

* **Incident Mode** — group analyses and scans into incidents with a timeline and export ([90ac630](https://github.com/fgbona/kubebeaver/commit/90ac630d654ac561553516679a32acf95b25de8e))
  * Backend: entities `incidents`, `incident_items` (link analyses/scans), `incident_notes`; Alembic migration
  * API: `POST /api/incidents`, `POST /api/incidents/{id}/add`, `GET /api/incidents`, `GET /api/incidents/{id}` (timeline), `POST /api/incidents/{id}/export` (markdown/json), `POST /api/incidents/{id}/notes`
  * Frontend: new **Incidents** tab — create incident, add analysis/scan from history, add notes, view timeline, export Markdown or JSON (deterministic)
  * Timeline: incident creation, items (analyses/scans) and notes ordered by `created_at`
  * Repository tests for incident CRUD and timeline

## [1.1.0](https://github.com/fgbona/kubebeaver/compare/v1.0.4...v1.1.0) (2026-02-18)


### Features

* Analysis Comparison (diff view) ([3c7ba18](https://github.com/fgbona/kubebeaver/commit/3c7ba1805b21ece824de03a31112ebf5fcd72af0))

### 1.0.3 (2026-02-18)


### Features

* Added redis cache ([98accb7](https://github.com/fgbona/kubebeaver/commit/98accb71b6c35d640bf74f81311797e9f1fd9b0a))
* Released first version ([92e934f](https://github.com/fgbona/kubebeaver/commit/92e934f804107eaaa75cb844f0762ddd761dad1c))
