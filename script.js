/*
  GOLDSMITH & CO — Cube hero controller
  ======================================
  The page never scrolls. Scroll-shaped input (wheel, touch drag, arrow
  keys) accumulates into `turns` — a continuous value where 1.0 = one
  90° turn of every band-cube on the page, and one viewport-height of
  input = one turn. Faces alternate state 1 / state 2 forever in both
  directions. When input goes idle the nearest face snaps square.

  Geometry: each [data-gc-band] is a Y-axis carousel. Its two faces are
  placed at consecutive 90° stations on a circle of radius r = bandWidth/2,
  and the assembly is pushed back by r and rotated by -turns*90°, so the
  active face always sits on the screen plane. Face contents alternate by
  station parity (even station = state 1), recomputed every frame, which
  is what lets two DOM faces stand in for an infinite cube.

  The photo is not part of any cube — it has its own controller (§ photo
  scene, bottom of this file): a 3D room box that dollies back on drag
  while the man scales up out of the frame, and a water-float wobble when
  the man is tapped. Touch gestures that START on the photo belong to the
  photo scene, not the cube (guard in the touchstart handler).
*/
(function () {
  "use strict";

  var TURN_DISTANCE_FACTOR = 1.0; // 1 viewport height of WHEEL input = 1 turn
  // Touch is not wheel: a real thumb swipe covers ~40% of the screen, so
  // finger travel is amplified, release velocity is projected forward
  // (flick momentum), and any deliberate swipe commits to the next face
  // — the trio that makes a single swipe reliably equal one turn.
  var TOUCH_GAIN = 1.5;           // finger travel → turns amplification
  var MOMENTUM_MS = 220;          // how far ahead a flick's velocity is projected
  var COMMIT_DISP = 0.06;         // min gesture displacement (turns) that commits
  var COMMIT_VEL = 0.0015;        // min release velocity (turns/ms) that commits
  var SNAP_IDLE_MS = 140;         // input silence before settling begins
  // Settling is a critically-damped spring, not a lerp: velocity builds
  // gently from zero and bleeds off into the target, so the cube eases
  // into square instead of snapping (a lerp's fastest frame is its first,
  // which reads as a snap).
  var SPRING_ACCEL = 0.015;       // pull toward target, per frame²
  var SPRING_FRICTION = 0.88;     // velocity retained per frame

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function init() {
    var root = document.querySelector("[data-gc-hero]");
    if (!root) return;

    // ---- collect bands ------------------------------------------------
    var bands = [];
    root.querySelectorAll("[data-gc-band]").forEach(function (el) {
      var assembly = el.querySelector("[data-gc-assembly]");
      var face1 = el.querySelector('[data-gc-face="1"]');
      var face2 = el.querySelector('[data-gc-face="2"]');
      if (assembly && face1 && face2) {
        bands.push({ el: el, assembly: assembly, faces: [face1, face2], r: 0 });
      }
    });
    if (!bands.length) return;

    function measure() {
      bands.forEach(function (b) {
        b.r = b.el.offsetWidth / 2;
      });
    }
    measure();
    window.addEventListener("resize", measure);

    // ---- cube state ----------------------------------------------------
    var turns = 0;          // continuous; wrapped to [0,4) = one full 360°
    var snapTarget = null;  // integer target while settling, else null
    var snapVel = 0;        // spring velocity while settling
    var lastInputAt = 0;
    var rafId = null;
    var pageVisible = true;
    var lastNearest = -1;

    function wrap(t) {
      return ((t % 4) + 4) % 4;
    }

    function render() {
      var i = Math.floor(turns);
      var nearest = Math.round(turns);
      var nearestParity = ((nearest % 2) + 2) % 2; // 0 → state 1, 1 → state 2

      bands.forEach(function (b) {
        if (b.r === 0) return; // hidden at this breakpoint

        var current = b.faces[((i % 2) + 2) % 2];
        var next = b.faces[(((i + 1) % 2) + 2) % 2];

        if (reduceMotion) {
          // Crossfade instead of 3D — CSS supplies the opacity transition.
          b.faces[0].style.opacity = nearestParity === 0 ? "1" : "0";
          b.faces[1].style.opacity = nearestParity === 1 ? "1" : "0";
        } else {
          current.style.transform = "rotateY(" + i * 90 + "deg) translateZ(" + b.r + "px)";
          next.style.transform = "rotateY(" + (i + 1) * 90 + "deg) translateZ(" + b.r + "px)";
          b.assembly.style.transform =
            "translateZ(" + -b.r + "px) rotateY(" + (-turns * 90).toFixed(4) + "deg)";
        }

        // Only the face nearest to square is interactive / exposed to AT.
        b.faces.forEach(function (f, idx) {
          var isNearest = idx === nearestParity;
          f.style.pointerEvents = isNearest ? "auto" : "none";
          f.setAttribute("aria-hidden", isNearest ? "false" : "true");
        });
      });

      if (nearest !== lastNearest) {
        lastNearest = nearest;
        root.setAttribute("data-gc-state", nearestParity === 0 ? "1" : "2");
      }
    }

    function tick(now) {
      // Never start settling while a finger is still down — a slow,
      // deliberate drag shouldn't have the spring fighting it.
      var idle = !touchActive && now - lastInputAt > SNAP_IDLE_MS;

      if (idle) {
        if (snapTarget === null) {
          snapTarget = Math.round(turns);
          snapVel = 0;
        }
        var diff = snapTarget - turns;
        if (Math.abs(diff) < 0.0004 && Math.abs(snapVel) < 0.0004) {
          turns = wrap(snapTarget);
          snapTarget = null;
          snapVel = 0;
          render();
          rafId = null;
          return; // settled — stop the loop until next input
        }
        snapVel += diff * SPRING_ACCEL;
        snapVel *= SPRING_FRICTION;
        turns += snapVel;
      } else {
        snapTarget = null;
        snapVel = 0;
      }

      render();
      rafId = pageVisible ? requestAnimationFrame(tick) : null;
    }

    function wake() {
      if (rafId === null && pageVisible) {
        rafId = requestAnimationFrame(tick);
      }
    }

    function addInput(deltaTurns) {
      // No wrapping mid-gesture — touch commit logic compares positions
      // across the whole gesture, and a wrap seam would corrupt that.
      // wrap() runs at settle, which is the only place it's needed.
      turns += deltaTurns;
      lastInputAt = performance.now();
      snapTarget = null;
      wake();
    }

    // ---- input: wheel ---------------------------------------------------
    window.addEventListener(
      "wheel",
      function (e) {
        e.preventDefault(); // nothing on this page may actually scroll
        var unit = e.deltaMode === 1 ? 16 : 1; // lines → px approximation
        addInput((e.deltaY * unit) / (window.innerHeight * TURN_DISTANCE_FACTOR));
      },
      { passive: false }
    );

    // ---- input: touch drag + flick ---------------------------------------
    var touchActive = false;
    var touchY = null;
    var touchStartTurns = 0;
    var touchVel = 0; // smoothed, in turns/ms
    var touchLastT = 0;

    window.addEventListener(
      "touchstart",
      function (e) {
        // Gestures that start on the photo belong to the photo scene
        // (drag-dolly / tap-wobble), not the cube. touchmove bails on its
        // own because touchY stays null for the whole gesture.
        if (e.target && e.target.closest && e.target.closest("[data-gc-stage]")) return;
        touchActive = true;
        touchY = e.touches[0].clientY;
        touchStartTurns = turns;
        touchVel = 0;
        touchLastT = performance.now();
      },
      { passive: true }
    );
    window.addEventListener(
      "touchmove",
      function (e) {
        e.preventDefault();
        if (touchY === null) return;
        var y = e.touches[0].clientY;
        var now = performance.now();
        var dTurns = ((touchY - y) * TOUCH_GAIN) / window.innerHeight;
        var dt = Math.max(1, now - touchLastT);
        touchVel = touchVel * 0.8 + (dTurns / dt) * 0.2;
        touchLastT = now;
        addInput(dTurns);
        touchY = y;
      },
      { passive: false }
    );
    function endTouch() {
      if (!touchActive) return;
      touchActive = false;
      touchY = null;

      // Flick momentum: project the release velocity forward and land on
      // the nearest face to that projection...
      var target = Math.round(turns + touchVel * MOMENTUM_MS);

      // ...and commit: any deliberate swipe advances at least one face in
      // its own direction, even if the drag alone fell short of 45°.
      var startFace = Math.round(touchStartTurns);
      var disp = turns - touchStartTurns;
      if (
        target === startFace &&
        (Math.abs(disp) > COMMIT_DISP || Math.abs(touchVel) > COMMIT_VEL)
      ) {
        target = startFace + (disp !== 0 ? (disp > 0 ? 1 : -1) : touchVel > 0 ? 1 : -1);
      }

      snapTarget = target;
      // Seed the settle spring with the release velocity (per-frame) so
      // the handoff from finger to spring is seamless, not a hitch.
      snapVel = Math.max(-0.06, Math.min(0.06, touchVel * 16));
      lastInputAt = 0; // count as idle immediately — settle starts now
      wake();
    }
    window.addEventListener("touchend", endTouch);
    window.addEventListener("touchcancel", endTouch);

    // ---- input: keyboard --------------------------------------------------
    window.addEventListener("keydown", function (e) {
      var dir = 0;
      if (e.key === "ArrowDown" || e.key === "PageDown" || e.key === " ") dir = 1;
      else if (e.key === "ArrowUp" || e.key === "PageUp") dir = -1;
      if (!dir) return;
      e.preventDefault();
      // Step a whole face: snap immediately toward the adjacent station.
      snapTarget = Math.round(turns) + dir;
      lastInputAt = 0; // count as idle so the snap easing takes over now
      wake();
    });

    document.addEventListener("visibilitychange", function () {
      pageVisible = !document.hidden;
      if (pageVisible) wake();
    });

    // ---- photo scene: 3D room + floating man ------------------------------
    // Geometry: the frame (perspective P) looks into a box of depth D whose
    // back plane is the photo. The box is uniformly scaled by K = P/(P-D),
    // which makes the back plane exactly fill the frame at rest and lays
    // the side walls precisely on the view rays (invisible). Dollying the
    // room back by T reveals the walls at the geometrically correct angles;
    // full wall coverage holds while T ≤ D·P/(P-D), so T_MAX stays under it.
    //
    // Interactions:
    //   tap the man  → impulse into under-damped rotation springs (x/y/z)
    //                  plus a sink-and-bob, torqued by where he was tapped —
    //                  a saucer-sled floating on water.
    //   drag anywhere→ radial distance dollies the room back, scales the
    //                  man up and leans both with the drag direction; past
    //                  SURPRISE_AT the man pops out of the frame.
    var scene = {
      P_FACTOR: 2.6,     // perspective, × frame width
      D_FACTOR: 0.62,    // box depth, × frame width
      T_FACTOR: 0.68,    // max dolly, × frame width (< D·P/(P−D) = 0.81)
      GROW: 0.2,         // man scale gain over a full drag
      POP: 0.3,          // extra scale target while "surprised"
      SURPRISE_AT: 0.78, // drag progress that triggers the pop
      TAP_SLOP: 8,       // px of movement that turns a tap into a drag
      DRAG_RANGE: 0.5    // full drag = this × min(viewport w, h)
    };
    var K = scene.P_FACTOR / (scene.P_FACTOR - scene.D_FACTOR);

    var stage = root.querySelector("[data-gc-stage]");
    var roomEl = root.querySelector("[data-gc-room]");
    var dimEl = root.querySelector("[data-gc-dim]");
    var fgWrap = root.querySelector("[data-gc-fg-wrap]");
    var shadowEl = root.querySelector("[data-gc-shadow]");

    if (stage && roomEl && dimEl && fgWrap && !reduceMotion) {
      var frameW = 0;
      function measureScene() {
        frameW = stage.offsetWidth;
        stage.style.setProperty("--gc-p", (frameW * scene.P_FACTOR).toFixed(1) + "px");
        stage.style.setProperty("--gc-depth", (frameW * scene.D_FACTOR).toFixed(1) + "px");
        // Wall forward-extension: must cover max dolly (incl. the pop's
        // overshoot) divided by K, plus margin for the room tilt.
        stage.style.setProperty("--gc-ext", (frameW * 0.72).toFixed(1) + "px");
      }
      measureScene();
      window.addEventListener("resize", measureScene);

      // Springs: v += (target-x)·k, v ×= c, x += v — per 60fps frame,
      // dt-normalized in the loop. Low c = snappy follow; high c = the
      // slow under-damped bob that reads as water.
      function mkSpring(k, c) { return { x: 0, v: 0, t: 0, k: k, c: c }; }
      function stepSpring(s, f) {
        s.v += (s.t - s.x) * s.k * f;
        s.v *= Math.pow(s.c, f);
        s.x += s.v * f;
      }
      // The tap wobble lives mostly in pitch/yaw — the out-of-plane axes
      // that read as true depth under the perspective (tap his head and
      // the head recedes in z). Roll is kept small: in-plane spin reads
      // flat and cartoonish. Damping is firm — a couple of gentle bobs,
      // then still.
      // Low k = a heavy, slow-to-answer mass (~1.1s per bob); c near 1 =
      // a long, gentle decay instead of a snap back to rest.
      var wobX = mkSpring(0.0003, 0.973); // deg — pitch (top/bottom in z)
      var wobY = mkSpring(0.0003, 0.973); // deg — yaw (head/shoes in z)
      var wobZ = mkSpring(0.0001, 0.974); // deg — roll, subdued
      var wobD = mkSpring(0.0008, 0.968); // px  — whole-body z press-back
      var lift = mkSpring(0.004, 0.968); // px  — sink-and-rebound
      var drag = mkSpring(0.0014, 0.84);  // 0..1 dolly progress follower
      var pop  = mkSpring(0.0010, 0.91);  // extra scale, springy overshoot

      // Drag direction, smoothed so reversals don't snap the lean.
      var dirX = 0, dirY = 0, dirTX = 0, dirTY = 0;

      var surprised = false;
      var sceneRaf = null;
      var lastT = 0;

      function sceneTick(now) {
        var f = Math.min(3, Math.max(0.25, (now - lastT) / 16.67));
        lastT = now;
        var t = now / 1000;

        stepSpring(wobX, f); stepSpring(wobY, f); stepSpring(wobZ, f);
        stepSpring(wobD, f);
        stepSpring(lift, f); stepSpring(drag, f); stepSpring(pop, f);
        dirX += (dirTX - dirX) * Math.min(1, 0.12 * f);
        dirY += (dirTY - dirY) * Math.min(1, 0.12 * f);

        var p = Math.max(0, Math.min(1, drag.x));

        // Idle float: two incommensurate sines per axis so it never loops
        // visibly — the "moored in calm water" baseline. Amplitudes are
        // fractions of a degree / a couple px: felt, not seen. idleD is a
        // slow breathing in z — atmospheric, at the threshold of notice.
        var idleX = Math.sin(t * 0.72) * 0.2 + Math.sin(t * 0.43 + 1.7) * 0.12;
        var idleY = Math.sin(t * 0.34 + 0.9) * 0.22;
        var idleZ = Math.sin(t * 0.56 + 0.6) * 0.2;
        var idleLift = Math.sin(t * 0.5 + 2.1) * frameW * 0.0032;
        var idleD = Math.sin(t * 0.38 + 0.8) * frameW * 0.004;

        // --- the man ---
        var rx = wobX.x + idleX - dirY * 1.2 * p;
        var ry = wobY.x + idleY + dirX * 1.5 * p;
        var rz = wobZ.x + idleZ + dirX * 1.0 * p;
        var scale = 1 + p * scene.GROW + pop.x;
        var y = lift.x + idleLift - p * frameW * 0.02;
        var x = -p * frameW * 0.02; // drift toward frame center as he grows
        var z = wobD.x + idleD;     // ≤ 0 after a tap: pressed back, springs home
        fgWrap.style.transform =
          "translate3d(" + x.toFixed(2) + "px," + y.toFixed(2) + "px," + z.toFixed(2) + "px)" +
          " rotateX(" + rx.toFixed(3) + "deg)" +
          " rotateY(" + ry.toFixed(3) + "deg)" +
          " rotateZ(" + rz.toFixed(3) + "deg)" +
          " scale(" + scale.toFixed(4) + ")";

        // --- the room ---
        var T = p * frameW * scene.T_FACTOR + pop.x * frameW * 0.3;
        var roomRX = dirY * 1.8 * p;
        var roomRY = -dirX * 2.4 * p;
        roomEl.style.transform =
          "translateZ(" + (-T).toFixed(2) + "px)" +
          " rotateX(" + roomRX.toFixed(3) + "deg)" +
          " rotateY(" + roomRY.toFixed(3) + "deg)" +
          " scale3d(" + K + "," + K + "," + K + ")";
        dimEl.style.opacity = Math.min(0.34, p * 0.28 + pop.x * 0.25).toFixed(3);

        // --- the shadow ---
        // Darkens as he sinks (lift > 0) or is pressed back (z < 0), plus
        // a faint fast shimmer — candle-light flicker, a few percent at
        // most. Fades out as the man leaves the room during a drag, and
        // slides a touch opposite his yaw.
        if (shadowEl) {
          var sink = y - idleLift * 0.5;      // px below his rest waterline
          var flicker = Math.sin(t * 1.9 + 0.3) * 0.008 + Math.sin(t * 3.1 + 1.1) * 0.004;
          var shO = 0.045 + sink * 0.006 - z * 0.004 + flicker;
          shO = Math.max(0.008, Math.min(0.14, shO)) * (1 - p);
          var shX = -ry * frameW * 0.004;
          var shS = Math.max(0.9, Math.min(1.1, 1 - sink * 0.003 + z * 0.002));
          shadowEl.style.opacity = shO.toFixed(3);
          shadowEl.style.transform =
            "translate3d(" + shX.toFixed(2) + "px,0,0) scale(" + shS.toFixed(4) + ")";
        }

        sceneRaf = pageVisible ? requestAnimationFrame(sceneTick) : null;
      }
      function wakeScene() {
        if (sceneRaf === null && pageVisible) {
          lastT = performance.now();
          sceneRaf = requestAnimationFrame(sceneTick);
        }
      }
      document.addEventListener("visibilitychange", wakeScene);
      wakeScene();

      // Tap → wobble impulse, torqued by tap position on the man. He lies
      // horizontally, so the tapped END recedes in z via yaw (tap the hat,
      // the head eases back; tap a shoe, the feet do), vertical taps pitch
      // in z the same way, and the whole body takes a small press BACK
      // along z (wobD) — deepest at the ends — before floating home.
      function tapWobble(cx, cy) {
        var r = fgWrap.getBoundingClientRect();
        var nx = Math.max(-1, Math.min(1, ((cx - r.left) / r.width - 0.5) * 2));
        var ny = Math.max(-1, Math.min(1, ((cy - r.top) / r.height - 0.5) * 2));
        wobY.v += nx * 0.1;             // tapped end back in z
        wobX.v += -ny * 0.42;           // tapped edge back in z
        wobZ.v += nx * 0.22;            // just a whisper of roll
        wobD.v -= (1.1 + Math.abs(nx) * 0.6) * (frameW / 440);
        lift.v += 0.55 + Math.abs(ny) * 0.3; // settle into the water…
      }

      // Pointer input (mouse + touch unified). Drag distance is radial —
      // any direction works; direction only flavors the lean/tilt.
      var ptr = { id: null, x0: 0, y0: 0, t0: 0, moved: false };

      stage.addEventListener("pointerdown", function (e) {
        if (ptr.id !== null) return;
        e.preventDefault(); // no native image-drag / text-selection
        ptr.id = e.pointerId;
        ptr.x0 = e.clientX; ptr.y0 = e.clientY;
        ptr.t0 = performance.now();
        ptr.moved = false;
        try { stage.setPointerCapture(e.pointerId); } catch (err) {}
      });

      stage.addEventListener("pointermove", function (e) {
        if (e.pointerId !== ptr.id) return;
        var dx = e.clientX - ptr.x0;
        var dy = e.clientY - ptr.y0;
        var dist = Math.hypot(dx, dy);
        if (!ptr.moved && dist < scene.TAP_SLOP) return;
        ptr.moved = true;

        var range = Math.min(window.innerWidth, window.innerHeight) * scene.DRAG_RANGE;
        var raw = Math.min(1, dist / range);
        var eased = 1 - (1 - raw) * (1 - raw); // fast early response
        drag.t = eased;
        if (dist > 0) { dirTX = dx / dist; dirTY = dy / dist; }

        if (!surprised && eased >= scene.SURPRISE_AT) {
          surprised = true;
          root.classList.add("gc-surprised");
          pop.t = scene.POP;                      // he pops out of the frame
          wobY.v += (dirTX >= 0 ? 1 : -1) * 0.32; // with a little depth kick
          lift.v -= 1.0;
        } else if (surprised && eased < scene.SURPRISE_AT * 0.55) {
          surprised = false;
          root.classList.remove("gc-surprised");
          pop.t = 0;
        }
      });

      function endPointer(e) {
        if (e.pointerId !== ptr.id) return;
        ptr.id = null;
        if (!ptr.moved && performance.now() - ptr.t0 < 500) {
          tapWobble(e.clientX, e.clientY);
        }
        // Everything glides home on release.
        drag.t = 0;
        pop.t = 0;
        if (surprised) {
          surprised = false;
          root.classList.remove("gc-surprised");
        }
      }
      stage.addEventListener("pointerup", endPointer);
      stage.addEventListener("pointercancel", endPointer);
    }

    // ---- first paint ---------------------------------------------------
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
