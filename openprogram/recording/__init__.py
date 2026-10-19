"""Recording a demonstration on the user's computer for the chat agent.

``session`` owns a recording's files and life cycle, ``describe`` turns a
finished recording into message text and images, and ``macos`` is the
capture backend.
"""
from .describe import TAG, compose, summary
from .session import MAX_SECONDS, PURPOSES, Recording, RecordingError, active, directory_of, get, start

__all__ = ["MAX_SECONDS", "PURPOSES", "Recording", "RecordingError", "TAG", "active", "compose",
           "directory_of", "get", "start", "summary"]
