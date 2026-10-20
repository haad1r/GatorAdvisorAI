"""
Every tunable setting for the scraper in one place: where UF's data lives,
what we collect, how politely we fetch it, how long we cache it, and where
files go. Nothing in here does any work; other modules import these values.
"""

from __future__ import annotations

from datetime import timedelta
from pathlib import Path

# ============================================================================
# UF endpoints
# ============================================================================

CATALOG_BASE_URL = "https://catalog.ufl.edu"
COURSES_INDEX_URL = f"{CATALOG_BASE_URL}/UGRD/courses/"
PROGRAMS_INDEX_URL = f"{CATALOG_BASE_URL}/UGRD/programs/"
EXAM_CREDIT_URL = f"{CATALOG_BASE_URL}/UGRD/academic-advising/exam-credit/"
SOC_BASE_URL = "https://one.uf.edu/apix/soc"

# ============================================================================
# What we collect
# ============================================================================

# catalog.ufl.edu only ever shows the CURRENT catalog year. Every catalog row
# is stamped with this, so bump it when UF rolls the catalog over (summer).
CATALOG_YEAR = "2026-2027"

# Oldest Schedule of Courses term to collect (Fall 2021). The newest is
# whatever SOC currently publishes, so new terms are picked up automatically.
SOC_FIRST_TERM = "2218"

# SOC listing categories: CWSP = campus, web and special programs (the main
# list); UFOL = UF Online. "IA" was measured to return the CWSP list itself.
SOC_CATEGORIES = ("CWSP", "UFOL")

# ============================================================================
# Politeness
# ============================================================================

# Sent with every request so UF can see who we are and reach us.
USER_AGENT = "gatoradvisor-scraper/0.1 (student project; offline batch use;)"

MIN_DELAY_SECONDS = 2.0       # random gap between real network requests...
MAX_DELAY_SECONDS = 5.0       # ...somewhere in this range
REQUEST_TIMEOUT_SECONDS = 30
MAX_RETRIES = 4               # after the first attempt, so 5 tries in total
BACKOFF_BASE_SECONDS = 10.0   # retry waits: 10, 20, 40, 80 s

# After a run that touched the network FINISHES, uncached fetches for that
# source are refused for this long (cache hits always work). This is what
# makes "scrape once, then stop" the default; --force overrides it.
SOURCE_COOLDOWNS: dict[str, timedelta] = {
    "catalog": timedelta(days=7),
    "programs": timedelta(days=30),
    "soc": timedelta(days=1),
    "examcredit": timedelta(days=30),
}

# How long a cached page is trusted before it is revalidated with UF.
# soc.py overrides this with ttl=None ("never expires") for terms that have
# ended, since a past term's schedule cannot change.
CACHE_TTLS: dict[str, timedelta | None] = {
    "catalog": timedelta(days=7),
    "programs": timedelta(days=7),
    "soc": timedelta(days=1),
    "examcredit": timedelta(days=30),
}

# ============================================================================
# Paths
# ============================================================================

SCRAPER_ROOT = Path(__file__).resolve().parent.parent  # .../GatorAdvisorAI/scraper
REPO_ROOT = SCRAPER_ROOT.parent
CACHE_DIR = SCRAPER_ROOT / "cache"                      # gitignored
DATA_DIR = REPO_ROOT / "data"                           # committed CSV output
OVERRIDES_PATH = SCRAPER_ROOT / "overrides.json"