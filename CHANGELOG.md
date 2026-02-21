# Changelog

All notable changes to this project will be documented in this file. See [standard-version](https://github.com/conventional-changelog/standard-version) for commit guidelines.

## [1.9.0](https://github.com/fgbona/kubebeaver/compare/v1.8.0...v1.9.0) (2026-02-21)


### Features

* **analyzer:** integrate intelligence engine into analysis pipeline ([65fdb4e](https://github.com/fgbona/kubebeaver/commit/65fdb4e4f04e96419c9f480a9b9be5144a66b5c1))
* **frontend:** add DiagnosticEngine types and Engine Signals UI section ([93fa8a5](https://github.com/fgbona/kubebeaver/commit/93fa8a58ee15a9f4f8336c89cd24dc3f843c400e))
* **frontend:** make engine signals visible without expanding ([7470a7d](https://github.com/fgbona/kubebeaver/commit/7470a7daeb61674280c5251dca0b1e6bce5809e0))
* **intelligence:** add deterministic signal extraction module ([a8da7ac](https://github.com/fgbona/kubebeaver/commit/a8da7ac4099e3393b3dd208e34c932a169b8da88))
* **intelligence:** add heuristic classifier with numeric confidence ([0b7dbbd](https://github.com/fgbona/kubebeaver/commit/0b7dbbddf0d589bd759e049a5c4012c5dc0f86a0))
* **intelligence:** add scoring and engine orchestration ([c5ff962](https://github.com/fgbona/kubebeaver/commit/c5ff96244cfa0dbb774d9810d0b0c426540f050c))
* **models:** add DiagnosticEngine, EngineSignals, EngineFinding to AnalyzeResponse ([b53c0d0](https://github.com/fgbona/kubebeaver/commit/b53c0d0659834cddc4e9878143ff19f060a41ee6))


### Bug Fixes

* **intelligence:** improve signals robustness and add missing edge case tests ([fa244c0](https://github.com/fgbona/kubebeaver/commit/fa244c0aeb2399ff105093e72e4000c8ac207f7d))

## [1.8.0](https://github.com/fgbona/kubebeaver/compare/v1.7.0...v1.8.0) (2026-02-20)


### Features

* add support for DaemonSet, ReplicaSet, Job, and CronJob ([1f6027a](https://github.com/fgbona/kubebeaver/commit/1f6027a2345d89db7a9bcb874c14a1482106136e))


### Documentation

* add mascot to README and update resource type documentation ([a665499](https://github.com/fgbona/kubebeaver/commit/a665499c5b68c2f701ced99d8e4a89823db6f470))
* add mascot to README and update resource type documentation ([a19a4cd](https://github.com/fgbona/kubebeaver/commit/a19a4cdae295b6ea8d1eaf80d13f3fb03746fce2))

## [1.7.0](https://github.com/fgbona/kubebeaver/compare/v1.6.1...v1.7.0) (2026-02-19)


### Features

* Change history view by context ([f12ce75](https://github.com/fgbona/kubebeaver/commit/f12ce756d5697715821d7bb69511edb94768f3b5))
* Changed history by context ([5ca07fb](https://github.com/fgbona/kubebeaver/commit/5ca07fbf1057160180002cd4e458fedc314b422e))
* Ui modernization attempt ([15f9a30](https://github.com/fgbona/kubebeaver/commit/15f9a3016f9c6636899d9e94aa65c299eea3705c))
* ui modernized ([a4182f7](https://github.com/fgbona/kubebeaver/commit/a4182f70db47a8304159e83f44fc8cce8334af02))

### [1.6.1](https://github.com/fgbona/kubebeaver/compare/v1.6.0...v1.6.1) (2026-02-19)


### Bug Fixes

* Added cryptography to pyproject.toml ([8073c43](https://github.com/fgbona/kubebeaver/commit/8073c438426daff9f97f94b0ffcadbf7d2e82dbb))
* Fixed context changes ([7a5607b](https://github.com/fgbona/kubebeaver/commit/7a5607b5f22475249a79d1631779a6115353ba48))

## [1.6.0](https://github.com/fgbona/kubebeaver/compare/v1.5.2...v1.6.0) (2026-02-19)


### Features

* New design ([68e6aed](https://github.com/fgbona/kubebeaver/commit/68e6aed573359228c12a428e67c97790a054f3e6))

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
