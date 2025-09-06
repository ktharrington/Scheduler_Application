import os
from psycopg_pool import ConnectionPool

DATABASE_URL = os.getenv("DATABASE_URL")

# Allow tuning from env; sensible defaults
POOL_MIN = int(os.getenv("DB_POOL_MIN", "1"))
POOL_MAX = int(os.getenv("DB_POOL_MAX", "20"))
POOL_TIMEOUT = float(os.getenv("DB_POOL_TIMEOUT", "10"))  # seconds to wait for a free conn

pool = ConnectionPool(
    conninfo=DATABASE_URL,
    min_size=POOL_MIN,
    max_size=POOL_MAX,
    timeout=POOL_TIMEOUT,
    open=True,
)

def query(sql: str, params: tuple = ()):
    """Return all rows; never hold the connection after return."""
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            try:
                return cur.fetchall()
            except Exception:
                return []

def execute(sql: str, params: tuple = ()):
    """Execute and return one row (if any); never hold the connection after return."""
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            conn.commit()
            try:
                return cur.fetchone()
            except Exception:
                return None

def fetchone(sql: str, params: tuple = ()):
    """Convenience wrapper to fetch exactly one row."""
    with pool.connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return cur.fetchone()
