"""Database models for Prompt Tracker."""

import json
import re
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

DB_PATH = Path(__file__).parent / "prompt_tracker.db"

# Cluster detection patterns
CLUSTER_PATTERNS = [
    {"id": "reddit", "name": "Reddit Marketing", "icon": "🔴", "patterns": ["reddit"]},
    {"id": "devmarketing", "name": "Developer Marketing", "icon": "📝", "patterns": ["developer marketing", "dev marketing", "developer-focused"]},
    {"id": "content", "name": "Tech Content", "icon": "✍️", "patterns": ["content marketing", "tech content"]},
    {"id": "docs", "name": "Product Documentation", "icon": "📄", "patterns": ["documentation", "technical docs", "product docs"]},
    {"id": "seo", "name": "SEO / AEO", "icon": "🔍", "patterns": ["seo", "aeo", "search engine", "search optimization"]},
    {"id": "video", "name": "Video Production", "icon": "🎬", "patterns": ["video", "youtube", "video production"]},
    {"id": "webflow", "name": "Webflow", "icon": "🌐", "patterns": ["webflow"]},
    {"id": "b2b-saas", "name": "B2B SaaS", "icon": "💼", "patterns": ["b2b saas", "saas marketing"]},
    {"id": "ai-startups", "name": "AI Startups", "icon": "🤖", "patterns": ["ai startup", "ai agent", "ai-native"]},
]


@dataclass
class Cluster:
    id: str
    name: str
    icon: str
    prompt_count: int = 0
    citation_rate: float = 0.0
    avg_rank: float = 0.0
    score: float = 0.0
    trend: str = "stable"  # improving, stable, declining
    prompts: List[str] = field(default_factory=list)


@dataclass
class PromptStats:
    prompt: str
    cluster_id: str
    total_runs: int = 0
    total_cited: int = 0
    citation_rate: float = 0.0
    avg_rank: float = 0.0
    rank_1_count: int = 0
    rank_1_rate: float = 0.0
    score: float = 0.0
    trend: str = "stable"
    last_run: Optional[str] = None
    per_model_stats: Dict[str, Dict] = field(default_factory=dict)
    keywords: List[str] = field(default_factory=list)


def detect_cluster(prompt: str) -> str:
    """Auto-detect cluster based on prompt content."""
    prompt_lower = prompt.lower()
    for cluster in CLUSTER_PATTERNS:
        if any(p in prompt_lower for p in cluster["patterns"]):
            return cluster["id"]
    return "uncategorized"


def extract_keywords(prompt: str) -> List[str]:
    """Extract relevant keywords from prompt for tagging."""
    keywords = []
    prompt_lower = prompt.lower()
    
    keyword_patterns = [
        "ai", "b2b", "saas", "startup", "devtools", "developer", 
        "marketing", "content", "seo", "aeo", "reddit", "video",
        "documentation", "tech", "growth", "enterprise", "opensource"
    ]
    
    for kw in keyword_patterns:
        if kw in prompt_lower:
            keywords.append(kw)
    
    return keywords[:5]  # Limit to 5 keywords


def init_db():
    """Initialize the SQLite database."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Prompts table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS prompts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            prompt TEXT UNIQUE NOT NULL,
            cluster_id TEXT NOT NULL,
            keywords TEXT DEFAULT '[]',
            active INTEGER DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    """)
    
    # Targets table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS targets (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            domain TEXT UNIQUE NOT NULL,
            company TEXT,
            active INTEGER DEFAULT 1,
            created_at TEXT NOT NULL
        )
    """)
    
    # Runs table
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS runs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            model TEXT NOT NULL,
            provider TEXT NOT NULL,
            prompt_id INTEGER NOT NULL,
            prompt TEXT NOT NULL,
            cited INTEGER DEFAULT 0,
            rank INTEGER,
            cited_urls TEXT DEFAULT '[]',
            raw_response TEXT,
            parsed_response TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (prompt_id) REFERENCES prompts(id)
        )
    """)
    
    # Jobs table for background processing
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS jobs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            status TEXT DEFAULT 'pending',
            prompts TEXT NOT NULL,
            targets TEXT NOT NULL,
            models TEXT NOT NULL,
            progress INTEGER DEFAULT 0,
            total INTEGER DEFAULT 0,
            result TEXT,
            error TEXT,
            created_at TEXT NOT NULL,
            started_at TEXT,
            completed_at TEXT
        )
    """)
    
    # Create indexes
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_runs_prompt_id ON runs(prompt_id)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_runs_timestamp ON runs(timestamp)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_runs_model ON runs(model)")
    cursor.execute("CREATE INDEX IF NOT EXISTS idx_prompts_cluster ON prompts(cluster_id)")
    
    conn.commit()
    conn.close()


def add_prompt(prompt: str, cluster_id: Optional[str] = None) -> int:
    """Add a prompt to the database."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    now = datetime.now(timezone.utc).isoformat()
    cluster = cluster_id or detect_cluster(prompt)
    keywords = json.dumps(extract_keywords(prompt))
    
    cursor.execute("""
        INSERT OR IGNORE INTO prompts (prompt, cluster_id, keywords, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
    """, (prompt, cluster, keywords, now, now))
    
    conn.commit()
    prompt_id = cursor.lastrowid
    conn.close()
    
    return prompt_id


