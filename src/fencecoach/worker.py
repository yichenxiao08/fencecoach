"""Run independently from HTTP: python -m fencecoach.worker."""

import signal
import threading

from fencecoach.coaching_jobs import CoachingJobs, CoachingWorker
from fencecoach.repository import Repository
from fencecoach.settings import settings
from fencecoach.video_jobs import VideoJobs, VideoWorker


def main():
    repository = Repository(settings.fencecoach_db_path)
    repository.list_sessions()
    coaching = CoachingWorker(CoachingJobs(repository))
    coaching.start()
    jobs = VideoJobs(settings.fencecoach_db_path, settings.fencecoach_video_dir)
    worker = VideoWorker(jobs, settings.fencecoach_pose_model)
    stopped = threading.Event()
    signal.signal(signal.SIGINT, lambda *_: stopped.set())
    signal.signal(signal.SIGTERM, lambda *_: stopped.set())
    worker.start()
    try:
        while not stopped.wait(1):
            pass
    finally:
        worker.close()
        coaching.close()


if __name__ == "__main__":
    main()
