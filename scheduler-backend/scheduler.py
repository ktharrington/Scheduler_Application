# scheduler.py
import os, time, random, datetime
import redis
from rq import Queue
from redis.exceptions import RedisError
from app.db import query
from worker import publish_one  # the job function

def _normalize_redis_url(value: str | None) -> str:
    v = (value or "").strip()
    if not v:
        return "redis://redis:6379/0"
    if "://" not in v:
        v = f"redis://{v}"
    return v

REDIS_URL = os.getenv("REDIS_URL", "redis://redis:6379/0")
q = Queue("publish", connection=redis.from_url(REDIS_URL)) 

# Tunables (env overrides)
LOOKAHEAD_SEC = int(os.getenv("LOOKAHEAD_SEC", "30"))
TICK_SEC      = int(os.getenv("SCHEDULER_TICK_SEC", "10"))      # main loop cadence
REAP_PUB_SEC  = int(os.getenv("REAP_PUBLISHING_AFTER_SEC", "120"))  # stuck publishing
REAP_Q_SEC    = int(os.getenv("REAP_QUEUED_AFTER_SEC", "300"))      # stuck queued
DRIFT_WARN_S  = int(os.getenv("DRIFT_WARN_SEC", "2"))               # db vs system clock

def enqueue_due() -> int:
    rows = query(
        """
        WITH due AS (
          SELECT p.id, 'publish-' || p.id AS job_id
            FROM posts p
            JOIN accounts a ON a.id = p.account_id
           WHERE p.status = 'scheduled'
             AND p.scheduled_at <= now() + make_interval(secs => %s)
             AND now() >= COALESCE(p.next_attempt_at, now())
             AND a.active = true
           ORDER BY p.scheduled_at ASC, p.id ASC
           LIMIT 50
        )
        UPDATE posts AS p
           SET status='queued',
               locked_at=now(),
               job_id=due.job_id
          FROM due
         WHERE p.id = due.id
        RETURNING p.id, p.job_id;
        """,
        (int(os.getenv("LOOKAHEAD_SEC", "30")),),
    )

    enq = 0
    for pid, job_id in rows:
        try:
            # use string path so worker can import in its own container
            q.enqueue("worker.publish_one", pid, job_id=job_id, result_ttl=3600, failure_ttl=86400)
            enq += 1
        except Exception as e:
            msg = str(e)
            if "already exists" in msg or "Job with id" in msg:
                continue
            print(f"[enqueue_due] failed to enqueue pid={pid}: {e}")
    return enq

def reap_stuck() -> int:
    """Unlock items stuck too long in queued/publishing so they can be retried."""
    out = query(
        """
        WITH u AS (
          UPDATE posts
             SET status='scheduled',
                 locked_at=NULL,
                 locked_by=NULL,
                 retry_count=retry_count+1,
                 error_code='stuck_recovered'
           WHERE (status='publishing' AND locked_at < now() - make_interval(secs => %s))
              OR (status='queued'     AND locked_at < now() - make_interval(secs => %s))
           RETURNING id
        )
        SELECT count(*) FROM u
        """,
        (REAP_PUB_SEC, REAP_Q_SEC),
    )
    return int(out[0][0]) if out else 0

def warn_time_drift(threshold_sec: int = DRIFT_WARN_S):
    row = query("SELECT now()")[0][0]  # timestamptz
    sys_now = datetime.datetime.now(datetime.timezone.utc)
    drift = abs((row - sys_now).total_seconds())
    if drift > threshold_sec:
        print(f"WARNING: DB/Container clock drift {drift:.2f}s")

if __name__ == "__main__":
    tick = 0
    while True:
        try:
            n = enqueue_due()
            if n:
                print(f"Enqueued {n} posts")
            if tick % max(1, int(60 / max(1, TICK_SEC))) == 0:
                reaped = reap_stuck()
                if reaped:
                    print(f"Reaped {reaped} stuck posts")
                warn_time_drift()
        except Exception as e:
            print("Scheduler error:", e)
        time.sleep(TICK_SEC + random.uniform(0, 0.5))
        tick += 1
