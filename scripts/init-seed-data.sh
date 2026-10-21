#!/bin/bash
set -e

# Configuration
COUCHDB_HOST="${COUCHDB_HOST:-localhost}"
COUCHDB_PORT="${COUCHDB_PORT:-5984}"
COUCHDB_USER="${COUCHDB_USER:-admin}"
COUCHDB_PASSWORD="${COUCHDB_PASSWORD:-admin}"
SEED_DIR="${SEED_DIR:-/opt/couchdb/seed_data}"
DESIGN_DOCS_DIR="${DESIGN_DOCS_DIR:-/opt/couchdb/design_docs_build}"
# Marker file recording which scenario has been initialized (its content is the scenario name)
INIT_MARKER="${INIT_MARKER:-/opt/couchdb/data/.seed_initialized}"
SCENARIO="${SCENARIO:-stage}"
VIEWS_CONFIG="${VIEWS_CONFIG:-/opt/couchdb/views_config.yaml}"
VIEWS_DIR="${VIEWS_DIR:-/opt/couchdb/StatusDB_views}"

COUCHDB_URL="http://${COUCHDB_USER}:${COUCHDB_PASSWORD}@${COUCHDB_HOST}:${COUCHDB_PORT}"

# Databases created for the current scenario (one per line)
CREATED_DATABASES=""

# Wait for CouchDB to be ready
wait_for_couchdb() {
    echo "Waiting for CouchDB to be ready..."
    local max_attempts=30
    local attempt=1

    while [ $attempt -le $max_attempts ]; do
        if curl -s "${COUCHDB_URL}/_up" | grep -q '"status":"ok"'; then
            echo "CouchDB is ready!"
            return 0
        fi
        echo "Attempt $attempt/$max_attempts: CouchDB not ready yet..."
        sleep 2
        attempt=$((attempt + 1))
    done

    echo "ERROR: CouchDB failed to start within expected time"
    return 1
}

# Create system databases required by CouchDB
create_system_databases() {
    echo "Creating system databases..."
    for db in _users _replicator _global_changes; do
        curl -s -X PUT "${COUCHDB_URL}/${db}" > /dev/null 2>&1 || true
    done
}

# Create a database if it doesn't exist
create_database() {
    local db_name="$1"
    echo "Creating database: ${db_name}"
    local response http_code body
    response=$(curl -s -w $'\n%{http_code}' -X PUT "${COUCHDB_URL}/${db_name}") || {
        echo "ERROR: Could not reach CouchDB while creating '${db_name}'" >&2
        return 1
    }
    http_code="${response##*$'\n'}"
    body="${response%$'\n'*}"

    if [ "$http_code" = "201" ]; then
        echo "  Database '${db_name}' created successfully"
    elif [ "$http_code" = "412" ]; then
        echo "  Database '${db_name}' already exists"
    else
        echo "ERROR: Unexpected response creating '${db_name}': ${http_code} ${body}" >&2
        return 1
    fi
}

# Perform a CouchDB request, storing the HTTP status in HTTP_CODE and the
# response body in HTTP_BODY. Returns non-zero on transport errors.
couch_request() {
    local method="$1"
    local url="$2"
    local data_file="$3"
    local response

    response=$(curl -s -w $'\n%{http_code}' -X "$method" "$url" \
        -H "Content-Type: application/json" \
        -d @"$data_file") || return 1

    HTTP_CODE="${response##*$'\n'}"
    HTTP_BODY="${response%$'\n'*}"
}

