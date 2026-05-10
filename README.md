# LocalRecorder

A local-first AI memory and workflow assistant that records audio, transcribes it locally, summarizes content hierarchically, and stores everything in searchable markdown for privacy and offline operation.

## Project Goals

- **Local Audio Recording**: Capture audio with low-power idle listening.
- **Chunked Transcription**: Process long recordings using Whisper for offline transcription.
- **Local Summarization**: Generate hierarchical summaries (hour → day → 2.5 days → week → 2 weeks → month → quarter) without data loss.
- **Markdown Persistence**: Store transcripts and summaries in human-reviewable markdown files.
- **Searchable Memory**: Enable keyword/topic search across all summary levels.
- **Heat/Trend Analysis**: Detect trends and generate periodic reports.
- **Periodic Summaries**: Automated generation at all time scales.
- **GPU Acceleration**: Optimize for local GPU where available.
- **Human Reviewability**: Transparent, auditable processes with audit logs and review interfaces.
- **Rolling Audio Management**: Delete audio files only after secure transcripts and summaries.

## Architecture Principles

- **Privacy**: All processing local, no cloud dependencies.
- **Offline Operation**: Fully functional without internet.
- **Incremental Scalability**: Grow without redesign.
- **Local GPU Acceleration**: Leverage hardware for performance.
- **Human Reviewability**: Transparent and explainable.

## Setup

1. Ensure Node.js is installed (Windows-compatible).
2. Run `npm install` to install dependencies.
3. See individual modules for usage.

## Development

Follow MDM (Markdown-Driven Development) workflow with incremental sprints. Each sprint ends with commit, validation, and documentation update.