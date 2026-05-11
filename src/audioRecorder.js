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
    this.idle = false;
  }

  start(outputPath) {
    if (this.recording || this.idle) {
      throw new Error('Recording already in progress');
    }

    this.fileStream = fs.createWriteStream(outputPath);
    this.recording = recorder.record(this.options);
    this.recording.stream().pipe(this.fileStream);

    console.log('Recording started to', outputPath);
  }

  idleListen(outputPath) {
    if (this.recording || this.idle) {
      throw new Error('Recording already in progress');
    }
    this.idle = true;

    const recordChunk = () => {
      if (!this.idle) return;
      this.fileStream = fs.createWriteStream(outputPath, { flags: 'a' });
      this.recording = recorder.record({
        ...this.options,
        threshold: 0.5,
        silence: '1.0'
      });
      this.recording.stream().pipe(this.fileStream);

      this.recording.on('end', () => {
        console.log('Silence detected, rotating chunk');
        this.recording = null;
        if (this.fileStream) {
          this.fileStream.end();
          this.fileStream = null;
        }
        if (this.idle) {
          setTimeout(recordChunk, 100);
        }
      });

      console.log('Idle listening chunk started');
    };

    recordChunk();
  }

  stop() {
    if (!this.recording && !this.idle) {
      throw new Error('No recording in progress');
    }
    this.idle = false;
    if (this.recording) {
      if (typeof this.recording.stop === 'function') {
        this.recording.stop();
      }
      this.recording = null;
    }
    if (this.fileStream) {
      this.fileStream.end();
      this.fileStream = null;
    }
    console.log('Recording stopped');
  }
}

module.exports = AudioRecorder;