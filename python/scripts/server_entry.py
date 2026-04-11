"""Entry point for PyInstaller-packaged InsightGraph server.

Usage:
    ./insightgraph-server [--host HOST] [--port PORT]
"""

from __future__ import annotations

import argparse


def main() -> None:
    parser = argparse.ArgumentParser(description="InsightGraph API Server")
    parser.add_argument("--host", default="127.0.0.1", help="Listen host")
    parser.add_argument("--port", type=int, default=8000, help="Listen port")
    args = parser.parse_args()

    import uvicorn

    uvicorn.run(
        "insightgraph_api.main:app",
        host=args.host,
        port=args.port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
