#!/usr/bin/env python3
"""CLI for Prompt Tracker - import logs, view stats, manage prompts."""

import argparse
import json
import sys
from pathlib import Path

from models import (
    add_prompts_bulk,
    add_target,
    get_cluster_stats,
    get_dashboard_summary,
    get_prompt_stats,
    import_from_logs,
    init_db,
)


def cmd_import(args):
    """Import runs from log files."""
    logs_dir = Path(args.logs_dir)
    if not logs_dir.exists():
        print(f"Error: Directory not found: {logs_dir}")
        sys.exit(1)
    
    count = import_from_logs(logs_dir)
    print(f"✓ Imported {count} runs from {logs_dir}")


def cmd_add_prompts(args):
    """Add prompts from a file."""
    prompts_file = Path(args.file)
    if not prompts_file.exists():
        print(f"Error: File not found: {prompts_file}")
        sys.exit(1)
    
    with open(prompts_file) as f:
        prompts = [line.strip() for line in f if line.strip()]
    
    count = add_prompts_bulk(prompts)
    print(f"✓ Added {count} prompts from {prompts_file}")


def cmd_add_target(args):
    """Add a target domain."""
    add_target(args.domain, args.company)
    print(f"✓ Added target: {args.domain}")


def cmd_stats(args):
    """Show dashboard stats."""
    summary = get_dashboard_summary()
    
    print("\n" + "=" * 50)
    print("  PROMPT TRACKER STATS")
    print("=" * 50)
    print(f"  Total Prompts:    {summary['total_prompts']}")
    print(f"  Total Runs:       {summary['total_runs']}")
    print(f"  Avg Citation:     {summary['avg_citation_rate']}%")
    print(f"  Top Model:        {summary['top_model'] or 'N/A'}")
    print(f"  Top Model Rate:   {summary['top_model_rate']}%")
    print("=" * 50 + "\n")


def cmd_clusters(args):
    """Show cluster stats."""
    clusters = get_cluster_stats()
    
    if not clusters:
        print("No clusters found. Import some logs first.")
        return
    
    print("\n" + "=" * 70)
    print("  CLUSTER PERFORMANCE")
    print("=" * 70)
    print(f"  {'Cluster':<25} {'Prompts':>8} {'Rate':>8} {'Rank':>8} {'Score':>8}")
    print("-" * 70)
    
    for c in clusters:
        print(f"  {c.icon} {c.name:<22} {c.prompt_count:>8} {c.citation_rate:>7}% {c.avg_rank:>8.1f} {c.score:>8.2f}")
    
    print("=" * 70 + "\n")


def cmd_prompts(args):
    """Show prompt stats."""
    stats = get_prompt_stats()
    
    if args.cluster:
        stats = [s for s in stats if s.cluster_id == args.cluster]
    
    if not stats:
        print("No prompts found.")
        return
    
    limit = args.limit or 20
    stats = stats[:limit]
    
    print("\n" + "=" * 90)
    print("  TOP PROMPTS")
    print("=" * 90)
    print(f"  {'#':>3} {'Prompt':<50} {'Rate':>8} {'Rank':>6} {'Score':>7}")
    print("-" * 90)
    
    for i, s in enumerate(stats, 1):
        prompt_short = s.prompt[:47] + "..." if len(s.prompt) > 50 else s.prompt
        print(f"  {i:>3} {prompt_short:<50} {s.citation_rate:>7}% {s.avg_rank:>6.1f} {s.score:>7.2f}")
    
    print("=" * 90 + "\n")


def cmd_serve(args):
    """Start the API server."""
    import uvicorn
    print(f"Starting Prompt Tracker API on http://localhost:{args.port}")
    uvicorn.run("api_v2:app", host="0.0.0.0", port=args.port, reload=args.reload)


def main():
    parser = argparse.ArgumentParser(
        description="Prompt Tracker CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    subparsers = parser.add_subparsers(dest="command", help="Commands")
    
    # import
    p_import = subparsers.add_parser("import", help="Import runs from log files")
    p_import.add_argument("logs_dir", nargs="?", default="logs", help="Path to logs directory")
    p_import.set_defaults(func=cmd_import)
    
    # add-prompts
    p_add = subparsers.add_parser("add-prompts", help="Add prompts from a file")
    p_add.add_argument("file", help="Path to prompts file (one per line)")
    p_add.set_defaults(func=cmd_add_prompts)
    
    # add-target
    p_target = subparsers.add_parser("add-target", help="Add a target domain")
    p_target.add_argument("domain", help="Domain to track")
    p_target.add_argument("--company", help="Company name")
    p_target.set_defaults(func=cmd_add_target)
    
    # stats
    p_stats = subparsers.add_parser("stats", help="Show dashboard stats")
    p_stats.set_defaults(func=cmd_stats)
    
    # clusters
    p_clusters = subparsers.add_parser("clusters", help="Show cluster stats")
    p_clusters.set_defaults(func=cmd_clusters)
    
    # prompts
    p_prompts = subparsers.add_parser("prompts", help="Show prompt stats")
    p_prompts.add_argument("--cluster", help="Filter by cluster ID")
    p_prompts.add_argument("--limit", type=int, help="Limit results")
    p_prompts.set_defaults(func=cmd_prompts)
    
    # serve
    p_serve = subparsers.add_parser("serve", help="Start the API server")
    p_serve.add_argument("--port", type=int, default=8000, help="Port to listen on")
    p_serve.add_argument("--reload", action="store_true", help="Enable auto-reload")
    p_serve.set_defaults(func=cmd_serve)
    
    args = parser.parse_args()
    
    if not args.command:
        parser.print_help()
        sys.exit(0)
    
    # Initialize DB
    init_db()
    
    # Run command
    args.func(args)


if __name__ == "__main__":
    main()