def add_prompts_bulk(prompts: List[str]) -> int:
    """Add multiple prompts to the database."""
    count = 0
    for prompt in prompts:
        if prompt.strip():
            add_prompt(prompt.strip())
            count += 1
    return count


def get_prompts(cluster_id: Optional[str] = None, active_only: bool = True) -> List[Dict]:
    """Get all prompts, optionally filtered by cluster."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    query = "SELECT * FROM prompts"
    params = []
    
    conditions = []
    if active_only:
        conditions.append("active = 1")
    if cluster_id:
        conditions.append("cluster_id = ?")
        params.append(cluster_id)
    
    if conditions:
        query += " WHERE " + " AND ".join(conditions)
    
    query += " ORDER BY created_at DESC"
    
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    
    return [dict(row) for row in rows]


def add_target(domain: str, company: Optional[str] = None) -> int:
    """Add a target domain."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    now = datetime.now(timezone.utc).isoformat()
    
    cursor.execute("""
        INSERT OR IGNORE INTO targets (domain, company, created_at)
        VALUES (?, ?, ?)
    """, (domain.lower().strip(), company, now))
    
    conn.commit()
    target_id = cursor.lastrowid
    conn.close()
    
    return target_id


def get_targets(active_only: bool = True) -> List[Dict]:
    """Get all targets."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    query = "SELECT * FROM targets"
    if active_only:
        query += " WHERE active = 1"
    
    cursor.execute(query)
    rows = cursor.fetchall()
    conn.close()
    
    return [dict(row) for row in rows]


def record_run(
    timestamp: str,
    model: str,
    provider: str,
    prompt: str,
    cited: bool,
    rank: Optional[int],
    cited_urls: List[str],
    raw_response: str,
    parsed_response: Dict,
) -> int:
    """Record a single evaluation run."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    now = datetime.now(timezone.utc).isoformat()
    
    # Get or create prompt
    cursor.execute("SELECT id FROM prompts WHERE prompt = ?", (prompt,))
    row = cursor.fetchone()
    if row:
        prompt_id = row[0]
    else:
        prompt_id = add_prompt(prompt)
    
    cursor.execute("""
        INSERT INTO runs (
            timestamp, model, provider, prompt_id, prompt, cited, rank,
            cited_urls, raw_response, parsed_response, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, (
        timestamp, model, provider, prompt_id, prompt,
        1 if cited else 0, rank,
        json.dumps(cited_urls), raw_response, json.dumps(parsed_response),
        now
    ))
    
    conn.commit()
    run_id = cursor.lastrowid
    conn.close()
    
    return run_id


def create_job(prompts: List[str], targets: List[str], models: List[str]) -> int:
    """Create a new background job."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    now = datetime.now(timezone.utc).isoformat()
    total = len(prompts) * len(models)
    
    cursor.execute("""
        INSERT INTO jobs (prompts, targets, models, total, created_at)
        VALUES (?, ?, ?, ?, ?)
    """, (
        json.dumps(prompts),
        json.dumps(targets),
        json.dumps(models),
        total,
        now
    ))
    
    conn.commit()
    job_id = cursor.lastrowid
    conn.close()
    
    return job_id


def update_job(job_id: int, **kwargs):
    """Update job status."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    updates = []
    params = []
    for key, value in kwargs.items():
        if key in ("status", "progress", "result", "error", "started_at", "completed_at"):
            updates.append(f"{key} = ?")
            params.append(value if not isinstance(value, dict) else json.dumps(value))
    
    if updates:
        params.append(job_id)
        cursor.execute(f"UPDATE jobs SET {', '.join(updates)} WHERE id = ?", params)
        conn.commit()
    
    conn.close()


def get_job(job_id: int) -> Optional[Dict]:
    """Get job by ID."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute("SELECT * FROM jobs WHERE id = ?", (job_id,))
    row = cursor.fetchone()
    conn.close()
    
    if row:
        result = dict(row)
        result["prompts"] = json.loads(result["prompts"])
        result["targets"] = json.loads(result["targets"])
        result["models"] = json.loads(result["models"])
        return result
    return None


def get_prompt_stats() -> List[PromptStats]:
    """Calculate stats for all prompts."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    # Get all prompts with their run data
    cursor.execute("""
        SELECT 
            p.id,
            p.prompt,
            p.cluster_id,
            p.keywords,
            COUNT(r.id) as total_runs,
            SUM(r.cited) as total_cited,
            AVG(CASE WHEN r.cited = 1 THEN r.rank END) as avg_rank,
            SUM(CASE WHEN r.rank = 1 THEN 1 ELSE 0 END) as rank_1_count,
            MAX(r.timestamp) as last_run
        FROM prompts p
        LEFT JOIN runs r ON p.id = r.prompt_id
        WHERE p.active = 1
        GROUP BY p.id
        ORDER BY total_cited DESC
    """)
    
    rows = cursor.fetchall()
    
    stats_list = []
    for row in rows:
        total_runs = row["total_runs"] or 0
        total_cited = row["total_cited"] or 0
        
        citation_rate = total_cited / total_runs if total_runs > 0 else 0
        avg_rank = row["avg_rank"] or 0
        rank_1_count = row["rank_1_count"] or 0
        rank_1_rate = rank_1_count / total_runs if total_runs > 0 else 0
        
        # Calculate composite score
        rank_score = 1 / (avg_rank + 1) if avg_rank > 0 else 0
        score = round(citation_rate * 0.5 + rank_score * 0.3 + rank_1_rate * 0.2, 2)
        
        # Determine trend (would need historical data for real trend)
        trend = "stable"
        
        stats = PromptStats(
            prompt=row["prompt"],
            cluster_id=row["cluster_id"],
            total_runs=total_runs,
            total_cited=total_cited,
            citation_rate=round(citation_rate * 100, 1),
            avg_rank=round(avg_rank, 1) if avg_rank else 0,
            rank_1_count=rank_1_count,
            rank_1_rate=round(rank_1_rate * 100, 1),
            score=score,
            trend=trend,
            last_run=row["last_run"],
            keywords=json.loads(row["keywords"]) if row["keywords"] else []
        )
        stats_list.append(stats)
    
    conn.close()
    
    # Sort by score
    stats_list.sort(key=lambda x: x.score, reverse=True)
    
    return stats_list


def get_cluster_stats() -> List[Cluster]:
    """Get aggregated stats per cluster."""
    prompt_stats = get_prompt_stats()
    
    cluster_map: Dict[str, Cluster] = {}
    
    # Initialize clusters from patterns
    for pattern in CLUSTER_PATTERNS:
        cluster_map[pattern["id"]] = Cluster(
            id=pattern["id"],
            name=pattern["name"],
            icon=pattern["icon"],
            prompts=[]
        )
    
    # Add uncategorized cluster
    cluster_map["uncategorized"] = Cluster(
        id="uncategorized",
        name="Uncategorized",
        icon="📋",
        prompts=[]
    )
    
    # Aggregate stats
    for stat in prompt_stats:
        cluster_id = stat.cluster_id
        if cluster_id not in cluster_map:
            cluster_id = "uncategorized"
        
        cluster = cluster_map[cluster_id]
        cluster.prompts.append(stat.prompt)
        cluster.prompt_count += 1
    
    # Calculate cluster-level metrics
    for cluster_id, cluster in cluster_map.items():
        cluster_prompts = [s for s in prompt_stats if s.cluster_id == cluster_id]
        
        if cluster_prompts:
            total_runs = sum(s.total_runs for s in cluster_prompts)
            total_cited = sum(s.total_cited for s in cluster_prompts)
            
            cluster.citation_rate = round(total_cited / total_runs * 100, 1) if total_runs > 0 else 0
            
            cited_prompts = [s for s in cluster_prompts if s.avg_rank > 0]
            cluster.avg_rank = round(
                sum(s.avg_rank for s in cited_prompts) / len(cited_prompts), 1
            ) if cited_prompts else 0
            
            cluster.score = round(
                sum(s.score for s in cluster_prompts) / len(cluster_prompts), 2
            )
    
    # Return sorted by score, excluding empty clusters
    clusters = [c for c in cluster_map.values() if c.prompt_count > 0]
    clusters.sort(key=lambda x: x.score, reverse=True)
    
    return clusters


def get_model_stats() -> List[Dict]:
    """Get stats per model."""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    
    cursor.execute("""
        SELECT 
            model,
            provider,
            COUNT(*) as total_runs,
            SUM(cited) as total_cited,
            AVG(CASE WHEN cited = 1 THEN rank END) as avg_rank
        FROM runs
        GROUP BY model
        ORDER BY total_cited DESC
    """)
    
    rows = cursor.fetchall()
    conn.close()
    
    stats = []
    for row in rows:
        total_runs = row["total_runs"] or 0
        total_cited = row["total_cited"] or 0
        citation_rate = total_cited / total_runs * 100 if total_runs > 0 else 0
        
        stats.append({
            "model": row["model"],
            "provider": row["provider"],
            "total_runs": total_runs,
            "total_cited": total_cited,
            "citation_rate": round(citation_rate, 1),
            "avg_rank": round(row["avg_rank"], 1) if row["avg_rank"] else 0
        })
    
    return stats


def get_dashboard_summary() -> Dict:
    """Get summary stats for dashboard header."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Total prompts
    cursor.execute("SELECT COUNT(*) FROM prompts WHERE active = 1")
    total_prompts = cursor.fetchone()[0]
    
    # Total runs and citations
    cursor.execute("SELECT COUNT(*), SUM(cited) FROM runs")
    row = cursor.fetchone()
    total_runs = row[0] or 0
    total_cited = row[1] or 0
    avg_citation_rate = total_cited / total_runs * 100 if total_runs > 0 else 0
    
    # Top model
    cursor.execute("""
        SELECT model, SUM(cited) * 1.0 / COUNT(*) as rate
        FROM runs
        GROUP BY model
        ORDER BY rate DESC
        LIMIT 1
    """)
    row = cursor.fetchone()
    top_model = row[0] if row else None
    top_model_rate = round(row[1] * 100, 1) if row else 0
    
    # Trends (simplified - count improving vs declining)
    cluster_stats = get_cluster_stats()
    improving = sum(1 for c in cluster_stats if c.trend == "improving")
    declining = sum(1 for c in cluster_stats if c.trend == "declining")
    
    conn.close()
    
    return {
        "total_prompts": total_prompts,
        "total_runs": total_runs,
        "avg_citation_rate": round(avg_citation_rate, 1),
        "top_model": top_model,
        "top_model_rate": top_model_rate,
        "trends": {
            "improving": improving,
            "declining": declining
        }
    }


def import_from_logs(logs_dir: Path) -> int:
    """Import existing runs from log files."""
    count = 0
    
    for log_file in logs_dir.glob("run_*.json"):
        with open(log_file) as f:
            data = json.load(f)
        
        timestamp = data.get("timestamp", "")
        model = data.get("model", "")
        provider = data.get("provider", "")
        
        for result in data.get("results", []):
            prompt = result.get("prompt", "")
            matches = result.get("matches", [])
            cited = len(matches) > 0
            
            rank = None
            cited_urls = []
            if matches:
                ranks = matches[0].get("ranks", [])
                rank = ranks[0] if ranks else None
                cited_urls = matches[0].get("cited_urls", []) or matches[0].get("matched_urls", [])
            
            record_run(
                timestamp=timestamp,
                model=model,
                provider=provider,
                prompt=prompt,
                cited=cited,
                rank=rank,
                cited_urls=cited_urls,
                raw_response=result.get("raw", ""),
                parsed_response=result.get("parsed", {})
            )
            count += 1
    
    return count


# Initialize DB on import
init_db()
