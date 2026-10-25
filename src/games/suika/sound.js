export class OrchardSound {
  constructor(muted = false) {
    this.muted = muted;
    this.context = null;
    this.lastCollision = 0;
  }

  unlock() {
    if (this.muted) return;
    try {
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!this.context && Audio) this.context = new Audio();
      if (this.context?.state === 'suspended') this.context.resume().catch(() => {});
    } catch { /* 无音频设备时玩法仍可使用。 */ }
  }

  tone(frequency, duration, volume = 0.05, delay = 0, type = 'sine') {
    const context = this.context;
    if (this.muted || !context || context.state !== 'running') return;
    const time = context.currentTime + delay;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, time);
    oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.8, time + duration);
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(volume, time + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start(time);
    oscillator.stop(time + duration + 0.02);
  }

  play(event) {
    if (event.type === 'collision') {
      const now = performance.now();
      if (now - this.lastCollision < 120) return;
      this.lastCollision = now;
      this.tone(180, 0.055, 0.013);
    } else if (event.type === 'drop') {
      this.tone(430, 0.1, 0.035);
    } else if (event.type === 'merge') {
      const note = [262, 294, 330, 349, 392, 440, 494, 523, 587, 659, 784][event.tier] || 440;
      this.tone(note, 0.19, 0.05);
      this.tone(note * 1.5, 0.2, 0.03, 0.065);
      if (event.tier === 10) {
        [1, 1.25, 1.5, 2].forEach((factor, i) => this.tone(523 * factor, 0.24, 0.045, i * 0.12));
      }
    } else if (event.type === 'remove') {
      this.tone(880, 0.13, 0.03);
    } else if (event.type === 'shake') {
      [0, 0.08, 0.16].forEach(delay => this.tone(150, 0.09, 0.025, delay, 'triangle'));
    } else if (event.type === 'over') {
      [330, 294, 220].forEach((note, i) => this.tone(note, 0.25, 0.04, i * 0.15));
    }
  }
}
