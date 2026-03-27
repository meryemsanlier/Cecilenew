/* ============================================
   CECILE'S ADVENTURES - Entities Module
   Player character, enemies, and collectibles
   rendering and behavior.
   ============================================ */
(function () {
    'use strict';
    const BG = window.BG;
    const T = BG.T;
    const util = BG.util;

    // ============================================
    // PLAYER - "Bolt" the Robot
    // ============================================
    class Player {
        constructor() {
            // Dimensions & physics
            this.w = 22;
            this.h = 30;
            this.x = 0; this.y = 0;
            this.vx = 0; this.vy = 0;
            this.speed = 3.8;
            this.jumpForce = -11;
            this.grounded = false;
            this.facing = 1; // 1 = right, -1 = left

            // State
            this.lives = 5; // Start with 5 lives
            this.maxLives = 5;
            this.coins = 0;
            this.score = 0;
            this.dead = false;
            this.invincible = 0;      // invincibility frames after hit
            this.hurtTimer = 0;

            // Animation
            this.animFrame = 0;
            this.animTimer = 0;
            this.state = 'idle'; // idle, run, jump, fall, hurt

            // Power-ups
            this.doubleJump = true; // Enabled by default now!
            this.canDoubleJump = false;
            this.speedBoost = 0;

            // Checkpoint
            this.checkpointX = 0;
            this.checkpointY = 0;

            // Standing on moving platform
            this.onPlatform = null;
        }

        /** Reset player to spawn point */
        spawn(x, y) {
            this.x = x; this.y = y;
            this.vx = 0; this.vy = 0;
            this.dead = false;
            this.invincible = 0;
            this.hurtTimer = 0;
            this.grounded = false;
            this.state = 'idle';
            this.checkpointX = x;
            this.checkpointY = y;
            this.doubleJump = true; // Always on
            this.canDoubleJump = false;
            this.speedBoost = 0;
            this.onPlatform = null;
        }

        /** Full reset (new game) */
        fullReset() {
            this.lives = 5;
            this.coins = 0;
            this.score = 0;
        }

        /** Take damage */
        hurt() {
            if (this.invincible > 0 || this.dead) return;
            this.lives--;
            this.hurtTimer = 30;
            this.invincible = 90; // 1.5 seconds at 60fps
            this.vy = -6;
            BG.audio.hit();
            BG.camera.doShake(6, 15);
            BG.particles.emit(this.x + this.w / 2, this.y + this.h / 2, 12, {
                color: '#FF4444', minSpd: -4, maxSpd: 4, minLife: 10, maxLife: 25
            });
            if (this.lives <= 0) {
                this.dead = true;
            }
        }

        /** Respawn at checkpoint */
        respawn() {
            this.x = this.checkpointX;
            this.y = this.checkpointY;
            this.vx = 0;
            this.vy = 0;
            this.dead = false;
            this.invincible = 60;
            this.hurtTimer = 0;
        }

        /** Update player physics and state */
        update(level) {
            if (this.dead) return;

            const inp = BG.input;
            const tiles = level.cleanTiles;
            
            // Detect if submerged in water
            const centerX = Math.floor((this.x + this.w / 2) / T);
            const centerY = Math.floor((this.y + this.h / 2) / T);
            const inWater = this._tile(tiles, centerX, centerY) === '~';

            const accel = inWater ? 0.3 : 0.6;
            const friction = inWater ? 0.9 : 0.8;
            const maxSpeed = this.speedBoost > 0 ? this.speed * 1.5 : (inWater ? this.speed * 0.6 : this.speed);

            // ---- Horizontal movement ----
            if (inp.left) {
                this.vx -= accel;
                this.facing = -1;
            } else if (inp.right) {
                this.vx += accel;
                this.facing = 1;
            } else {
                this.vx *= friction;
                if (Math.abs(this.vx) < 0.1) this.vx = 0;
            }
            this.vx = Math.max(-maxSpeed, Math.min(maxSpeed, this.vx));

            // ---- Jumping & Swimming ----
            if (inWater) {
                if (inp.jumpDown) {
                    this.vy = -4.5; // Swim up impulse
                    BG.audio.jump();
                    BG.particles.emit(this.x + this.w / 2, this.y, 4, {
                        color: '#E0F7FA', minSpd: -1, maxSpd: 1, minLife: 10, maxLife: 20
                    });
                }
            } else {
                if (inp.jumpDown && this.grounded) {
                    this.vy = this.jumpForce;
                    this.grounded = false;
                    this.canDoubleJump = this.doubleJump;
                    BG.audio.jump();
                    BG.particles.emit(this.x + this.w / 2, this.y + this.h, 6, {
                        color: '#FFFFFF', minSpd: -2, maxSpd: 2, minLife: 5, maxLife: 12, maxSz: 3
                    });
                } else if (inp.jumpDown && !this.grounded && this.canDoubleJump) {
                    // Massive 2x jump power increase for the second double-jump!
                    this.vy = this.jumpForce * 2.0;
                    this.canDoubleJump = false;
                    BG.audio.jump();
                    BG.particles.emit(this.x + this.w / 2, this.y + this.h, 8, {
                        color: '#90CAF9', minSpd: -3, maxSpd: 3, minLife: 8, maxLife: 15, maxSz: 4
                    });
                }
            }

            // Cut jump short if button released (not in water)
            if (!inWater && !inp.jumpHeld && this.vy < -2) {
                this.vy *= 0.6;
            }

            // ---- Gravity ----
            if (inWater) {
                this.vy += BG.GRAVITY * 0.15; // Buoyancy
                if (this.vy > 1.8) this.vy = 1.8; // Terminal swim-fall speed
            } else {
                this.vy += BG.GRAVITY;
                if (this.vy > BG.MAX_FALL) this.vy = BG.MAX_FALL;
            }

            // ---- Moving platform carry ----
            let platDx = 0, platDy = 0;
            if (this.onPlatform) {
                platDx = this.onPlatform._dx || 0;
                platDy = this.onPlatform._dy || 0;
            }

            // ---- Collision: Horizontal ----
            this.x += this.vx + platDx;
            this._resolveH(tiles);

            // ---- Collision: Vertical ----
            const prevY = this.y;
            this.y += this.vy + platDy;
            this._resolveV(tiles, level, prevY);

            // ---- Fell off screen ----
            if (this.y > level.rows * T + 64) {
                this.hurt();
                if (!this.dead) this.respawn();
            }

            // ---- Update state ----
            if (this.invincible > 0) this.invincible--;
            if (this.hurtTimer > 0) this.hurtTimer--;
            if (this.speedBoost > 0) this.speedBoost--;

            // ---- Animation state ----
            if (this.hurtTimer > 0) {
                this.state = 'hurt';
            } else if (!this.grounded) {
                this.state = this.vy < 0 ? 'jump' : 'fall';
            } else if (Math.abs(this.vx) > 0.5) {
                this.state = 'run';
            } else {
                this.state = 'idle';
            }

            // Animate
            this.animTimer++;
            if (this.animTimer > 6) {
                this.animTimer = 0;
                this.animFrame = (this.animFrame + 1) % 4;
            }
        }

        /** Resolve horizontal tile collisions */
        _resolveH(tiles) {
            const margin = 2;
            // Check tiles the player overlaps
            const top = Math.floor((this.y + margin) / T);
            const bot = Math.floor((this.y + this.h - margin) / T);
            if (this.vx > 0) {
                const col = Math.floor((this.x + this.w) / T);
                for (let r = top; r <= bot; r++) {
                    if (util.isSolid(this._tile(tiles, col, r))) {
                        this.x = col * T - this.w;
                        this.vx = 0;
                        break;
                    }
                }
            } else if (this.vx < 0) {
                const col = Math.floor(this.x / T);
                for (let r = top; r <= bot; r++) {
                    if (util.isSolid(this._tile(tiles, col, r))) {
                        this.x = (col + 1) * T;
                        this.vx = 0;
                        break;
                    }
                }
            }
            // Clamp to level bounds
            if (this.x < 0) { this.x = 0; this.vx = 0; }
        }

        /** Resolve vertical tile collisions */
        _resolveV(tiles, level, prevY) {
            this.grounded = false;
            this.onPlatform = null;

            const left = Math.floor((this.x + 2) / T);
            const right = Math.floor((this.x + this.w - 2) / T);

            if (this.vy >= 0) {
                // Falling or on ground
                const row = Math.floor((this.y + this.h) / T);
                for (let c = left; c <= right; c++) {
                    const t = this._tile(tiles, c, row);
                    if (util.isSolid(t)) {
                        this.y = row * T - this.h;
                        this.vy = 0;
                        this.grounded = true;
                        break;
                    }
                    // Semi-solid platforms: only land on top
                    if (util.isPlatform(t)) {
                        const platTop = row * T;
                        const prevBottom = prevY + this.h;
                        if (prevBottom <= platTop + 2) {
                            this.y = platTop - this.h;
                            this.vy = 0;
                            this.grounded = true;
                            break;
                        }
                    }
                }

                // Check spike collision
                for (let c = left; c <= right; c++) {
                    if (util.isSpike(this._tile(tiles, c, row))) {
                        this.hurt();
                        if (!this.dead) this.respawn();
                        return;
                    }
                }

                // Moving platforms
                if (!this.grounded) {
                    for (const mp of level.movingPlatforms) {
                        if (this.x + this.w > mp.x && this.x < mp.x + mp.w) {
                            const prevBot = prevY + this.h;
                            if (prevBot <= mp.y + 2 && this.y + this.h >= mp.y) {
                                this.y = mp.y - this.h;
                                this.vy = 0;
                                this.grounded = true;
                                this.onPlatform = mp;
                                break;
                            }
                        }
                    }
                }
            } else {
                // Moving up - check ceiling
                const row = Math.floor(this.y / T);
                for (let c = left; c <= right; c++) {
                    if (util.isSolid(this._tile(tiles, c, row))) {
                        this.y = (row + 1) * T;
                        this.vy = 0;
                        break;
                    }
                }
            }

            // Check spikes at feet level
            const feetRow = Math.floor((this.y + this.h - 1) / T);
            for (let c = left; c <= right; c++) {
                if (util.isSpike(this._tile(tiles, c, feetRow))) {
                    this.hurt();
                    if (!this.dead) this.respawn();
                    return;
                }
            }
        }

        _tile(tiles, c, r) {
            if (r < 0 || r >= tiles.length || c < 0 || c >= tiles[0].length) return '.';
            return tiles[r][c];
        }

        /** Draw the player character "Cecile" using sprite image */
        render(ctx, cx, cy) {
            if (this.dead) return;
            // Blink when invincible
            if (this.invincible > 0 && Math.floor(this.invincible / 4) % 2) return;

            const x = Math.round(this.x - cx);
            const y = Math.round(this.y - cy);
            const f = this.facing;
            const img = BG.assets.get('cecile');

            ctx.save();
            
            // Translate to the character's anchor point (bottom-center)
            ctx.translate(x + this.w / 2, y + this.h);

            // 1. Direction Handling (Flip horizontally)
            if (f < 0) ctx.scale(-1, 1);

            let squashX = 1;
            let squashY = 1;
            let rotate = 0;
            let bobY = 0;

            // 2. Programmatic Animation Handling based on state
            if (this.state === 'run') {
                // Running: slight bounce and horizontal squash/stretch
                bobY = -Math.abs(Math.sin(this.animTimer * 0.4)) * 3;
                squashY = 1 + Math.sin(this.animTimer * 0.8) * 0.05;
                squashX = 1 / squashY; 
            } else if (this.state === 'jump') {
                // Jumping: tilt upward/backward slightly, stretch upwards
                rotate = -0.15; 
                squashY = 1.05;
                squashX = 0.95;
            } else if (this.state === 'fall') {
                // Falling: tilt downward slightly, stretch downwards
                rotate = 0.1;
                squashY = 0.95;
                squashX = 1.05;
            } else if (this.state === 'idle') {
                // Idle: subtle up/down floating or breathing effect
                squashY = 1 + Math.sin(Date.now() * 0.003) * 0.02;
                squashX = 1 / squashY;
                bobY = Math.sin(Date.now() * 0.003) * 1.5;
            }

            // Apply calculated animation transforms
            ctx.translate(0, bobY);
            ctx.rotate(rotate);
            ctx.scale(squashX, squashY);

            // Make the visual drawing larger (x2 requested size)
            // The image is visually wider than it is tall for a platformer character
            const drawW = 108;
            const drawH = 68;

            // 3. Rendering & Integration
            if (img) {
                // Render with smooth translation offset so feet align near the bottom of hitbox
                // Increased the Y offset by 20% to account for transparent padding under the character
                ctx.drawImage(img,
                    -drawW / 2, -drawH + Math.round(drawH * 0.25), 
                    drawW, drawH
                );

                // Added simple red tint for damage feedback (using source-atop)
                if (this.hurtTimer > 0) {
                    ctx.globalCompositeOperation = 'source-atop';
                    ctx.fillStyle = 'rgba(255, 60, 60, 0.4)';
                    ctx.fillRect(-drawW / 2, -drawH + Math.round(drawH * 0.25), drawW, drawH);
                    ctx.globalCompositeOperation = 'source-over';
                }
            } else {
                // Fallback: simple colored rectangle if image fails to load
                ctx.fillStyle = this.hurtTimer > 0 ? '#FF6666' : '#FF6B35';
                util.roundRect(ctx, -this.w / 2, -this.h, this.w, this.h, 5);
                ctx.fill();
            }

            // Speed boost powerup glow effect
            if (this.speedBoost > 0) {
                ctx.globalAlpha = 0.25 + Math.sin(Date.now() * 0.01) * 0.15;
                ctx.strokeStyle = '#00E5FF';
                ctx.lineWidth = 3;
                ctx.beginPath();
                ctx.ellipse(0, -this.h / 2, 16, 20, 0, 0, Math.PI * 2);
                ctx.stroke();
                ctx.globalAlpha = 1;
            }

            ctx.restore();
        }
    }

    BG.Player = Player;

    // ============================================
    // ENEMY BEHAVIORS
    // ============================================
    const EnemyAI = {
        /** Update a ground-patrolling slime */
        updateSlime(e, tiles) {
            const spd = 1;
            e.x += spd * e.dir;
            // Reverse at range limits
            if (e.x > e.startX + e.range || e.x < e.startX - e.range) {
                e.dir *= -1;
            }
            // Reverse at walls
            const tileAhead = util.tileAt(tiles, e.x + (e.dir > 0 ? T : 0), e.y + T / 2);
            if (util.isSolid(tileAhead)) e.dir *= -1;
            // Fall check - reverse if about to walk off edge
            const tileBelow = util.tileAt(tiles, e.x + (e.dir > 0 ? T : 0), e.y + T + 2);
            if (!util.isSolid(tileBelow) && !util.isPlatform(tileBelow)) {
                e.dir *= -1;
            }
            // Animation
            e.animTimer = (e.animTimer || 0) + 1;
        },

        /** Update a flying bat enemy */
        updateBat(e) {
            const spd = 1.5;
            e.x += spd * e.dir;
            e.phase += 0.05;
            e.y = e.startY + Math.sin(e.phase) * 30;
            if (e.x > e.startX + e.range || e.x < e.startX - e.range) {
                e.dir *= -1;
            }
            e.animTimer = (e.animTimer || 0) + 1;
        },

        /** Update a spike crab */
        updateCrab(e, tiles) {
            const spd = 0.7;
            e.x += spd * e.dir;
            if (e.x > e.startX + e.range || e.x < e.startX - e.range) {
                e.dir *= -1;
            }
            e.animTimer = (e.animTimer || 0) + 1;
        },

        /** Draw a slime enemy using Haliç University logo */
        drawSlime(ctx, e, cx, cy, time) {
            const x = Math.round(e.x - cx);
            const y = Math.round(e.y - cy);
            const img = BG.assets.get('halic');
            const bounce = Math.sin((e.animTimer || 0) * 0.08) * 3;
            const rotation = Math.sin((e.animTimer || 0) * 0.04) * 0.1;

            if (img) {
                ctx.save();
                ctx.translate(x + T / 2, y + T / 2 + bounce);
                ctx.rotate(rotation);

                // Draw logo as enemy sprite
                const size = T + 4;
                ctx.drawImage(img, -size / 2, -size / 2, size, size);

                // Subtle glow effect
                ctx.globalAlpha = 0.15 + Math.sin((e.animTimer || 0) * 0.06) * 0.1;
                ctx.strokeStyle = '#FFD700';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(0, 0, size / 2 + 3, 0, Math.PI * 2);
                ctx.stroke();
                ctx.globalAlpha = 1;

                ctx.restore();
            } else {
                // Fallback: original slime drawing
                const squish = Math.sin((e.animTimer || 0) * 0.1) * 2;
                ctx.fillStyle = '#66BB6A';
                ctx.beginPath();
                ctx.ellipse(x + T / 2, y + T - 4, 12 + squish, 10 - squish / 2, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = '#43A047';
                ctx.beginPath();
                ctx.ellipse(x + T / 2, y + T - 2, 10 + squish, 5, 0, 0, Math.PI);
                ctx.fill();
                const ex = e.dir > 0 ? 3 : -3;
                ctx.fillStyle = '#FFFFFF';
                ctx.beginPath();
                ctx.arc(x + T / 2 - 4 + ex, y + T - 10, 3, 0, Math.PI * 2);
                ctx.arc(x + T / 2 + 4 + ex, y + T - 10, 3, 0, Math.PI * 2);
                ctx.fill();
            }
        },

        /** Draw a bat enemy */
        drawBat(ctx, e, cx, cy, time) {
            const x = Math.round(e.x - cx);
            const y = Math.round(e.y - cy);
            const wingFlap = Math.sin((e.animTimer || 0) * 0.25) * 8;

            // Wings
            ctx.fillStyle = '#7E57C2';
            ctx.beginPath();
            ctx.moveTo(x + T / 2, y + T / 2);
            ctx.lineTo(x + T / 2 - 14, y + T / 2 - wingFlap);
            ctx.lineTo(x + T / 2 - 8, y + T / 2 + 4);
            ctx.closePath();
            ctx.fill();
            ctx.beginPath();
            ctx.moveTo(x + T / 2, y + T / 2);
            ctx.lineTo(x + T / 2 + 14, y + T / 2 - wingFlap);
            ctx.lineTo(x + T / 2 + 8, y + T / 2 + 4);
            ctx.closePath();
            ctx.fill();

            // Body
            ctx.fillStyle = '#5E35B1';
            ctx.beginPath();
            ctx.ellipse(x + T / 2, y + T / 2 + 2, 7, 8, 0, 0, Math.PI * 2);
            ctx.fill();

            // Eyes
            ctx.fillStyle = '#FF1744';
            ctx.beginPath();
            ctx.arc(x + T / 2 - 3, y + T / 2 - 1, 2, 0, Math.PI * 2);
            ctx.arc(x + T / 2 + 3, y + T / 2 - 1, 2, 0, Math.PI * 2);
            ctx.fill();
        },

        /** Draw a spike crab */
        drawCrab(ctx, e, cx, cy, time) {
            const x = Math.round(e.x - cx);
            const y = Math.round(e.y - cy);
            const walk = Math.sin((e.animTimer || 0) * 0.15) * 2;

            // Body
            ctx.fillStyle = '#D84315';
            util.roundRect(ctx, x + 4, y + 10, 24, 14, 4);
            ctx.fill();

            // Spikes on top
            ctx.fillStyle = '#BF360C';
            for (let i = 0; i < 4; i++) {
                ctx.beginPath();
                const sx = x + 8 + i * 5;
                ctx.moveTo(sx, y + 12);
                ctx.lineTo(sx + 3, y + 4);
                ctx.lineTo(sx + 6, y + 12);
                ctx.closePath();
                ctx.fill();
            }

            // Legs
            ctx.fillStyle = '#BF360C';
            ctx.fillRect(x + 6, y + 22 + walk, 3, 6);
            ctx.fillRect(x + 14, y + 22 - walk, 3, 6);
            ctx.fillRect(x + 22, y + 22 + walk, 3, 6);

            // Eyes
            ctx.fillStyle = '#FFF59D';
            ctx.beginPath();
            ctx.arc(x + 12, y + 16, 2, 0, Math.PI * 2);
            ctx.arc(x + 20, y + 16, 2, 0, Math.PI * 2);
            ctx.fill();
        }
    };

    BG.EnemyAI = EnemyAI;

    // ============================================
    // RENDER HELPERS - Coins, Portals, etc.
    // ============================================
    BG.drawCoin = function (ctx, coin, cx, cy, time) {
        if (!coin.alive) return;
        const x = coin.x - cx;
        const y = coin.y - cy + Math.sin(time * 0.003 + coin.bobOffset) * 3;

        // Glow
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = '#FFD700';
        ctx.beginPath();
        ctx.arc(x + 8, y + 8, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        // Coin body
        const scaleX = Math.abs(Math.cos(time * 0.004 + coin.bobOffset));
        ctx.fillStyle = '#FFD700';
        ctx.beginPath();
        ctx.ellipse(x + 8, y + 8, 7 * Math.max(0.2, scaleX), 7, 0, 0, Math.PI * 2);
        ctx.fill();

        // Highlight
        ctx.fillStyle = '#FFF176';
        ctx.beginPath();
        ctx.ellipse(x + 8, y + 7, 3 * Math.max(0.2, scaleX), 3, 0, 0, Math.PI * 2);
        ctx.fill();
    };

    BG.drawPortal = function (ctx, portal, cx, cy, time) {
        if (!portal) return;
        const x = portal.x - cx + T / 2;
        const y = portal.y - cy + T / 2;

        // Outer glow
        const pulse = Math.sin(time * 0.005) * 0.3 + 0.7;
        ctx.globalAlpha = 0.2 * pulse;
        ctx.fillStyle = '#E040FB';
        ctx.beginPath();
        ctx.arc(x, y, 24, 0, Math.PI * 2);
        ctx.fill();

        // Portal ring
        ctx.globalAlpha = 0.8;
        ctx.strokeStyle = '#CE93D8';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.stroke();

        // Inner swirl
        ctx.strokeStyle = '#E040FB';
        ctx.lineWidth = 2;
        const angle = time * 0.003;
        for (let i = 0; i < 3; i++) {
            const a = angle + (i * Math.PI * 2 / 3);
            ctx.beginPath();
            ctx.arc(x, y, 8, a, a + 1.2);
            ctx.stroke();
        }

        // Center glow
        ctx.fillStyle = '#F3E5F5';
        ctx.globalAlpha = pulse;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
    };

    BG.drawCheckpoint = function (ctx, cp, cx, cy, time) {
        const x = cp.x - cx;
        const y = cp.y - cy;

        // Pole
        ctx.fillStyle = '#9E9E9E';
        ctx.fillRect(x + 14, y, 4, T * 2);

        // Flag
        const color = cp.activated ? '#4CAF50' : '#F44336';
        const wave = cp.activated ? Math.sin(time * 0.005) * 3 : 0;
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(x + 18, y + 4);
        ctx.lineTo(x + 30 + wave, y + 10);
        ctx.lineTo(x + 18, y + 18);
        ctx.closePath();
        ctx.fill();
    };

    BG.drawPowerup = function (ctx, pu, cx, cy, time) {
        if (!pu.alive) return;
        const x = pu.x - cx + 12;
        const y = pu.y - cy + 12 + Math.sin(time * 0.004) * 3;

        // Glow
        ctx.globalAlpha = 0.25 + Math.sin(time * 0.006) * 0.15;
        ctx.fillStyle = pu.type === 'doublejump' ? '#29B6F6' : '#FFAB00';
        ctx.beginPath();
        ctx.arc(x, y, 18, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        // Orb
        ctx.fillStyle = pu.type === 'doublejump' ? '#0288D1' : '#FF8F00';
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.fill();

        // Icon
        ctx.fillStyle = '#FFFFFF';
        ctx.font = 'bold 12px Inter';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(pu.type === 'doublejump' ? '⬆' : '⚡', x, y);
    };

})();
