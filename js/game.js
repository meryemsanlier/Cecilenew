/* ============================================
   CECILE'S ADVENTURES - Main Game Module
   Game state machine, loop, level rendering,
   HUD, and screen management.
   ============================================ */
(function () {
    'use strict';
    const { T, CW, CH, GRAVITY, MAX_FALL, audio, input, particles, camera, util,
            levels, Player, EnemyAI, drawCoin, drawPortal, drawCheckpoint, drawPowerup } = window.BG;

    // ---- Game States ----
    const STATE = { LOADING: -1, MENU: 0, PLAYING: 1, PAUSED: 2, LEVEL_COMPLETE: 3, GAME_OVER: 4, VICTORY: 5, CINEMATIC: 6, CREDITS: 7 };
    const assets = window.BG.assets;

    // ---- Main Game Class ----
    class Game {
        constructor() {
            this.canvas = document.getElementById('game-canvas');
            this.ctx = this.canvas.getContext('2d');
            this.canvas.width = CW;
            this.canvas.height = CH;

            this.state = STATE.LOADING;
            this.player = new Player();
            this.levelIdx = 0;
            this.level = null;
            this.time = 0;
            this.transition = 0;      // screen transition timer
            this.transitionTarget = null;

            // Fixed timestep setup
            this.lastTime = 0;
            this.accumulator = 0;
            this.step = 1000 / 60;    // 60 Hz physics

            // Menu animation
            this.menuBob = 0;
            this.stars = [];
            for (let i = 0; i < 80; i++) {
                this.stars.push({
                    x: Math.random() * CW, y: Math.random() * CH,
                    size: Math.random() * 2 + 0.5,
                    speed: Math.random() * 0.3 + 0.1,
                    alpha: Math.random() * 0.5 + 0.5
                });
            }

            // Click/touch handler for menu
            this.canvas.addEventListener('click', () => this._handleClick());
            this.canvas.addEventListener('touchstart', (e) => { e.preventDefault(); this._handleClick(); }, { passive: false });

            // Preload assets, then start game loop
            this._loop = this._loop.bind(this);
            this._preloadAndStart();
        }

        async _preloadAndStart() {
            // Show loading while preloading assets
            this._renderLoading(0);
            await assets.preload();
            this.state = STATE.MENU;
            requestAnimationFrame(this._loop);
        }

        _renderLoading(progress) {
            const ctx = this.ctx;
            const grad = ctx.createLinearGradient(0, 0, 0, CH);
            grad.addColorStop(0, '#0D1B2A');
            grad.addColorStop(1, '#1B2838');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, CW, CH);

            ctx.textAlign = 'center';
            ctx.fillStyle = '#90A4AE';
            ctx.font = '14px "Press Start 2P", monospace';
            ctx.fillText('Loading...', CW / 2, CH / 2 - 20);

            // Progress bar
            const barW = 200, barH = 8;
            ctx.fillStyle = 'rgba(255,255,255,0.1)';
            util.roundRect(ctx, CW / 2 - barW / 2, CH / 2 + 10, barW, barH, 4);
            ctx.fill();
            ctx.fillStyle = '#FF6B9D';
            util.roundRect(ctx, CW / 2 - barW / 2, CH / 2 + 10, barW * assets.progress, barH, 4);
            ctx.fill();
        }

        _handleClick() {
            audio.init(); // Initialize audio on first user interaction
            if (this.state === STATE.MENU) {
                audio.select();
                this._startGame();
            } else if (this.state === STATE.GAME_OVER) {
                audio.select();
                this._retryLevel();
            } else if (this.state === STATE.VICTORY) {
                audio.select();
                this.state = STATE.MENU;
            } else if (this.state === STATE.LEVEL_COMPLETE && this.transition <= 0) {
                audio.select();
                this._nextLevel();
            } else if (this.state === STATE.CREDITS && this.creditsScrollY < -50) {
                audio.select();
                this.state = STATE.MENU;
            }
        }

        // ---- Game Flow ----
        _retryLevel() {
            this.player.fullReset(); // reset lives and score
            // Ensure we clear checkpoints since we are fully restarting the level
            this.player.checkpointX = null;
            this.player.checkpointY = null;
            this._loadLevel(this.levelIdx);
            this.state = STATE.PLAYING;
        }

        // ---- Game Flow ----
        _startGame() {
            this.player.fullReset();
            this.levelIdx = 0; // Starts from Level 1
            if (this.levelIdx === 5) {
                this._startCinematic();
            } else {
                this._loadLevel(this.levelIdx);
                this.state = STATE.PLAYING;
            }
        }

        _loadLevel(idx) {
            this.levelIdx = idx;
            this.level = JSON.parse(JSON.stringify(levels[idx])); // Deep clone
            // Restore theme reference (not cloneable objects)
            this.level.theme = levels[idx].theme;
            this.player.spawn(this.level.playerStart.x, this.level.playerStart.y);
            camera.reset();
            particles.clear();
            // Reset enemy animation timers
            for (const e of this.level.enemies) {
                e.alive = true;
                e.deathTimer = 0;
                e.animTimer = 0;
            }
        }

        _nextLevel() {
            if (this.levelIdx + 1 >= 5) { // Level 6 and up go straight to cinematic
                this._startCinematic();
            } else {
                this._loadLevel(this.levelIdx + 1);
                this.state = STATE.PLAYING;
            }
        }

        _startCinematic() {
            this.state = STATE.CINEMATIC;
            this.cinematicTime = 0;
            this.cinematicPhase = 0;
            this.cinematicLogoHits = 0;
            audio.levelWin(); // Play victory intro sound
        }

        // ============================================
        // MAIN GAME LOOP
        // ============================================
        _loop(timestamp) {
            if (!this.lastTime) this.lastTime = timestamp;
            let dt = timestamp - this.lastTime;
            this.lastTime = timestamp;
            
            // Limit dt to prevent spiral of death if tab was inactive
            if (dt > 250) dt = 250;
            
            this.accumulator += dt;
            this.time = timestamp; // Pass visual time

            // Update inputs once per visual frame
            input.update();

            // Run fixed logic steps
            while (this.accumulator >= this.step) {
                switch (this.state) {
                    case STATE.MENU:     this._updateMenu(); break;
                    case STATE.PLAYING:  this._updatePlaying(); break;
                    case STATE.PAUSED:   this._updatePaused(); break;
                    case STATE.LEVEL_COMPLETE: this._updateLevelComplete(); break;
                    case STATE.CINEMATIC: this._updateCinematic(); break;
                    case STATE.CREDITS:   this._updateCredits(); break;
                }
                this.accumulator -= this.step;
            }

            // Render once per visual frame
            switch (this.state) {
                case STATE.LOADING:  this._renderLoading(); break;
                case STATE.MENU:     this._renderMenu(); break;
                case STATE.PLAYING:  this._renderPlaying(); break;
                case STATE.PAUSED:   this._renderPlaying(); this._renderPause(); break;
                case STATE.LEVEL_COMPLETE: this._renderPlaying(); this._renderLevelComplete(); break;
                case STATE.GAME_OVER: this._renderGameOver(); break;
                case STATE.VICTORY:  this._renderVictory(); break;
                case STATE.CINEMATIC: this._renderCinematic(); break;
                case STATE.CREDITS:   this._renderCredits(); break;
            }

            requestAnimationFrame(this._loop);
        }

        // ============================================
        // UPDATE FUNCTIONS
        // ============================================
        _updateMenu() {
            this.menuBob += 0.03;
            for (const s of this.stars) {
                s.y += s.speed;
                if (s.y > CH) { s.y = 0; s.x = Math.random() * CW; }
            }
            // Allow Enter/Space to start
            if (input.enter) {
                audio.init();
                audio.select();
                this._startGame();
            }
        }

        _updatePlaying() {
            if (input.pause) {
                this.state = STATE.PAUSED;
                return;
            }

            const lvl = this.level;

            // Update player
            this.player.update(lvl);

            // Check player death
            if (this.player.dead) {
                audio.gameOver();
                this.state = STATE.GAME_OVER;
                this.transition = 120;
                return;
            }

            // Update enemies
            for (const e of lvl.enemies) {
                if (!e.alive) {
                    e.deathTimer = (e.deathTimer || 0) + 1;
                    continue;
                }
                switch (e.type) {
                    case 'slime': EnemyAI.updateSlime(e, lvl.cleanTiles); break;
                    case 'bat':   EnemyAI.updateBat(e); break;
                    case 'crab':  EnemyAI.updateCrab(e, lvl.cleanTiles); break;
                }

                // Player vs enemy collision
                const eb = { x: e.x + 4, y: e.y + 4, w: T - 8, h: T - 8 };
                const pb = { x: this.player.x, y: this.player.y, w: this.player.w, h: this.player.h };
                if (util.overlap(pb, eb)) {
                    // Stomp from above?
                    if (this.player.vy > 0 && this.player.y + this.player.h < e.y + T / 2) {
                        e.alive = false;
                        e.deathTimer = 0;
                        this.player.vy = -8;
                        this.player.score += 100;
                        audio.stomp();
                        particles.emit(e.x + T / 2, e.y + T / 2, 10, {
                            color: e.type === 'slime' ? '#66BB6A' : e.type === 'bat' ? '#7E57C2' : '#D84315',
                            minSpd: -3, maxSpd: 3, minLife: 10, maxLife: 20
                        });
                    } else {
                        this.player.hurt();
                    }
                }
            }

            // Update moving platforms
            for (const mp of lvl.movingPlatforms) {
                const prevX = mp.x;
                const prevY = mp.y;
                if (mp.vertical) {
                    mp.y += mp.speed * mp.dir;
                    if (mp.y > mp.startY + mp.moveY || mp.y < mp.startY) mp.dir *= -1;
                } else {
                    mp.x += mp.speed * mp.dir;
                    if (mp.x > mp.startX + mp.moveX || mp.x < mp.startX) mp.dir *= -1;
                }
                mp._dx = mp.x - prevX;
                mp._dy = mp.y - prevY;
            }

            // Coin collection
            for (const c of lvl.coins) {
                if (!c.alive) continue;
                const cb = { x: c.x, y: c.y, w: c.w, h: c.h };
                const pb = { x: this.player.x, y: this.player.y, w: this.player.w, h: this.player.h };
                if (util.overlap(pb, cb)) {
                    c.alive = false;
                    this.player.coins++;
                    this.player.score += 50;
                    audio.coin();
                    particles.emit(c.x + 8, c.y + 8, 8, {
                        color: '#FFD700', minSpd: -2, maxSpd: 2, minLife: 10, maxLife: 20, maxSz: 3
                    });
                }
            }

            // Checkpoint activation
            for (const cp of lvl.checkpoints) {
                if (cp.activated) continue;
                const cpb = { x: cp.x, y: cp.y, w: cp.w, h: cp.h };
                const pb = { x: this.player.x, y: this.player.y, w: this.player.w, h: this.player.h };
                if (util.overlap(pb, cpb)) {
                    cp.activated = true;
                    this.player.checkpointX = this.player.x;
                    this.player.checkpointY = this.player.y;
                    audio.checkpoint();
                    particles.emit(cp.x + T / 2, cp.y, 15, {
                        color: '#4CAF50', minSpd: -2, maxSpd: 2, minLife: 15, maxLife: 30, maxSz: 4
                    });
                }
            }

            // Power-up collection
            for (const pu of lvl.powerups) {
                if (!pu.alive) continue;
                const pub = { x: pu.x, y: pu.y, w: pu.w, h: pu.h };
                const pb = { x: this.player.x, y: this.player.y, w: this.player.w, h: this.player.h };
                if (util.overlap(pb, pub)) {
                    pu.alive = false;
                    if (pu.type === 'doublejump') {
                        this.player.doubleJump = true;
                        this.player.canDoubleJump = true;
                    } else if (pu.type === 'speed') {
                        this.player.speedBoost = 300; // 5 seconds
                    }
                    audio.powerup();
                    particles.emit(pu.x + 12, pu.y + 12, 20, {
                        color: pu.type === 'doublejump' ? '#29B6F6' : '#FFAB00',
                        minSpd: -3, maxSpd: 3, minLife: 15, maxLife: 30, maxSz: 5
                    });
                }
            }

            // Portal (level end)
            if (lvl.portal) {
                const ppb = { x: lvl.portal.x, y: lvl.portal.y, w: lvl.portal.w, h: lvl.portal.h };
                const pb = { x: this.player.x, y: this.player.y, w: this.player.w, h: this.player.h };
                if (util.overlap(pb, ppb)) {
                    this.state = STATE.LEVEL_COMPLETE;
                    this.transition = 120;
                    this.player.score += 500;
                    audio.levelWin();
                }
            }

            // Camera follow
            const p = this.player;
            camera.follow({ x: p.x, y: p.y, w: p.w, h: p.h }, lvl.cols, lvl.rows);

            // Particles
            particles.update();
        }

        _updatePaused() {
            if (input.pause || input.enter) {
                this.state = STATE.PLAYING;
            }
        }

        _updateLevelComplete() {
            if (this.transition > 0) this.transition--;
            particles.update();
        }

        // ============================================
        // RENDER FUNCTIONS
        // ============================================
        _renderMenu() {
            const ctx = this.ctx;
            // Background
            const grad = ctx.createLinearGradient(0, 0, 0, CH);
            grad.addColorStop(0, '#0D1B2A');
            grad.addColorStop(1, '#1B2838');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, CW, CH);

            // Stars
            for (const s of this.stars) {
                ctx.globalAlpha = s.alpha * (0.5 + Math.sin(this.time * 0.002 + s.x) * 0.5);
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(s.x, s.y, s.size, s.size);
            }
            ctx.globalAlpha = 1;

            // Title
            const titleY = 120 + Math.sin(this.menuBob) * 8;
            ctx.textAlign = 'center';

            // Title shadow
            ctx.fillStyle = '#FF6B9D';
            ctx.font = 'bold 40px "Press Start 2P", monospace';
            ctx.fillText("CECILE'S", CW / 2, titleY);
            ctx.font = 'bold 32px "Press Start 2P", monospace';
            ctx.fillStyle = '#29B6F6';
            ctx.fillText('ADVENTURES', CW / 2, titleY + 50);

            // Subtitle
            ctx.fillStyle = '#90A4AE';
            ctx.font = '14px "Press Start 2P", monospace';
            ctx.fillText('A Side-Scrolling Platformer', CW / 2, titleY + 90);

            // Play button
            const btnY = 320;
            const pulse = Math.sin(this.time * 0.005) * 0.15 + 0.85;
            ctx.globalAlpha = pulse;

            // Button glow
            ctx.shadowColor = '#FF6B9D';
            ctx.shadowBlur = 20;
            ctx.fillStyle = '#FF6B9D';
            util.roundRect(ctx, CW / 2 - 120, btnY, 240, 56, 28);
            ctx.fill();
            ctx.shadowBlur = 0;

            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 20px "Press Start 2P", monospace';
            ctx.fillText('PLAY', CW / 2, btnY + 34);
            ctx.globalAlpha = 1;

            // Controls hint
            ctx.fillStyle = '#546E7A';
            ctx.font = '10px "Press Start 2P", monospace';
            ctx.fillText('ARROWS / WASD to Move    SPACE to Jump    P to Pause', CW / 2, CH - 40);

            // Draw Cecile's avatar on menu
            this._drawMenuCharacter(ctx, CW / 2, titleY + 130);
        }

        _drawMenuCharacter(ctx, x, y) {
            const bob = Math.sin(this.time * 0.004) * 4;
            const img = assets.get('cecile');
            ctx.save();
            ctx.translate(x, y + bob);

            if (img) {
                // Draw clear transparent avatar naturally (x2 size)
                const drawW = 172;
                const drawH = Math.round(172 * (img.height / img.width));

                // Glow ring behind character
                ctx.globalAlpha = 0.3 + Math.sin(this.time * 0.003) * 0.15;
                ctx.fillStyle = '#FF6B9D';
                ctx.beginPath();
                ctx.arc(0, 0, 72, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1;

                // Draw the image centered
                ctx.drawImage(img, -drawW / 2, -drawH / 2, drawW, drawH);
            } else {
                // Fallback circle
                ctx.fillStyle = '#FF6B9D';
                ctx.beginPath();
                ctx.arc(0, 0, 20, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#FFF';
                ctx.font = 'bold 16px Inter';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('C', 0, 0);
            }
            ctx.restore();
        }

        _renderPlaying() {
            const ctx = this.ctx;
            const lvl = this.level;
            const theme = lvl.theme;
            const cx = camera.x;
            const cy = camera.y;

            // ---- Sky Background ----
            const skyGrad = ctx.createLinearGradient(0, 0, 0, CH);
            skyGrad.addColorStop(0, theme.sky1);
            skyGrad.addColorStop(1, theme.sky2);
            ctx.fillStyle = skyGrad;
            ctx.fillRect(0, 0, CW, CH);

            // ---- Parallax Background Elements ----
            this._renderBGElements(ctx, lvl, cx, cy);

            // ---- Tiles ----
            this._renderTiles(ctx, lvl, cx, cy);

            // ---- Moving Platforms ----
            for (const mp of lvl.movingPlatforms) {
                const mx = mp.x - cx;
                const my = mp.y - cy;
                ctx.fillStyle = theme.platformTop;
                util.roundRect(ctx, mx, my, mp.w, mp.h, 3);
                ctx.fill();
                ctx.fillStyle = theme.platform;
                ctx.fillRect(mx + 2, my + mp.h - 4, mp.w - 4, 4);
            }

            // ---- Coins ----
            for (const c of lvl.coins) drawCoin(ctx, c, cx, cy, this.time);

            // ---- Checkpoints ----
            for (const cp of lvl.checkpoints) drawCheckpoint(ctx, cp, cx, cy, this.time);

            // ---- Power-ups ----
            for (const pu of lvl.powerups) drawPowerup(ctx, pu, cx, cy, this.time);

            // ---- Enemies ----
            for (const e of lvl.enemies) {
                if (!e.alive) {
                    // Death animation
                    if (e.deathTimer < 20) {
                        ctx.globalAlpha = 1 - e.deathTimer / 20;
                        const dy = -e.deathTimer * 2;
                        const ex = e.x - cx;
                        const ey = e.y - cy + dy;
                        ctx.fillStyle = '#FFF';
                        ctx.font = 'bold 14px Inter';
                        ctx.textAlign = 'center';
                        ctx.fillText('+100', ex + T / 2, ey);
                        ctx.globalAlpha = 1;
                    }
                    continue;
                }
                switch (e.type) {
                    case 'slime': EnemyAI.drawSlime(ctx, e, cx, cy, this.time); break;
                    case 'bat':   EnemyAI.drawBat(ctx, e, cx, cy, this.time); break;
                    case 'crab':  EnemyAI.drawCrab(ctx, e, cx, cy, this.time); break;
                }
            }

            // ---- Portal ----
            drawPortal(ctx, lvl.portal, cx, cy, this.time);

            // ---- Player ----
            this.player.render(ctx, cx, cy);

            // ---- Particles ----
            particles.render(ctx, cx, cy);

            // ---- HUD ----
            this._renderHUD(ctx);
        }

        _renderBGElements(ctx, lvl, cx, cy) {
            const theme = lvl.theme;
            if (theme.name === 'Midnight Ocean') {
                const px = cx * 0.1;
                // Draw moon
                ctx.fillStyle = '#FFF59D';
                ctx.beginPath();
                ctx.arc(CW / 2 - px * 0.5 + 200, 100, 40, 0, Math.PI * 2);
                ctx.fill();
                // Draw stars
                ctx.fillStyle = '#FFFFFF';
                for (let i = 0; i < 40; i++) {
                    const sx = (i * 87 - px * 0.2) % CW;
                    const realSx = sx < 0 ? sx + CW : sx;
                    const sy = (i * 31) % (CH / 2);
                    const alpha = 0.5 + Math.sin(this.time * 0.005 + i) * 0.5;
                    ctx.globalAlpha = alpha;
                    ctx.fillRect(realSx, sy, 2, 2);
                }
                ctx.globalAlpha = 1;
                return;
            }

            const parallax = 0.3;
            const px = cx * parallax;

            // Decorative mountains/hills
            ctx.fillStyle = theme.bg1;
            ctx.globalAlpha = 0.3;
            for (let i = 0; i < 5; i++) {
                const bx = i * 300 - (px * 0.3) % 300;
                ctx.beginPath();
                ctx.moveTo(bx - 50, CH);
                ctx.quadraticCurveTo(bx + 100, CH - 200 - i * 20, bx + 250, CH);
                ctx.fill();
            }

            // Closer hills
            ctx.fillStyle = theme.bg2;
            ctx.globalAlpha = 0.2;
            for (let i = 0; i < 8; i++) {
                const bx = i * 200 - (px * 0.5) % 200;
                ctx.beginPath();
                ctx.moveTo(bx - 30, CH);
                ctx.quadraticCurveTo(bx + 70, CH - 120 - i * 10, bx + 170, CH);
                ctx.fill();
            }
            ctx.globalAlpha = 1;

            // Clouds (for outdoor levels)
            if (lvl.num <= 3) {
                ctx.fillStyle = 'rgba(255,255,255,0.15)';
                for (let i = 0; i < 6; i++) {
                    const cloudX = (i * 250 + 100) - (px * 0.15) % (250 * 6);
                    const cloudY = 30 + i * 25;
                    ctx.beginPath();
                    ctx.ellipse(cloudX, cloudY, 50 + i * 5, 15 + i * 2, 0, 0, Math.PI * 2);
                    ctx.ellipse(cloudX + 30, cloudY - 5, 35, 12, 0, 0, Math.PI * 2);
                    ctx.ellipse(cloudX - 25, cloudY + 2, 30, 10, 0, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        }

        _renderTiles(ctx, lvl, cx, cy) {
            const tiles = lvl.cleanTiles;
            const theme = lvl.theme;

            // Only render visible tiles
            const startCol = Math.max(0, Math.floor(cx / T));
            const endCol = Math.min(tiles[0].length, Math.ceil((cx + CW) / T) + 1);
            const startRow = Math.max(0, Math.floor(cy / T));
            const endRow = Math.min(tiles.length, Math.ceil((cy + CH) / T) + 1);

            for (let r = startRow; r < endRow; r++) {
                for (let c = startCol; c < endCol; c++) {
                    const tile = tiles[r][c];
                    const tx = c * T - cx;
                    const ty = r * T - cy;

                    if (tile === '#') {
                        // Check if top surface (air or platform above)
                        const above = r > 0 ? tiles[r - 1][c] : '.';
                        const isTop = above !== '#';

                        ctx.fillStyle = theme.ground;
                        ctx.fillRect(tx, ty, T, T);

                        if (isTop) {
                            // Grass/surface top
                            ctx.fillStyle = theme.groundTop;
                            ctx.fillRect(tx, ty, T, 6);
                            // Small texture dots
                            ctx.fillStyle = theme.groundDark;
                            if ((c + r) % 3 === 0) ctx.fillRect(tx + 8, ty + 12, 3, 3);
                            if ((c + r) % 5 === 0) ctx.fillRect(tx + 20, ty + 18, 2, 2);
                        } else {
                            // Underground texture
                            ctx.fillStyle = theme.groundDark;
                            if ((c + r) % 4 === 0) ctx.fillRect(tx + 4, ty + 8, 4, 3);
                            if ((c * 3 + r) % 7 === 0) ctx.fillRect(tx + 16, ty + 20, 3, 2);
                        }

                        // Subtle grid lines
                        ctx.fillStyle = 'rgba(0,0,0,0.08)';
                        ctx.fillRect(tx, ty, 1, T);
                        ctx.fillRect(tx, ty, T, 1);

                    } else if (tile === '=') {
                        // Semi-solid platform
                        ctx.fillStyle = theme.platformTop;
                        util.roundRect(ctx, tx + 1, ty, T - 2, 8, 2);
                        ctx.fill();
                        ctx.fillStyle = theme.platform;
                        ctx.fillRect(tx + 3, ty + 8, T - 6, 4);

                    } else if (tile === '~') {
                        // Water tile
                        ctx.fillStyle = 'rgba(0, 119, 190, 0.4)'; // translucent blue
                        // Undulating surface if it's the top tile
                        if (r === 0 || tiles[r-1][c] !== '~') {
                            const wave = Math.sin(this.time * 0.005 + c) * 4;
                            ctx.fillRect(tx, ty + 8 + wave, T, T - 8 - wave);
                            ctx.fillStyle = 'rgba(255, 255, 255, 0.2)'; // Foam
                            ctx.fillRect(tx, ty + 8 + wave, T, 4);
                        } else {
                            ctx.fillRect(tx, ty, T, T);
                        }
                    } else if (tile === '^') {
                        // Spikes
                        const spikeColor = lvl.num >= 4 ? '#FF5722' : '#B0BEC5';
                        ctx.fillStyle = spikeColor;
                        for (let s = 0; s < 4; s++) {
                            ctx.beginPath();
                            const sx = tx + s * 8;
                            ctx.moveTo(sx, ty + T);
                            ctx.lineTo(sx + 4, ty + 8);
                            ctx.lineTo(sx + 8, ty + T);
                            ctx.closePath();
                            ctx.fill();
                        }
                        // Spike highlight
                        ctx.fillStyle = 'rgba(255,255,255,0.2)';
                        for (let s = 0; s < 4; s++) {
                            ctx.fillRect(tx + s * 8 + 3, ty + 10, 2, 6);
                        }
                    }
                }
            }
        }

        _renderHUD(ctx) {
            const p = this.player;

            // Semi-transparent HUD background
            ctx.fillStyle = 'rgba(0,0,0,0.4)';
            util.roundRect(ctx, 8, 8, 300, 40, 8);
            ctx.fill();

            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';

            // Lives (hearts)
            for (let i = 0; i < p.maxLives; i++) {
                const hx = 18 + i * 24;
                const hy = 28;
                if (i < p.lives) {
                    ctx.fillStyle = '#F44336';
                    this._drawHeart(ctx, hx, hy, 9);
                } else {
                    ctx.fillStyle = 'rgba(255,255,255,0.2)';
                    this._drawHeart(ctx, hx, hy, 9);
                }
            }

            // Coins
            ctx.fillStyle = '#FFD700';
            ctx.font = 'bold 14px "Press Start 2P", monospace';
            ctx.fillText('🪙 ' + p.coins, 142, 28);

            // Score
            ctx.fillStyle = '#FFFFFF';
            ctx.fillText(String(p.score).padStart(6, '0'), 220, 28);

            // Level indicator
            ctx.fillStyle = 'rgba(0,0,0,0.4)';
            util.roundRect(ctx, CW - 130, 8, 122, 40, 8);
            ctx.fill();
            ctx.fillStyle = '#90A4AE';
            ctx.font = '10px "Press Start 2P", monospace';
            ctx.textAlign = 'right';
            ctx.fillText('LEVEL ' + (this.levelIdx + 1), CW - 18, 22);
            ctx.fillStyle = '#FFFFFF';
            ctx.font = '8px "Press Start 2P", monospace';
            ctx.fillText(this.level.name, CW - 18, 38);
            ctx.textAlign = 'left';

            // Power-up indicators
            if (p.doubleJump) {
                ctx.fillStyle = 'rgba(41,182,246,0.3)';
                util.roundRect(ctx, 8, 54, 90, 20, 5);
                ctx.fill();
                ctx.fillStyle = '#29B6F6';
                ctx.font = '7px "Press Start 2P", monospace';
                ctx.fillText('DBL JUMP', 14, 66);
            }
            if (p.speedBoost > 0) {
                ctx.fillStyle = 'rgba(255,171,0,0.3)';
                util.roundRect(ctx, 8, p.doubleJump ? 78 : 54, 90, 20, 5);
                ctx.fill();
                ctx.fillStyle = '#FFAB00';
                ctx.font = '7px "Press Start 2P", monospace';
                ctx.fillText('SPEED!', 14, (p.doubleJump ? 78 : 54) + 12);
            }
        }

        _drawHeart(ctx, x, y, s) {
            ctx.beginPath();
            ctx.moveTo(x, y - s / 4);
            ctx.quadraticCurveTo(x, y - s, x + s / 2, y - s);
            ctx.quadraticCurveTo(x + s, y - s, x + s, y - s / 4);
            ctx.quadraticCurveTo(x + s, y + s / 3, x + s / 2, y + s / 1.5);
            ctx.lineTo(x, y + s);
            ctx.lineTo(x - s / 2, y + s / 1.5);
            ctx.quadraticCurveTo(x - s, y + s / 3, x - s, y - s / 4);
            ctx.quadraticCurveTo(x - s, y - s, x - s / 2, y - s);
            ctx.quadraticCurveTo(x, y - s, x, y - s / 4);
            ctx.fill();
        }

        _renderPause() {
            const ctx = this.ctx;
            // Overlay
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(0, 0, CW, CH);

            ctx.textAlign = 'center';
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 36px "Press Start 2P", monospace';
            ctx.fillText('PAUSED', CW / 2, CH / 2 - 20);

            ctx.fillStyle = '#90A4AE';
            ctx.font = '12px "Press Start 2P", monospace';
            ctx.fillText('Press P or ESC to Resume', CW / 2, CH / 2 + 30);
        }

        _renderLevelComplete() {
            const ctx = this.ctx;
            const progress = Math.min(1, (120 - this.transition) / 60);

            ctx.fillStyle = `rgba(0,0,0,${0.6 * progress})`;
            ctx.fillRect(0, 0, CW, CH);

            if (progress >= 1) {
                ctx.textAlign = 'center';

                // Stars burst effect
                ctx.fillStyle = '#FFD700';
                for (let i = 0; i < 8; i++) {
                    const angle = (this.time * 0.002) + (i * Math.PI / 4);
                    const r = 80 + Math.sin(this.time * 0.003 + i) * 15;
                    const sx = CW / 2 + Math.cos(angle) * r;
                    const sy = CH / 2 - 30 + Math.sin(angle) * r;
                    ctx.globalAlpha = 0.5;
                    ctx.beginPath();
                    ctx.arc(sx, sy, 3, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.globalAlpha = 1;

                ctx.fillStyle = '#4CAF50';
                ctx.font = 'bold 32px "Press Start 2P", monospace';
                ctx.fillText('LEVEL COMPLETE!', CW / 2, CH / 2 - 40);

                ctx.fillStyle = '#FFD700';
                ctx.font = '14px "Press Start 2P", monospace';
                ctx.fillText('Score: ' + this.player.score, CW / 2, CH / 2 + 10);

                ctx.fillStyle = '#FFFFFF';
                ctx.font = '10px "Press Start 2P", monospace';
                const nextText = this.levelIdx + 1 >= levels.length ? 'Click for Victory!' : 'Click to Continue';
                ctx.fillText(nextText, CW / 2, CH / 2 + 50);
            }
        }

        _renderGameOver() {
            const ctx = this.ctx;
            const grad = ctx.createLinearGradient(0, 0, 0, CH);
            grad.addColorStop(0, '#1a0000');
            grad.addColorStop(1, '#330000');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, CW, CH);

            ctx.textAlign = 'center';

            // Skull/death icon (simple X)
            ctx.strokeStyle = '#F44336';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(CW / 2 - 20, CH / 2 - 100);
            ctx.lineTo(CW / 2 + 20, CH / 2 - 60);
            ctx.moveTo(CW / 2 + 20, CH / 2 - 100);
            ctx.lineTo(CW / 2 - 20, CH / 2 - 60);
            ctx.stroke();

            ctx.fillStyle = '#F44336';
            ctx.font = 'bold 40px "Press Start 2P", monospace';
            ctx.fillText('GAME OVER', CW / 2, CH / 2 - 10);

            ctx.fillStyle = '#FFD700';
            ctx.font = '14px "Press Start 2P", monospace';
            ctx.fillText('Final Score: ' + this.player.score, CW / 2, CH / 2 + 40);

            ctx.fillStyle = '#90A4AE';
            ctx.font = '10px "Press Start 2P", monospace';
            const pulse = Math.sin(this.time * 0.005) > 0;
            if (pulse) ctx.fillText('Click to Return to Menu', CW / 2, CH / 2 + 80);
        }

        _renderVictory() {
            const ctx = this.ctx;
            const grad = ctx.createLinearGradient(0, 0, 0, CH);
            grad.addColorStop(0, '#0D47A1');
            grad.addColorStop(1, '#1A237E');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, CW, CH);

            // Animated stars
            for (const s of this.stars) {
                s.y += s.speed * 2;
                if (s.y > CH) { s.y = 0; s.x = Math.random() * CW; }
                ctx.globalAlpha = s.alpha;
                ctx.fillStyle = '#FFD700';
                ctx.fillRect(s.x, s.y, s.size + 1, s.size + 1);
            }
            ctx.globalAlpha = 1;

            ctx.textAlign = 'center';

            ctx.fillStyle = '#FFD700';
            ctx.font = 'bold 36px "Press Start 2P", monospace';
            ctx.fillText('VICTORY!', CW / 2, 140);

            ctx.fillStyle = '#FFFFFF';
            ctx.font = '14px "Press Start 2P", monospace';
            ctx.fillText('Congratulations!', CW / 2, 200);

            ctx.fillStyle = '#90CAF9';
            ctx.font = '12px "Press Start 2P", monospace';
            ctx.fillText('All levels cleared!', CW / 2, 240);

            ctx.fillStyle = '#FFD700';
            ctx.font = '16px "Press Start 2P", monospace';
            ctx.fillText('Score: ' + this.player.score, CW / 2, 300);

            ctx.fillStyle = '#FFFFFF';
            ctx.font = '12px "Press Start 2P", monospace';
            ctx.fillText('Coins: ' + this.player.coins, CW / 2, 340);

            // Draw Cecile celebrating
            this._drawMenuCharacter(ctx, CW / 2, 370);

            ctx.fillStyle = '#90A4AE';
            ctx.font = '10px "Press Start 2P", monospace';
            const pulse = Math.sin(this.time * 0.005) > 0;
            if (pulse) ctx.fillText('Click to Play Again', CW / 2, CH - 40);
        }

        // ============================================
        // CINEMATIC & CREDITS
        // ============================================
        _updateCinematic() {
            this.cinematicTime++;
            const t = this.cinematicTime;
            
            if (t === 360) {
                this.cinematicPhase = 1; // Wind up axe
            } else if (t === 410) {
                this.cinematicPhase = 2; // Strike 1
                this._doAxeHit(1);
            } else if (t === 470) {
                this.cinematicPhase = 3; // Strike 2
                this._doAxeHit(2);
            } else if (t === 540) {
                this.cinematicPhase = 4; // Strike 3
                this._doAxeHit(3);
            } else if (t > 700) {
                this.state = STATE.CREDITS;
                this.creditsScrollY = CH + 50;
            }
            particles.update();
        }

        _doAxeHit(hits) {
            this.cinematicLogoHits = hits;
            audio.hit();
            camera.doShake(hits * 5, 20 + hits * 10);
            
            if (hits === 3) {
                // Shatter completely
                particles.emit(CW / 2 + 100, CH / 2, 100, { color: '#FFD700', minSpd: -12, maxSpd: 12, minLife: 30, maxLife: 80, minSz: 3, maxSz: 8 });
                particles.emit(CW / 2 + 100, CH / 2, 80, { color: '#FF4444', minSpd: -8, maxSpd: 8, minLife: 20, maxLife: 50, minSz: 2, maxSz: 5 });
            } else {
                // Just some dust
                particles.emit(CW / 2 + 100, CH / 2, 30, { color: '#EEEEEE', minSpd: -4, maxSpd: 4, minLife: 15, maxLife: 30 });
            }
        }

        _renderCinematic() {
            const ctx = this.ctx;
            const t = this.cinematicTime;
            
            // 1. Draw Night Background & Moon & Stars
            ctx.fillStyle = '#010515';
            ctx.fillRect(0, 0, CW, CH);
            
            ctx.fillStyle = '#FFF59D';
            ctx.beginPath();
            ctx.arc(CW / 2 + 150, 100, 40, 0, Math.PI * 2);
            ctx.fill();
            
            ctx.fillStyle = '#FFFFFF';
            for (let i = 0; i < 40; i++) {
                const sx = (i * 87) % CW;
                const sy = (i * 31) % (CH / 2);
                const alpha = 0.5 + Math.sin(this.time * 0.005 + i) * 0.5;
                ctx.globalAlpha = alpha;
                ctx.fillRect(sx, sy, 2, 2);
            }
            ctx.globalAlpha = 1;

            // 2. Draw Water Waves
            const waterY = CH / 2 + 40;
            ctx.fillStyle = 'rgba(0, 119, 190, 0.6)';
            ctx.fillRect(0, waterY, CW, CH - waterY);
            
            ctx.fillStyle = 'rgba(0, 150, 220, 0.8)';
            for (let x = 0; x <= CW; x += 20) {
                const wave = Math.sin(this.time * 0.05 + x) * 6;
                ctx.fillRect(x, waterY - 8 + wave, 20, 12);
                ctx.fillStyle = 'rgba(255, 255, 255, 0.4)'; // Foam
                ctx.fillRect(x, waterY - 8 + wave, 20, 3);
                ctx.fillStyle = 'rgba(0, 150, 220, 0.8)';
            }
            
            ctx.save();
            if (camera.shakeDur > 0) {
                ctx.translate((Math.random() - 0.5) * camera.shake, (Math.random() - 0.5) * camera.shake);
                camera.shakeDur--;
            }

            // 3. Draw Halic Logo
            const logoImg = assets.get('halic');
            const logoX = CW - 120;
            const logoY = waterY - 60;
            if (logoImg && this.cinematicLogoHits < 3) {
                const drawW = 200;
                const drawH = Math.round(200 * (logoImg.height / logoImg.width));
                ctx.save();
                ctx.translate(logoX, logoY);
                ctx.translate(0, Math.sin(this.time * 0.02) * 4);
                ctx.drawImage(logoImg, -drawW / 2, -drawH / 2, drawW, drawH);
                
                // Draw cracks
                if (this.cinematicLogoHits >= 1) {
                    ctx.strokeStyle = '#222';
                    ctx.lineWidth = 4;
                    ctx.beginPath();
                    ctx.moveTo(-20, -50);
                    ctx.lineTo(10, -10);
                    ctx.lineTo(-5, 30);
                    ctx.stroke();
                }
                if (this.cinematicLogoHits >= 2) {
                    ctx.beginPath();
                    ctx.moveTo(30, -40);
                    ctx.lineTo(0, 10);
                    ctx.lineTo(40, 40);
                    ctx.stroke();
                    // Additional large crack
                    ctx.beginPath();
                    ctx.moveTo(-40, 10);
                    ctx.lineTo(-10, 20);
                    ctx.lineTo(20, 70);
                    ctx.stroke();
                }
                ctx.restore();
            }

            // 4. Draw Cecile
            const cecileImg = assets.get('cecile');
            if (cecileImg) {
                let cx = -100;
                let cy = waterY - 10;
                let bob = Math.sin(this.time * 0.05) * 6;
                let rot = 0;
                
                if (t < 360) {
                    // Swim Phase
                    cx = -100 + (t / 360) * (logoX - 120 - (-100)); // Swim to logo
                    rot = 0.2 + Math.sin(this.time * 0.1) * 0.1; // swim rotate
                } else {
                    // Reached the logo
                    cx = logoX - 120;
                    
                    if (this.cinematicPhase === 1) rot = -0.3; 
                    else if (this.cinematicPhase === 2) rot = 0.2;
                    else if (this.cinematicPhase === 3) rot = 0.3;
                    else if (this.cinematicPhase >= 4) rot = 0.4;
                    
                    // Chop animations
                    if (t >= 390 && t < 410) { rot = -0.8; cx -= 10; cy -= 10; } // wind 1
                    if (t === 410 || t === 411) { rot = 0.5; cx += 20; }  // chop 1
                    
                    if (t >= 450 && t < 470) { rot = -1.0; cx -= 15; cy -= 15; } // wind 2
                    if (t === 470 || t === 471) { rot = 0.6; cx += 30; }  // chop 2
                    
                    if (t >= 500 && t < 540) { rot = -1.5; cx -= 25; cy -= 25; } // wind 3 (HUGE)
                    if (t >= 540 && t <= 544) { rot = 1.0; cx += 50; }  // chop 3
                }
                cy += bob;

                const drawW = 140;
                const drawH = Math.round(140 * (cecileImg.height / cecileImg.width));
                
                ctx.save();
                ctx.translate(cx, cy);
                ctx.rotate(rot);
                
                ctx.drawImage(cecileImg, -drawW / 2, -drawH / 2, drawW, drawH);
                
                // Swimsuit / Snorkel
                if (t < 360) {
                    ctx.strokeStyle = '#E91E63';
                    ctx.lineWidth = 14;
                    ctx.beginPath();
                    ctx.ellipse(0, 30, 50, 20, 0, 0, Math.PI * 2);
                    ctx.stroke();
                    // Optional bright colors
                    ctx.strokeStyle = '#29B6F6';
                    ctx.beginPath();
                    ctx.ellipse(0, 30, 50, 20, 0, Math.PI, Math.PI * 2);
                    ctx.stroke();
                }
                
                // Draw Axe
                if (t >= 360) {
                    ctx.save();
                    ctx.translate(15, 20); // Hand pos
                    ctx.fillStyle = '#795548';
                    ctx.fillRect(-15, -60, 10, 90);
                    ctx.fillStyle = '#B0BEC5';
                    ctx.beginPath();
                    ctx.moveTo(-17, -50);
                    ctx.lineTo(25, -70);
                    ctx.lineTo(27, -20);
                    ctx.lineTo(-17, -30);
                    ctx.fill();
                    ctx.fillStyle = '#CFD8DC';
                    ctx.beginPath();
                    ctx.moveTo(10, -55);
                    ctx.lineTo(25, -65);
                    ctx.lineTo(27, -25);
                    ctx.lineTo(10, -35);
                    ctx.fill();
                    ctx.restore();
                }
                ctx.restore();
            }

            particles.render(ctx, 0, 0);
            ctx.restore(); // camera shake

            if (this.cinematicPhase === 4 && t > 540 && t < 560) {
                ctx.fillStyle = `rgba(255, 255, 255, ${1 - (t - 540) / 20})`;
                ctx.fillRect(0, 0, CW, CH);
            }
        }

        _updateCredits() {
            this.creditsScrollY -= 0.6; // Scroll speed
        }

        _renderCredits() {
            const ctx = this.ctx;
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, CW, CH);

            // Render starry background similar to menu
            for (const s of this.stars) {
                ctx.globalAlpha = s.alpha * (0.5 + Math.sin(this.time * 0.002 + s.x) * 0.5);
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(s.x, s.y, s.size, s.size);
            }
            ctx.globalAlpha = 1;

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            // Text
            ctx.fillStyle = '#FFFFFF';
            ctx.font = 'bold 20px "Press Start 2P", monospace';
            ctx.fillText("Sesil yeni hayatında artık çok mutlu,", CW / 2, this.creditsScrollY);
            
            ctx.fillStyle = '#FF6B9D'; // Meryem & Hamza color
            ctx.font = '16px "Press Start 2P", monospace';
            ctx.fillText("meryem ile hamza gururla sunar", CW / 2, this.creditsScrollY + 40);

            if (this.creditsScrollY < -50) {
                ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
                ctx.font = '12px "Press Start 2P", monospace';
                const pulse = Math.sin(this.time * 0.005) > 0;
                if (pulse) ctx.fillText('Click to Return to Menu', CW / 2, CH - 40);
            }
        }
    }

    // ---- Initialize Game ----
    window.addEventListener('DOMContentLoaded', () => {
        new Game();
    });

})();
