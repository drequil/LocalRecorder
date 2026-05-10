const recorder = require('node-record-lpcm16');
const fs = require('fs');

class AudioRecorder {
  constructor(options = {}) {
    this.options = {
      sampleRate: 16000,
      channels: 1,
      ...options
    };
    this.recording = null;
    this.fileStream = null;
  }

  start(outputPath) {
    if (this.recording) {
      throw new Error('Recording already in progress');
    }

    this.fileStream = fs.createWriteStream(outputPath);
    this.recording = recorder.record(this.options);
    this.recording.stream().pipe(this.fileStream);

    console.log('Recording started to', outputPath);
  }

  stop() {
    if (!this.recording) {
      throw new Error('No recording in progress');
    }

    this.recording.stop();
    this.recording = null;
    if (this.fileStream) {
      this.fileStream.end();
      this.fileStream = null;
    }

    console.log('Recording stopped');
  }
}

module.exports = AudioRecorder;