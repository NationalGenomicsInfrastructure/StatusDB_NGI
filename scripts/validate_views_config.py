import yaml
from pathlib import Path
import argparse
import json
import urllib.request
import urllib.error
from base64 import b64encode

def scan_views_directory(views_dir):
    """Scan the views directory and return a config-like structure."""
    databases = {}
    if not views_dir.exists():
        return {"databases": databases}

    for db_path in sorted(views_dir.iterdir()):
        if not db_path.is_dir():
            continue
        db_name = db_path.name
        databases[db_name] = {"design_docs": {}}
        for item in sorted(db_path.iterdir()):
            if item.is_dir():
                design_doc_name = item.name
                databases[db_name]["design_docs"][design_doc_name] = {"views": {}}
                for view_file in sorted(item.glob("*.map.js")):
                    view_name = view_file.stem.replace('.map', '')
                    reduce_file = item / f"{view_name}.reduce.js"
                    databases[db_name]["design_docs"][design_doc_name]["views"][view_name] = {
                        "reduce": reduce_file.exists()
                    }
            elif item.is_dir() and item.name == "_design":
                for design_doc_path in sorted(item.iterdir()):
                    if design_doc_path.is_dir():
                        design_doc_name = design_doc_path.name
                        databases[db_name]["design_docs"][design_doc_name] = {"views": {}}
                        for view_file in sorted(design_doc_path.glob("*.map.js")):
                            view_name = view_file.stem.replace(".map", "")
                            reduce_file = design_doc_path / f"{view_name}.reduce.js"
                            databases[db_name]["design_docs"][design_doc_name]["views"][view_name] = {
                                "reduce": reduce_file.exists()
                            }
    return {"databases": databases}

def load_config(config_path):
    """Load the existing config file."""
    if not config_path.exists():
        return {"databases": {}}
    with open(config_path, "r") as f:
        return yaml.safe_load(f) or {"databases": {}}

def save_config(config, config_path):
    """Save the config to file."""
    with open(config_path, "w") as f:
        yaml.dump(config, f, default_flow_style=False, sort_keys=False)

def compare_and_report(scanned_config, loaded_config):
    """Compare scanned and loaded configs, report differences."""
    scanned_dbs = scanned_config.get("databases", {})
    loaded_dbs = loaded_config.get("databases", {})
    all_ok = True

    for db_name in scanned_dbs:
        if db_name not in loaded_dbs:
            print(f"❌ Database '{db_name}' is in directory but missing from config")
            all_ok = False
            continue
        for doc_name in scanned_dbs[db_name].get("design_docs", {}):
            if doc_name not in loaded_dbs[db_name].get("design_docs", {}):
                print(f"❌ Design doc '{doc_name}' in '{db_name}' is in directory but missing from config")
                all_ok = False
                continue
            for view_name, view_config in scanned_dbs[db_name]["design_docs"][doc_name].get("views", {}).items():
                if view_name not in loaded_dbs[db_name]["design_docs"][doc_name].get("views", {}):
                    print(f"❌ View '{view_name}' in '{db_name}/{doc_name}' is in directory but missing from config")
                    all_ok = False
                elif view_config.get("reduce") != loaded_dbs[db_name]["design_docs"][doc_name]["views"][view_name].get("reduce"):
                    print(f"⚠️  Reduce flag mismatch for '{view_name}' in '{db_name}/{doc_name}'")

    for db_name in loaded_dbs:
        if db_name not in scanned_dbs:
            # Seed-only databases (no design docs) are allowed to be missing from the directory
            if loaded_dbs[db_name].get("design_docs"):
                print(f"⚠️  Database '{db_name}' is in config but missing from directory")
                all_ok = False
            continue
        for doc_name in loaded_dbs[db_name].get("design_docs", {}):
            if doc_name not in scanned_dbs[db_name].get("design_docs", {}):
                print(f"⚠️  Design doc '{doc_name}' in '{db_name}' is in config but missing from directory")
                all_ok = False
                continue
            for view_name in loaded_dbs[db_name]["design_docs"][doc_name].get("views", {}):
                if view_name not in scanned_dbs[db_name]["design_docs"][doc_name].get("views", {}):
                    print(f"⚠️  View '{view_name}' in '{db_name}/{doc_name}' is in config but missing from directory")
                    all_ok = False

    if all_ok:
        print("✅ Config is up to date with directory structure")
    return all_ok

def update_config(scanned_config, loaded_config):
    """Update the loaded config to match the scanned structure, preserving scenarios."""
    updated_config = {"databases": {}}
    for db_name, db_data in scanned_config.get("databases", {}).items():
        loaded_db = loaded_config.get("databases", {}).get(db_name, {}) or {}
        updated_db = {}
        # Preserve database-level scenarios
        if "scenarios" in loaded_db:
            updated_db["scenarios"] = loaded_db["scenarios"]
        updated_db["design_docs"] = {}
        for doc_name, doc_data in db_data.get("design_docs", {}).items():
            updated_db["design_docs"][doc_name] = {"views": {}}
            for view_name, view_config in doc_data.get("views", {}).items():
                # Get existing scenarios list, default to ["stage"]
                scenarios = loaded_db.get("design_docs", {}).get(doc_name, {}).get("views", {}).get(view_name, {}).get("scenarios", ["stage"])
                updated_db["design_docs"][doc_name]["views"][view_name] = {
                    "reduce": view_config["reduce"],
                    "scenarios": scenarios
                }
        updated_config["databases"][db_name] = updated_db
    # Preserve seed-only databases (in config but without design docs)
    for db_name, db_data in loaded_config.get("databases", {}).items():
        if db_name not in updated_config["databases"]:
            updated_db = {"design_docs": {}}
            if isinstance(db_data, dict) and "scenarios" in db_data:
                updated_db["scenarios"] = db_data["scenarios"]
            updated_config["databases"][db_name] = updated_db
    return updated_config

