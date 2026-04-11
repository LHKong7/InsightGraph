"""Build InsightGraph server as a standalone binary using PyInstaller.

Usage:
    cd python
    uv run python scripts/build-binary.py

Output:
    python/dist/insightgraph-server/   (directory with executable)

Prerequisites:
    uv add --dev pyinstaller
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


def main() -> None:
    root = Path(__file__).resolve().parent.parent  # python/
    entry = root / "scripts" / "server_entry.py"

    if not entry.exists():
        print(f"Error: {entry} not found")
        sys.exit(1)

    # Collect all insightgraph packages as hidden imports
    hidden_imports = [
        "insightgraph_core",
        "insightgraph_core.config",
        "insightgraph_core.domain",
        "insightgraph_core.ir",
        "insightgraph_core.ir.models",
        "insightgraph_core.ir.extraction",
        "insightgraph_core.ontology",
        "insightgraph_core.ontology.loader",
        "insightgraph_core.ontology.schema",
        "insightgraph_ingestion",
        "insightgraph_parser",
        "insightgraph_parser.pdf",
        "insightgraph_parser.csv_parser",
        "insightgraph_parser.json_parser",
        "insightgraph_extractor",
        "insightgraph_extractor.pipeline",
        "insightgraph_extractor.entity",
        "insightgraph_extractor.metric",
        "insightgraph_extractor.claim",
        "insightgraph_extractor.relationship",
        "insightgraph_resolver",
        "insightgraph_graph",
        "insightgraph_graph.connection",
        "insightgraph_graph.writer",
        "insightgraph_graph.reader",
        "insightgraph_graph.schema",
        "insightgraph_graph.embedding_writer",
        "insightgraph_retriever",
        "insightgraph_retriever.tools",
        "insightgraph_retriever.graph_retriever",
        "insightgraph_retriever.vector_retriever",
        "insightgraph_retriever.hybrid_retriever",
        "insightgraph_retriever.embeddings",
        "insightgraph_retriever.cross_report",
        "insightgraph_retriever.analytics",
        "insightgraph_agent",
        "insightgraph_agent.orchestrator",
        "insightgraph_agent.planner",
        "insightgraph_agent.analyst",
        "insightgraph_agent.verifier",
        "insightgraph_agent.retriever_agent",
        "insightgraph_agent.session",
        "insightgraph_api",
        "insightgraph_api.main",
        "insightgraph_api.routes.health",
        "insightgraph_api.routes.ingestion",
        "insightgraph_api.routes.query",
        "insightgraph_api.routes.search",
        "insightgraph_api.routes.agent",
    ]

    # Data files: ontology YAML
    data_files = [
        (
            str(root / "packages" / "core" / "src" / "insightgraph_core" / "ontology"),
            "insightgraph_core/ontology",
        ),
    ]

    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--name=insightgraph-server",
        "--onedir",
        "--noconfirm",
        f"--distpath={root / 'dist'}",
        f"--workpath={root / 'build'}",
        f"--specpath={root / 'build'}",
    ]

    for imp in hidden_imports:
        cmd.append(f"--hidden-import={imp}")

    for src, dst in data_files:
        cmd.append(f"--add-data={src}:{dst}")

    cmd.append(str(entry))

    print(f"Running: {' '.join(cmd[:5])} ... ({len(hidden_imports)} hidden imports)")
    result = subprocess.run(cmd, cwd=str(root))

    if result.returncode == 0:
        print(f"\nBuild successful! Binary at: {root / 'dist' / 'insightgraph-server'}")
    else:
        print(f"\nBuild failed with exit code {result.returncode}")
        sys.exit(result.returncode)


if __name__ == "__main__":
    main()
