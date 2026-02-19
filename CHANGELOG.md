# Changelog
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