def db_in_scenario(db_data, scenario):
    """Check if a database is included in the scenario. No scenarios key means all scenarios."""
    scenarios = (db_data or {}).get("scenarios")
    if not scenarios:
        return True
    return scenario in scenarios

def filter_views_by_scenario(config, scenario):
    """Filter databases and views that include the specified scenario."""
    filtered = {"databases": {}}
    for db_name, db_data in config.get("databases", {}).items():
        if not db_in_scenario(db_data, scenario):
            continue
        design_docs = {}
        for doc_name, doc_data in db_data.get("design_docs", {}).items():
            views = {}
            for view_name, view_config in doc_data.get("views", {}).items():
                if scenario in view_config.get("scenarios", []):
                    views[view_name] = view_config
            if views:
                design_docs[doc_name] = {"views": views}
        if design_docs:
            filtered["databases"][db_name] = {"design_docs": design_docs}
    return filtered

def databases_for_scenario(config, scenario, seed_dir=None):
    """List databases included in the scenario.

    Includes config databases whose scenarios allow the scenario, plus
    seed-only databases (in seed_dir but not in config) which default to all scenarios.
    """
    config_dbs = config.get("databases", {}) or {}
    included = set()
    for db_name, db_data in config_dbs.items():
        if db_in_scenario(db_data, scenario):
            included.add(db_name)
    if seed_dir is not None:
        seed_dir = Path(seed_dir)
        if seed_dir.exists():
            for item in seed_dir.iterdir():
                if item.is_dir() and item.name not in config_dbs:
                    included.add(item.name)
    return sorted(included)

def build_design_doc(db_name, doc_name, views_config, views_dir):
    """Build a CouchDB design document from view files."""
    design_doc = {
        "_id": f"_design/{doc_name}",
        "language": "javascript",
        "views": {}
    }

    doc_path = views_dir / db_name / doc_name
    if not doc_path.exists():
        return None

    for view_name, view_config in views_config.items():
        map_file = doc_path / f"{view_name}.map.js"
        if not map_file.exists():
            continue

        design_doc["views"][view_name] = {
            "map": map_file.read_text()
        }

        if view_config.get("reduce"):
            reduce_file = doc_path / f"{view_name}.reduce.js"
            if reduce_file.exists():
                design_doc["views"][view_name]["reduce"] = reduce_file.read_text()

    return design_doc if design_doc["views"] else None

def build_design_docs(config, views_dir, design_docs_dir):
    """Build design documents for deployment."""
    design_docs_dir = Path(design_docs_dir)
    design_docs_dir.mkdir(parents=True, exist_ok=True)

    for db_name, db_data in config.get("databases", {}).items():
        db_dir = design_docs_dir / db_name
        db_dir.mkdir(parents=True, exist_ok=True)

        for doc_name, doc_data in db_data.get("design_docs", {}).items():
            design_doc = build_design_doc(db_name, doc_name, doc_data.get("views", {}), views_dir)
            if not design_doc:
                continue

            doc_file = db_dir / f"{doc_name}.json"
            doc_file.write_text(json.dumps(design_doc, indent=2))
            print(f"✅ Built {db_name}/{doc_name}.json")



def main():
    parser = argparse.ArgumentParser(description="Check or update CouchDB views config based on directory structure.")
    parser.add_argument("--config", default="config.yaml", help="Path to config file")
    parser.add_argument("--views-dir", default="views", help="Path to views directory")
    parser.add_argument("--check", action="store_true", help="Check if config is up to date")
    parser.add_argument("--update", action="store_true", help="Update config to match directory structure")
    parser.add_argument("--build", action="store_true", help="Build design documents for deployment")
    parser.add_argument("--list-databases", action="store_true", help="List databases included in the scenario (one per line)")
    parser.add_argument("--scenario", default="stage", help="Scenario to deploy (default: stage)")
    parser.add_argument("--design_docs_dir", default="design_docs_build", help="Directory to build design docs for deployment")
    parser.add_argument("--seed-dir", default="seed_data", help="Path to seed data directory (for --list-databases)")
    args = parser.parse_args()

    views_dir = Path(args.views_dir)
    config_path = Path(args.config)
    loaded_config = load_config(config_path)

    if args.list_databases:
        for db_name in databases_for_scenario(loaded_config, args.scenario, args.seed_dir):
            print(db_name)
    else:
        scanned_config = scan_views_directory(views_dir)
        if args.build:
            filtered_config = filter_views_by_scenario(loaded_config, args.scenario)
            print(f"Building design documents for scenario: {args.scenario}")
            build_design_docs(filtered_config, views_dir, args.design_docs_dir)
        elif args.update:
            updated_config = update_config(scanned_config, loaded_config)
            save_config(updated_config, config_path)
            print(f"✅ Config updated to match directory structure. File saved to {config_path}")
            compare_and_report(scanned_config, loaded_config)
        else:
            compare_and_report(scanned_config, loaded_config)

if __name__ == "__main__":
    main()