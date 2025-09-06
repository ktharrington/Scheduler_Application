import os, time
import redis
from rq import Queue
from app.db import query
from worker import publish_one

REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")

def enqueue_due():
    rows = query("""
      UPDATE posts
         SET status='queued', locked_at=now(), updated_at=now()
       WHERE id IN (
         SELECT id FROM posts
          WHERE status='scheduled' AND scheduled_at <= now() + interval '5 minutes'
          ORDER BY scheduled_at ASC
          LIMIT 200
       )
      RETURNING id
    """)
    if not rows:
        return 0

    r = redis.from_url(REDIS_URL)
    q = Queue("publish", connection=r)

    for (post_id,) in rows:
        q.enqueue(
            publish_one,
            post_id,
            job_timeout=600,
        )
    return len(rows)

if __name__ == "__main__":
    while True:
        try:
            n = enqueue_due()
            if n:
                print(f"Enqueued {n} posts")
        except Exception as e:
            print("Scheduler error:", e)
        time.sleep(30)
