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

  idleListen(outputPath) {
    if (this.recording) {
      throw new Error('Recording already in progress');
    }

    const recordChunk = () => {
      this.fileStream = fs.createWriteStream(outputPath, { flags: 'a' }); // append
      this.recording = recorder.record({
        ...this.options,
        threshold: 0.5,
        silence: '1.0'
      });
      this.recording.stream().pipe(this.fileStream);

      this.recording.on('end', () => {
        console.log('Silence detected, restarting idle listen');
        this.recording = null;
        this.fileStream.end();
        this.fileStream = null;
        // Restart after short delay
        setTimeout(recordChunk, 100);
      });

      console.log('Idle listening chunk started');
    };

    recordChunk();
  }

  stop() {
    if (!this.recording) {
      throw new Error('No recording in progress');
    }
    if (typeof this.recording.stop === 'function') {
      this.recording.stop();
    }
    this.recording = null;
    if (this.fileStream) {
      this.fileStream.end();
      this.fileStream = null;
    }
    console.log('Recording stopped');
  }
}

module.exports = AudioRecorder;