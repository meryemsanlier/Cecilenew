/* ============================================
   CECILE'S ADVENTURES - Engine Module
   Core systems: Constants, Audio, Input,
   Particles, Camera, Utilities
   ============================================ */
(function () {
    'use strict';

    // ---- Global Namespace ----
    window.BG = window.BG || {};

    // ---- Constants ----
    const T = 32;                    // Tile size in pixels
    const CW = 960;                  // Canvas width
    const CH = 480;                  // Canvas height
    const GRAVITY = 0.52;
    const MAX_FALL = 12;

    Object.assign(BG, { T, CW, CH, GRAVITY, MAX_FALL });

    // ============================================
    // AUDIO MANAGER - Procedural Web Audio API
    // ============================================
    class Audio {
        constructor() {
            this.ctx = null;
            this.on = true;
            this.vol = 0.25;
            this.ready = false;
        }

        init() {
            if (this.ready) return;
            try {
                this.ctx = new (window.AudioContext || window.webkitAudioContext)();
                this.ready = true;
            } catch (e) {
                this.on = false;
            }
        }

        /** Play a single tone with envelope */
        tone(freq, dur, type = 'square', v = 0.3) {
            if (!this.on || !this.ctx) return;
            const o = this.ctx.createOscillator();
            const g = this.ctx.createGain();
            o.type = type;
            o.frequency.setValueAtTime(freq, this.ctx.currentTime);
            g.gain.setValueAtTime(v * this.vol, this.ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
            o.connect(g);
            g.connect(this.ctx.destination);
            o.start();
            o.stop(this.ctx.currentTime + dur);
        }

        /** Play noise burst */
        noise(dur, v = 0.2) {
            if (!this.on || !this.ctx) return;
            const n = this.ctx.sampleRate * dur;
            const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
            const d = buf.getChannelData(0);
            for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
            const s = this.ctx.createBufferSource();
            s.buffer = buf;
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(v * this.vol, this.ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
            s.connect(g);
            g.connect(this.ctx.destination);
            s.start();
        }

        // ---- Sound Effects ----
        jump()        { this.tone(350, 0.12, 'sine', 0.3); setTimeout(() => this.tone(520, 0.08, 'sine', 0.2), 40); }
        coin()        { this.tone(988, 0.08, 'square', 0.2); setTimeout(() => this.tone(1319, 0.12, 'square', 0.2), 70); }
        hit()         { this.noise(0.2, 0.3); this.tone(180, 0.3, 'sawtooth', 0.2); }
        stomp()       { this.tone(400, 0.08, 'square', 0.2); setTimeout(() => this.tone(600, 0.08, 'square', 0.2), 50); setTimeout(() => this.tone(800, 0.12, 'square', 0.15), 100); }
        levelWin()    { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.tone(f, 0.3, 'square', 0.25), i * 140)); }
        gameOver()    { [400, 350, 300, 200].forEach((f, i) => setTimeout(() => this.tone(f, 0.4, 'sawtooth', 0.2), i * 180)); }
        checkpoint()  { this.tone(660, 0.12, 'sine', 0.25); setTimeout(() => this.tone(880, 0.18, 'sine', 0.2), 90); }
        powerup()     { [400, 500, 600, 700, 800, 1000].forEach((f, i) => setTimeout(() => this.tone(f, 0.08, 'sine', 0.2), i * 35)); }
        select()      { this.tone(600, 0.08, 'square', 0.15); }
    }

    BG.audio = new Audio();

    // ============================================
    // INPUT MANAGER - Keyboard & Touch
    // ============================================
    class Input {
        constructor() {
            this.keys = {};
            this.prev = {};
            this.jp = {};           // just pressed
            this.touch = { left: false, right: false, jump: false };
            this._initKB();
            this._initTouch();
        }

        _initKB() {
            const h = (down) => (e) => {
                if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Space','KeyA','KeyD','KeyW','KeyP','Escape','Enter'].includes(e.code)) {
                    e.preventDefault();
                    this.keys[e.code] = down;
                }
            };
            window.addEventListener('keydown', h(true));
            window.addEventListener('keyup', h(false));
        }

        _initTouch() {
            const bind = (id, prop) => {
                const el = document.getElementById(id);
                if (!el) return;
                const on = (e) => { e.preventDefault(); this.touch[prop] = true; };
                const off = (e) => { e.preventDefault(); this.touch[prop] = false; };
                el.addEventListener('touchstart', on, { passive: false });
                el.addEventListener('touchend', off, { passive: false });
                el.addEventListener('touchcancel', off, { passive: false });
                el.addEventListener('mousedown', on);
                el.addEventListener('mouseup', off);
                el.addEventListener('mouseleave', off);
            };
            bind('touch-left', 'left');
            bind('touch-right', 'right');
            bind('touch-jump', 'jump');
        }

        update() {
            for (const k in this.keys) this.jp[k] = this.keys[k] && !this.prev[k];
            // Touch jump is "just pressed" for one frame then resets
            this.jp._touchJump = this.touch.jump && !this._prevTouchJump;
            this._prevTouchJump = this.touch.jump;
            this.prev = { ...this.keys };
        }

        get left()      { return this.keys['ArrowLeft'] || this.keys['KeyA'] || this.touch.left; }
        get right()     { return this.keys['ArrowRight'] || this.keys['KeyD'] || this.touch.right; }
        get jumpDown()  { return this.jp['ArrowUp'] || this.jp['KeyW'] || this.jp['Space'] || this.jp._touchJump; }
        get jumpHeld()  { return this.keys['ArrowUp'] || this.keys['KeyW'] || this.keys['Space'] || this.touch.jump; }
        get pause()     { return this.jp['Escape'] || this.jp['KeyP']; }
        get enter()     { return this.jp['Enter'] || this.jp['Space']; }
    }

    BG.input = new Input();

    // ============================================
    // PARTICLE SYSTEM
    // ============================================
    class Particle {
        constructor(x, y, vx, vy, life, color, size) {
            this.x = x; this.y = y;
            this.vx = vx; this.vy = vy;
            this.life = life; this.max = life;
            this.color = color; this.size = size;
        }
        update() {
            this.x += this.vx; this.y += this.vy;
            this.vy += 0.08;
            this.life--;
        }
        get alpha() { return Math.max(0, this.life / this.max); }
        get alive() { return this.life > 0; }
    }

    class Particles {
        constructor() { this.list = []; }

        emit(x, y, count, cfg = {}) {
            const { color = '#FFD700', minSpd = -3, maxSpd = 3, minLife = 15, maxLife = 35, minSz = 2, maxSz = 5 } = cfg;
            for (let i = 0; i < count; i++) {
                this.list.push(new Particle(
                    x, y,
                    minSpd + Math.random() * (maxSpd - minSpd),
                    minSpd + Math.random() * (maxSpd - minSpd) - 1.5,
                    minLife + Math.random() * (maxLife - minLife) | 0,
                    color,
                    minSz + Math.random() * (maxSz - minSz)
                ));
            }
        }

        update() {
            for (let i = this.list.length - 1; i >= 0; i--) {
                this.list[i].update();
                if (!this.list[i].alive) this.list.splice(i, 1);
            }
        }

        render(ctx, cx, cy) {
            for (const p of this.list) {
                ctx.globalAlpha = p.alpha;
                ctx.fillStyle = p.color;
                const s = p.size * p.alpha;
                ctx.fillRect(p.x - cx - s / 2, p.y - cy - s / 2, s, s);
            }
            ctx.globalAlpha = 1;
        }

        clear() { this.list = []; }
    }

    BG.particles = new Particles();

    // ============================================
    // CAMERA - Smooth follow with shake
    // ============================================
    class Camera {
        constructor() { this.x = 0; this.y = 0; this.shake = 0; this.shakeDur = 0; }

        follow(target, lvlW, lvlH) {
            const tx = target.x + target.w / 2 - CW / 2;
            const ty = target.y + target.h / 2 - CH / 2;
            this.x += (tx - this.x) * 0.1;
            this.y += (ty - this.y) * 0.1;
            // Clamp
            this.x = Math.max(0, Math.min(this.x, lvlW * T - CW));
            this.y = Math.max(0, Math.min(this.y, lvlH * T - CH));
            // Shake
            if (this.shakeDur > 0) {
                this.x += (Math.random() - 0.5) * this.shake;
                this.y += (Math.random() - 0.5) * this.shake;
                this.shakeDur--;
            }
        }

        doShake(amount, dur) { this.shake = amount; this.shakeDur = dur; }
        reset() { this.x = 0; this.y = 0; this.shakeDur = 0; }
    }

    BG.camera = new Camera();

    // ============================================
    // UTILITIES
    // ============================================
    // ============================================
    // ASSET PRELOADER - Load images before game
    // ============================================
    class Assets {
        constructor() {
            this.images = {};
            this.loaded = false;
            this.total = 0;
            this.count = 0;
        }

        /** Load a single image and return a promise */
        _loadImage(key, src) {
            return new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => {
                    this.images[key] = img;
                    this.count++;
                    resolve(img);
                };
                img.onerror = () => {
                    console.warn('Failed to load: ' + src + ', using fallback');
                    this.count++;
                    resolve(null); // Don't block on failure
                };
                img.src = src;
            });
        }

        /** Preload all game assets */
        async preload() {
            const assetList = [
                { key: 'cecile', src: 'assets/cecile_optimized.png' },
                { key: 'halic', src: 'assets/halic_logo.png' }
            ];
            this.total = assetList.length;
            this.count = 0;
            await Promise.all(assetList.map(a => this._loadImage(a.key, a.src)));
            this.loaded = true;
        }

        /** Get a loaded image by key */
        get(key) {
            return this.images[key] || null;
        }

        /** Get loading progress 0-1 */
        get progress() {
            return this.total > 0 ? this.count / this.total : 0;
        }
    }

    BG.assets = new Assets();

    BG.util = {
        /** AABB overlap test */
        overlap(a, b) {
            return a.x < b.x + b.w && a.x + a.w > b.x &&
                   a.y < b.y + b.h && a.y + a.h > b.y;
        },

        /** Get tile char at pixel coords from a tile map */
        tileAt(map, px, py) {
            const tx = Math.floor(px / T);
            const ty = Math.floor(py / T);
            if (ty < 0 || ty >= map.length || tx < 0 || tx >= (map[0] || '').length) return '.';
            return map[ty][tx];
        },

        isSolid(ch) { return ch === '#'; },
        isSpike(ch) { return ch === '^'; },
        isPlatform(ch) { return ch === '='; },

        lerp(a, b, t) { return a + (b - a) * t; },
        rand(a, b) { return a + Math.random() * (b - a); },
        randInt(a, b) { return Math.floor(a + Math.random() * (b - a)); },

        /** Draw rounded rect */
        roundRect(ctx, x, y, w, h, r) {
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.lineTo(x + w - r, y);
            ctx.quadraticCurveTo(x + w, y, x + w, y + r);
            ctx.lineTo(x + w, y + h - r);
            ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
            ctx.lineTo(x + r, y + h);
            ctx.quadraticCurveTo(x, y + h, x, y + h - r);
            ctx.lineTo(x, y + r);
            ctx.quadraticCurveTo(x, y, x + r, y);
            ctx.closePath();
        }
    };

})();
