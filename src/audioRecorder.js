require('./recorderPatch'); // must come before node-record-lpcm16 is loaded
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
    this.listening = false;
  }

  start(outputPath) {
    if (this.recording || this.idle || this.listening) {
      throw new Error('Recording already in progress');
    }

    this.fileStream = fs.createWriteStream(outputPath);
    this.recording = recorder.record(this.options);
    this.recording.stream().pipe(this.fileStream);

    console.log('Recording started to', outputPath);
  }

  listen(handler) {
    if (this.recording || this.idle || this.listening) {
      throw new Error('Recording already in progress');
    }
    if (typeof handler !== 'function') {
      throw new TypeError('listen(handler): handler must be a function');
    }
    this.listening = true;
    this.recording = recorder.record({ ...this.options, audioType: 'raw' });
    const stream = this.recording.stream();
    stream.on('data', handler);
    stream.on('error', (err) => {
      // After stop() runs, this.recording is null -- treat that as an
      // intentional shutdown and stay quiet; sox's exit on kill is not news.
      if (!this.recording) return;
      console.error('Listen stream error:', err);
      this.listening = false;
      this.recording = null;
    });
    console.log('Listening (no file written)');
  }

  idleListen(outputPath) {
    if (this.recording || this.idle || this.listening) {
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
    if (!this.recording && !this.idle && !this.listening) {
      throw new Error('No recording in progress');
    }
    this.idle = false;
    this.listening = false;
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