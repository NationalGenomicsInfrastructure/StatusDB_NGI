# StatusDB NGI

Holds views and test data to fire up a dev instance of StatusDB (CouchDB). This repository replaces the StatusDB_views repository which was kept private.
The [databases](/DATABASES.md) documentation attempts to give an overview of each database and explain its purpose.

# Views
The first part of this repository is the code for the CouchDB views used for the NGI Stockholm StatusDB. The views are organised in the `StatusDB_views` directory and listed in `views_config.yaml`.

## History
StatusDB_views was kept private since it could contain some project details or other details that were not supposed to be public. This decision was changed in 2026, since there is no real reason to keep sensitive information in this repository. The content was moved to StatusDB_NGI without its git history, which might still contain details that were not supposed to be public. Here are the contributors of the old repository:

## Contributors of historic StatusDB_Views repository
- @aanil
- @alneberg
- @galithil
- @kedhammar
- @chuan-wang
- @remiolsen
- @kate-v-stepanova
- @silverslott
- @ewels
- @vezzi
- @sylvinite
- @ssjunnebo
- @FranBonath
- @pekrau
- @mariogiov

Thank you!

## Views directory structure
The views are located in the directory `StatusDB_views` inside the repo and are subsequently organised into directories for databases and design documents.
Each view consists of one or two files, one for the map function and one (optional) for the reduce function.
They need to follow the naming pattern `<view_name>.map.js` and `<view_name>.reduce.js`.

Each database, design document and view is listed in the config file `views_config.yaml`.

## Checking and updating views_config.yaml
To check that `views_config.yaml` is in sync with the repository content, use `scripts/validate_views_config.py`:

```
> python3 scripts/validate_views_config.py --config views_config.yaml --views-dir StatusDB_views --check
✅ Config is up to date with directory structure
```

To update the config from the directory structure (new views default to `scenarios: [stage]`):
```
> python3 scripts/validate_views_config.py --config views_config.yaml --views-dir StatusDB_views --update
```

# Seed Data
The second part of this repository is the seed data, which is mock data for testing and demoing the internal services that use StatusDB as their backend. The data lives in the `seed_data` directory, is copied into the Docker image, and is loaded into CouchDB on first startup.

## Seed Data Structure

The `seed_data/` directory contains JSON documents that are loaded into CouchDB on startup.

### Directory Structure

```
seed_data/
├── <database_name>/     # Creates a database and loads all JSON files into it
    ├── doc1.json
    └── doc2.json
```

JSON files placed directly in `seed_data/` (legacy layout) are loaded into a `statusdb` database.

### Document Format

Each JSON file should contain a single CouchDB document. If the document has an `_id` field, it will be used as the document ID. Otherwise, CouchDB will auto-generate an ID.

Example document (abridged from `seed_data/projects/P12345.json`):

```json
{
  "_id": "P12345",
  "project_id": "P12345",
  "project_name": "Test RNA-seq Project",
  "application": "RNA-seq",
  "status": "ongoing",
  ...
}
```

# Docker Image

The Docker image is most commonly used in the docker-compose setup for genomics-status (see [Using with Genomics Status](#using-with-genomics-status)), where it is built automatically as part of the setup. To use the image standalone, build it with:

```
cd StatusDB_NGI
docker build -t statusdb_ngi .
```

and start a container with

```bash
docker run -d \
  -p 5984:5984 \
  -e COUCHDB_USER=admin \
  -e COUCHDB_PASSWORD=admin \
  statusdb_ngi
```

After this, CouchDB will be available at:

- API: <http://localhost:5984>
- Fauxton UI: <http://localhost:5984/_utils>
- Credentials: `admin` / `admin`

On first startup, the seed data and the design documents from `StatusDB_views` are loaded into CouchDB. What is loaded is controlled by *scenarios*, selected with the `SCENARIO` environment variable (default: `stage`).

A scenario decides which databases and views are created:

- A database can list the scenarios it belongs to with a `scenarios` key in `views_config.yaml`. A database without a `scenarios` key is included in all scenarios.
- Inside an included database, a view is only deployed if the scenario is also in the view's own `scenarios` list.
- Seed data follows the database: if a database is not included in the scenario, the database is not created and its seed documents are not loaded.

Initialization is tracked per scenario, so it only runs on the first startup for a given scenario. Changing `SCENARIO` triggers a new initialization on the next startup; loading is idempotent, so documents that already exist are overwritten.

Currently the only scenario in use is `stage`, where all databases, views and seed data are loaded.

### Persisting Data

To persist data between container restarts:

```bash
docker run -d \
  -p 5984:5984 \
  -e COUCHDB_USER=admin \
  -e COUCHDB_PASSWORD=admin \
  -v couchdb-data:/opt/couchdb/data \
  ghcr.io/scilifelab/StatusDB_NGI:latest
```


## Building the Image Locally

```bash
docker build -t StatusDB_NGI .
docker run -p 5984:5984 -e COUCHDB_USER=admin -e COUCHDB_PASSWORD=admin StatusDB_NGI
```

## Container registry
A GitHub workflow (`.github/workflows/docker-publish.yml`) for building and publishing the image to ghcr.io is in place, but the publish job is currently disabled.

## Using with Genomics Status

The [genomics-status](https://github.com/SciLifeLab/genomics-status) repository is configured to use this image in its docker compose setup. When starting docker compose, the image is built automatically and the seed data is loaded on startup, using the `stage` scenario.
