import { useEffect, useMemo, useRef, useState } from "react";

export default function Game() {
  const canvasRef = useRef(null);
  const rafRef = useRef(null);
  const lastTRef = useRef(0);

  const [ready, setReady] = useState(false);

  const W = 1000;
  const H = 600;
  const groundY = 460;

  // Input (keyboard)
  const input = useMemo(() => {
    const keys = new Set();
    const onDown = (e) => {
      // prevent scrolling with arrows/space
      const k = e.key.toLowerCase();
      if (["arrowleft", "arrowright", " ", "arrowup"].includes(k) || k === " " ) e.preventDefault();
      keys.add(k);
    };
    const onUp = (e) => {
      keys.delete(e.key.toLowerCase());
    };
    return {
      keys,
      bind() {
        window.addEventListener("keydown", onDown, { passive: false });
        window.addEventListener("keyup", onUp);
      },
      unbind() {
        window.removeEventListener("keydown", onDown);
        window.removeEventListener("keyup", onUp);
      },
    };
  }, []);

  useEffect(() => {
    input.bind();
    return () => input.unbind();
  }, [input]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = W;
    canvas.height = H;

    const ctx = canvas.getContext("2d");

    // Game state
    const state = {
      // P1 controls: A/D move, W jump, F punch
      // P2 controls: Arrow keys move, ArrowUp jump, "/" punch
      // (Adjust easily later)
      p1: makeFighter({
        x: 220,
        y: groundY,
        side: 1,
        color: "#1e90ff",
        controls: { left: "a", right: "d", jump: "w", punch: "f" },
      }),
      p2: makeFighter({
        x: 780,
        y: groundY,
        side: -1,
        color: "#ff3b30",
        controls: { left: "arrowleft", right: "arrowright", jump: "arrowup", punch: "/" },
      }),
      round: 1,
      winner: null,
      shakeT: 0,
    };

    function reset() {
      state.p1 = makeFighter({
        x: 220,
        y: groundY,
        side: 1,
        color: "#1e90ff",
        controls: { left: "a", right: "d", jump: "w", punch: "f" },
      });
      state.p2 = makeFighter({
        x: 780,
        y: groundY,
        side: -1,
        color: "#ff3b30",
        controls: { left: "arrowleft", right: "arrowright", jump: "arrowup", punch: "/" },
      });
      state.winner = null;
      state.round++;
    }

    function makeFighter({ x, y, side, color, controls }) {
      return {
        x,
        y,
        vx: 0,
        vy: 0,
        w: 26,
        h: 72,

        // stick size
        headR: 12,
        torsoLen: 32,
        armLen: 26,
        legLen: 30,

        onGround: true,
        facing: side, // 1 right, -1 left
        color,
        controls,

        health: 100,
        invulnT: 0,

        punchT: 0, // >0 means punching animation
        punchCooldownT: 0,

        // For hit detection
        hitbox: null,
      };
    }

    function clamp(v, a, b) {
      return Math.max(a, Math.min(b, v));
    }

    function stepFighter(f, dt, enemy) {
      // If someone won, stop movement
      if (state.winner) return;

      // Timers
      f.invulnT = Math.max(0, f.invulnT - dt);
      f.punchT = Math.max(0, f.punchT - dt);
      f.punchCooldownT = Math.max(0, f.punchCooldownT - dt);

      // Read input
      const k = input.keys;
      const left = k.has(f.controls.left);
      const right = k.has(f.controls.right);
      const jump = k.has(f.controls.jump);
      const punch = k.has(f.controls.punch);

      // Horizontal movement
      const accel = 1400;
      const maxSpeed = 260;
      if (left) f.vx -= accel * dt;
      if (right) f.vx += accel * dt;

      // Friction
      f.vx *= Math.pow(0.0008, dt); // exponential decay feel

      f.vx = clamp(f.vx, -maxSpeed, maxSpeed);

      // Facing direction based on movement, otherwise keep current
      if (Math.abs(f.vx) > 10) f.facing = Math.sign(f.vx) || f.facing;

      // Jump
      if (jump && f.onGround) {
        f.vy = -520;
        f.onGround = false;
      }

      // Start punch (simple: only on key press while off cooldown)
      // To avoid "holding key = infinite punches", we require a cooldown.
      if (punch && f.punchCooldownT <= 0 && f.punchT <= 0) {
        f.punchT = 0.18; // animation duration
        f.punchCooldownT = 0.45;
      }

      // Gravity
      const g = 1200;
      f.vy += g * dt;

      // Integrate
      f.x += f.vx * dt;
      f.y += f.vy * dt;

      // World bounds
      f.x = clamp(f.x, 70, W - 70);

      // Ground collision
      if (f.y >= groundY) {
        f.y = groundY;
        f.vy = 0;
        f.onGround = true;
      } else {
        f.onGround = false;
      }

      // Create hitbox during a portion of punch
      // We use a small timing window around mid-punch.
      f.hitbox = null;
      if (f.punchT > 0) {
        const progress = 1 - f.punchT / 0.18; // 0..1
        const active = progress > 0.35 && progress < 0.75;
        if (active) {
          const hbW = 40;
          const hbH = 20;
          const cx = f.x + f.facing * 28;
          const cy = f.y - 26;
          f.hitbox = {
            x: cx - hbW / 2,
            y: cy - hbH / 2,
            w: hbW,
            h: hbH,
          };
        }
      }

      // Check collision against enemy
      if (f.hitbox && !state.winner) {
        if (aabb(f.hitbox, enemy) && enemy.invulnT <= 0) {
          // Knockback + damage
          enemy.health -= 10;
          enemy.invulnT = 0.35;

          enemy.vx = enemy.vx + f.facing * 230;
          enemy.vy = Math.min(enemy.vy - 120, -120);

          state.shakeT = 0.10;

          if (enemy.health <= 0) {
            state.winner = f;
          }
        }
      }
    }

    // Helper: fighter's body AABB (coarse)
    function aabb(hitbox, f) {
      const body = { x: f.x - 18, y: f.y - 80, w: 36, h: 90 };
      return !(
        hitbox.x + hitbox.w < body.x ||
        hitbox.x > body.x + body.w ||
        hitbox.y + hitbox.h < body.y ||
        hitbox.y > body.y + body.h
      );
    }

    // Render
    function drawFighter(f, shakeX) {
      const x = f.x + shakeX;
      const y = f.y;

      // Shadow
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath();
      ctx.ellipse(x, groundY + 12, 18, 6, 0, 0, Math.PI * 2);
      ctx.fill();

      // Stick style
      // Head
      ctx.strokeStyle = f.color;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, y - 78, f.headR, 0, Math.PI * 2);
      ctx.stroke();

      // Torso
      ctx.beginPath();
      ctx.moveTo(x, y - 66);
      ctx.lineTo(x, y - 48);
      ctx.stroke();

      // Arms
      const armSwing = f.punchT > 0 ? (1 - f.punchT / 0.18) : 0;
      const punchArm = f.punchT > 0 && armSwing > 0.35 && armSwing < 0.75;

      const handDir = punchArm ? f.facing : f.facing * 0.2;
      const armX = x + handDir * 24;

      ctx.beginPath();
      ctx.moveTo(x, y - 58);
      ctx.lineTo(armX, y - 60);
      ctx.stroke();

      // Legs
      ctx.beginPath();
      ctx.moveTo(x, y - 48);
      ctx.lineTo(x - 10, y - f.onGround ? 4 : -2);
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(x, y - 48);
      ctx.lineTo(x + 10, y - f.onGround ? 4 : -2);
      ctx.stroke();

      // Optional: invuln outline
      if (f.invulnT > 0) {
        ctx.strokeStyle = "rgba(255,255,255,0.8)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y - 78, f.headR + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    function drawHealthBar(f, x, align = "left") {
      const barW = 320;
      const barH = 14;

      const pct = clamp(f.health / 100, 0, 1);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      if (align === "left") ctx.fillRect(x, 18, barW, barH);
      else ctx.fillRect(x - barW, 18, barW, barH);

      ctx.fillStyle = f.color;
      const w = barW * pct;
      if (align === "left") ctx.fillRect(x, 18, w, barH);
      else ctx.fillRect(x - w, 18, w, barH);
    }

    function render() {
      // shake
      let shakeX = 0;
      if (state.shakeT > 0) {
        shakeX = (Math.random() - 0.5) * 10;
        state.shakeT = Math.max(0, state.shakeT - 0); // actual dt update in loop
      }

      ctx.clearRect(0, 0, W, H);

      // Background
      ctx.fillStyle = "#0b1020";
      ctx.fillRect(0, 0, W, H);

      // Stage
      ctx.fillStyle = "#1d2a44";
      ctx.fillRect(0, groundY + 16, W, H - groundY);

      // Ground line
      ctx.strokeStyle = "rgba(255,255,255,0.18)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, groundY + 16);
      ctx.lineTo(W, groundY + 16);
      ctx.stroke();

      // Health
      drawHealthBar(state.p1, 80, "left");
      drawHealthBar(state.p2, W - 80, "right");

      // Fighters
      drawFighter(state.p1, shakeX);
      drawFighter(state.p2, shakeX);

      // Debug hitboxes (optional)
      // ctx.strokeStyle = "lime";
      // if (state.p1.hitbox) ctx.strokeRect(...Object.values(state.p1.hitbox));
      // if (state.p2.hitbox) ctx.strokeRect(...Object.values(state.p2.hitbox));

      // Winner / UI
      if (state.winner) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(0, 0, W, H);

        ctx.fillStyle = "#fff";
        ctx.font = "44px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(
          state.winner === state.p1 ? "Player 1 Wins!" : "Player 2 Wins!",
          W / 2,
          H / 2 - 10
        );

        ctx.font = "18px sans-serif";
        ctx.fillStyle = "rgba(255,255,255,0.85)";
        ctx.fillText("Press R to restart", W / 2, H / 2 + 30);
      }
    }

    function update(dt) {
      // restart
      if (state.winner && input.keys.has("r")) {
        reset();
        // consume restart key quickly by clearing it
        input.keys.delete("r");
      }

      // Step shake timer
      state.shakeT = Math.max(0, state.shakeT - dt);

      // Basic AI for P2 (optional). Right now both are player-controlled.
      // If you want AI later, tell me and I'll replace stepFighter for p2.

      stepFighter(state.p1, dt, state.p2);
      stepFighter(state.p2, dt, state.p1);

      // If fighters get close, keep them facing each other
      if (!state.winner) {
        const dx = state.p2.x - state.p1.x;
        if (dx > 0) state.p1.facing = 1;
        else state.p1.facing = -1;

        if (dx > 0) state.p2.facing = -1;
        else state.p2.facing = 1;
      }
    }

    function loop(t) {
      const last = lastTRef.current || t;
      let dt = (t - last) / 1000;
      lastTRef.current = t;

      // clamp dt to avoid huge jumps
      dt = Math.min(dt, 1 / 30);

      update(dt);
      render();

      rafRef.current = requestAnimationFrame(loop);
    }

    rafRef.current = requestAnimationFrame((t) => {
      lastTRef.current = t;
      rafRef.current = requestAnimationFrame(loop);
      setReady(true);
    });

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [input]);

  return (
    <div style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
      <div style={{ position: "relative" }}>
        <canvas
          ref={canvasRef}
          style={{
            width: "1000px",
            height: "600px",
            maxWidth: "100vw",
            background: "#000",
            display: "block",
          }}
        />
        {!ready && (
          <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "white" }}>
            Loading...
          </div>
        )}
        <div style={{ position: "absolute", left: 10, bottom: -34, color: "#dbeafe", fontFamily: "sans-serif", fontSize: 12 }}>
          P1: A/D move, W jump, F punch &nbsp;|&nbsp; P2: ←/→ move, ↑ jump, / punch &nbsp;|&nbsp; R restart
        </div>
      </div>
    </div>
  );
}