# Load a single JSON document into a database.
# Returns non-zero if the document could not be loaded, so that
# initialization is never marked as complete on partial failure.
load_document() {
    local db_name="$1"
    local json_file="$2"
    local doc_id rev tmp_payload
    doc_id=$(jq -r '._id // empty' "$json_file" 2>/dev/null) || doc_id=""

    if [ -n "$doc_id" ]; then
        # Document has an _id, use PUT (upsert if it already exists)
        echo "  Loading document '${doc_id}' into '${db_name}'..."
        local url="${COUCHDB_URL}/${db_name}/${doc_id}"

        if ! couch_request PUT "$url" "$json_file"; then
            echo "ERROR: Could not reach CouchDB while loading '${doc_id}' into '${db_name}'" >&2
            return 1
        fi

        if [ "$HTTP_CODE" = "409" ]; then
            # Document already exists: fetch its current revision and overwrite it
            rev=$(curl -s "$url" | jq -r '._rev // empty')
            if [ -z "$rev" ]; then
                echo "ERROR: Document '${doc_id}' exists in '${db_name}' but its revision could not be retrieved" >&2
                return 1
            fi
            tmp_payload=$(mktemp)
            if ! jq --arg rev "$rev" '._rev = $rev' "$json_file" > "$tmp_payload"; then
                rm -f "$tmp_payload"
                echo "ERROR: Could not update revision of '${doc_id}': invalid JSON in '$json_file'" >&2
                return 1
            fi
            if ! couch_request PUT "$url" "$tmp_payload"; then
                rm -f "$tmp_payload"
                echo "ERROR: Could not reach CouchDB while updating '${doc_id}' in '${db_name}'" >&2
                return 1
            fi
            rm -f "$tmp_payload"
        fi

        if [ "$HTTP_CODE" != "201" ]; then
            echo "ERROR: Failed to load document '${doc_id}' into '${db_name}': ${HTTP_CODE} ${HTTP_BODY}" >&2
            return 1
        fi
    else
        # No _id, use POST to auto-generate
        echo "  Loading document from '$(basename "$json_file")' into '${db_name}'..."
        if ! couch_request POST "${COUCHDB_URL}/${db_name}" "$json_file"; then
            echo "ERROR: Could not reach CouchDB while loading '$(basename "$json_file")' into '${db_name}'" >&2
            return 1
        fi
        if [ "$HTTP_CODE" != "201" ]; then
            echo "ERROR: Failed to load document from '$(basename "$json_file")' into '${db_name}': ${HTTP_CODE} ${HTTP_BODY}" >&2
            return 1
        fi
    fi
}

# Compute the databases to create for this scenario:
# every database that belongs to the scenario according to views_config.yaml
# (both seed data databases and databases with design documents), plus the
# legacy 'statusdb' if top-level JSON files exist.
databases_to_create() {
    local allowed_dbs db_dir json_file

    # --list-databases returns all databases included in the scenario, so no
    # design docs need to be built before the databases can be created
    if allowed_dbs=$(python3 /opt/couchdb/scripts/validate_views_config.py \
        --list-databases \
        --scenario "$SCENARIO" \
        --config "$VIEWS_CONFIG" \
        --seed-dir "$SEED_DIR" 2>/dev/null); then
        echo "$allowed_dbs"
    else
        echo "WARNING: Could not determine databases for scenario '${SCENARIO}', including all seed data databases" >&2
        for db_dir in "$SEED_DIR"/*/; do
            [ -d "$db_dir" ] && basename "$db_dir"
        done
    fi

    # Legacy top-level JSON files are loaded into a 'statusdb' database
    for json_file in "$SEED_DIR"/*.json; do
        if [ -f "$json_file" ]; then
            echo "statusdb"
            break
        fi
    done
}

# Create all databases belonging to this scenario (seed data and design doc databases)
create_databases() {
    echo "Creating databases for scenario: ${SCENARIO}..."
    CREATED_DATABASES=$(databases_to_create | sort -u)

    if [ -z "$CREATED_DATABASES" ]; then
        echo "No databases to create for scenario '${SCENARIO}'"
        return 0
    fi

    echo "Databases to create: $(echo "$CREATED_DATABASES" | tr '\n' ' ')"
    local db_name
    while IFS= read -r db_name; do
        create_database "$db_name"
    done <<< "$CREATED_DATABASES"
}

# Load all seed data
load_seed_data() {
    echo "Loading seed data from ${SEED_DIR}..."

    # Check if seed directory exists and has files
    if [ ! -d "$SEED_DIR" ]; then
        echo "Seed directory not found: ${SEED_DIR}"
        return 0
    fi

    # Load database-specific directories
    # Structure: seed/<database_name>/*.json
    for db_dir in "$SEED_DIR"/*/; do
        if [ -d "$db_dir" ]; then
            local db_name=$(basename "$db_dir")
            if ! grep -qxF "$db_name" <<< "$CREATED_DATABASES"; then
                echo "Skipping database: ${db_name} (not created for scenario '${SCENARIO}')"
                continue
            fi
            echo "Processing database: ${db_name}"

            # Load all JSON files in the database directory
            for json_file in "$db_dir"/*.json; do
                if [ -f "$json_file" ]; then
                    load_document "$db_name" "$json_file"
                fi
            done
        fi
    done

    # Also load any top-level JSON files into a 'statusdb' database (legacy support)
    for json_file in "$SEED_DIR"/*.json; do
        if [ -f "$json_file" ]; then
            load_document "statusdb" "$json_file"
        fi
    done

    echo "Seed data loading complete!"
}

# Build design documents based on scenario.
# This only generates JSON files in DESIGN_DOCS_DIR, it does not write
# anything to CouchDB (that happens in deploy_design_docs).
create_design_docs() {
    echo "Building design documents for scenario: ${SCENARIO}..."

    if [ ! -f "$VIEWS_CONFIG" ]; then
        echo "Views config not found: ${VIEWS_CONFIG}"
        return 0
    fi

    if [ ! -d "$VIEWS_DIR" ]; then
        echo "Views directory not found: ${VIEWS_DIR}"
        return 0
    fi

    if ! python3 /opt/couchdb/scripts/validate_views_config.py \
        --build \
        --scenario "$SCENARIO" \
        --config "$VIEWS_CONFIG" \
        --views-dir "$VIEWS_DIR" \
        --design_docs_dir "$DESIGN_DOCS_DIR"; then
        echo "WARNING: Failed to build design documents for scenario '${SCENARIO}', continuing without them"
        return 0
    fi

    echo "Design documents build complete!"
}

# Load the built design documents into their databases (which already exist)
deploy_design_docs() {
    echo "Deploying design documents from ${DESIGN_DOCS_DIR}..."

    if [ ! -d "$DESIGN_DOCS_DIR" ]; then
        echo "Design docs directory not found: ${DESIGN_DOCS_DIR}"
        return 0
    fi

    for db_dir in "$DESIGN_DOCS_DIR"/*/; do
        if [ -d "$db_dir" ]; then
            local db_name=$(basename "$db_dir")
            if ! grep -qxF "$db_name" <<< "$CREATED_DATABASES"; then
                echo "Skipping design docs for database: ${db_name} (not created for scenario '${SCENARIO}')"
                continue
            fi
            echo "Processing design docs for database: ${db_name}"

            for json_file in "$db_dir"/*.json; do
                if [ -f "$json_file" ]; then
                    load_document "$db_name" "$json_file"
                fi
            done
        fi
    done

    echo "Design documents deployment complete!"
}

# Main execution
main() {
    # Check if we've already initialized this scenario
    if [ -f "$INIT_MARKER" ]; then
        local previous_scenario
        previous_scenario=$(cat "$INIT_MARKER" 2>/dev/null)
        if [ "$previous_scenario" = "$SCENARIO" ]; then
            echo "Seed data already initialized for scenario '${SCENARIO}', skipping..."
            exit 0
        fi
        echo "Marker found for scenario '${previous_scenario:-unknown}', current scenario is '${SCENARIO}'; re-initializing..."
    fi

    wait_for_couchdb
    create_system_databases
    create_databases
    load_seed_data
    create_design_docs
    deploy_design_docs

    # Record the initialized scenario so the next boot can skip initialization
    mkdir -p "$(dirname "$INIT_MARKER")"
    echo "$SCENARIO" > "$INIT_MARKER"
    echo "Initialization complete!"
}

main "$@"
