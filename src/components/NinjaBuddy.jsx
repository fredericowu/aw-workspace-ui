import { useRef, useEffect, useState, useCallback } from 'react';

/**
 * Tiny pixel ninja mascot that patrols back and forth.
 * Flees from the mouse — prefers going backwards to avoid the cursor,
 * but will sprint through it if cornered against a wall.
 * Throws shuriken stars toward the mouse when it gets close!
 *
 * Notification balloons used to render here too — that logic moved to
 * <TopNotifications/> which subscribes to the same /ws/notifications
 * feed and renders in the top-right corner, matching the Claude prompt
 * notification style.
 */
export default function NinjaBuddy({ width = 40, height = 16, offset = 0 }) {
  const containerRef = useRef(null);
  const stateRef = useRef({
    pos: 0,           // current X
    vel: 0.3,         // current velocity
    facing: 1,        // 1=right, -1=left
    fleeing: false,
    mouseX: -999,     // mouse X relative to container
    mouseY: -999,
  });
  const frameRef = useRef(null);
  const [style, setStyle] = useState({ left: 0, transform: 'scaleX(1)', top: 1 });
  const jumpTimeoutRef = useRef(null);
  const [jumping, setJumping] = useState(false);
  const [stars, setStars] = useState([]); // { id, x, y, dx, dy }
  const starIdRef = useRef(0);
  const lastThrowRef = useRef(0);

  const NINJA_W = 12;
  const FLEE_DIST = 35;
  const SAFE_DIST = 60;
  const THROW_DIST = 50;    // throw stars when mouse is within this range
  const THROW_COOLDOWN = 600; // ms between throws
  const FLEE_SPEED = 2.5;
  const SPRINT_SPEED = 4;
  const PATROL_SPEED = 0.3;

  // Throw a star toward the mouse
  const throwStar = useCallback((ninjaX, mouseX, mouseY) => {
    const now = Date.now();
    if (now - lastThrowRef.current < THROW_COOLDOWN) return;
    lastThrowRef.current = now;

    const dx = mouseX - ninjaX;
    const dy = mouseY;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const speed = 3;
    const id = ++starIdRef.current;

    setStars((prev) => [
      ...prev.slice(-4), // keep max 5 stars
      {
        id,
        x: ninjaX + NINJA_W / 2,
        y: height / 2 - 2,
        dx: (dx / dist) * speed,
        dy: (dy / dist) * speed,
        born: now,
      },
    ]);
  }, [height]);

  useEffect(() => {
    const animate = () => {
      const s = stateRef.current;

      const maxX = width - NINJA_W;
      const ninjaCenterX = s.pos + NINJA_W / 2;
      const dx = s.mouseX - ninjaCenterX;
      const distToMouse = Math.sqrt(dx * dx + s.mouseY * s.mouseY);

      if (distToMouse < FLEE_DIST) {
        s.fleeing = true;

        const spaceLeft = s.pos;
        const spaceRight = maxX - s.pos;
        const awayDir = dx > 0 ? -1 : 1;
        const spaceInAwayDir = awayDir > 0 ? spaceRight : spaceLeft;

        if (spaceInAwayDir > 4) {
          s.facing = awayDir;
          s.vel = awayDir * FLEE_SPEED;
        } else {
          const throughDir = -awayDir;
          s.facing = throughDir;
          s.vel = throughDir * SPRINT_SPEED;
          if (!jumping) {
            setJumping(true);
            clearTimeout(jumpTimeoutRef.current);
            jumpTimeoutRef.current = setTimeout(() => setJumping(false), 250);
          }
        }

        // Throw star at the mouse!
        throwStar(s.pos, s.mouseX, s.mouseY);
      } else if (distToMouse < THROW_DIST) {
        // Not fleeing yet but close enough — throw a star
        s.facing = dx > 0 ? 1 : -1;
        throwStar(s.pos, s.mouseX, s.mouseY);
      } else if (s.fleeing && distToMouse > SAFE_DIST) {
        s.fleeing = false;
        s.vel = s.facing * PATROL_SPEED;
      }

      if (s.fleeing) {
        s.pos += s.vel;
        if (Math.abs(s.vel) > PATROL_SPEED) {
          s.vel *= 0.97;
        }
      } else {
        s.pos += s.vel;
        if (s.pos >= maxX) { s.vel = -PATROL_SPEED; s.facing = -1; }
        if (s.pos <= 0)    { s.vel = PATROL_SPEED;  s.facing = 1; }
      }

      if (s.pos > maxX) { s.pos = maxX; s.vel = -PATROL_SPEED; s.facing = -1; s.fleeing = false; }
      if (s.pos < 0)    { s.pos = 0;    s.vel = PATROL_SPEED;  s.facing = 1;  s.fleeing = false; }

      setStyle({
        left: s.pos,
        transform: `scaleX(${s.facing})`,
        top: jumping ? -3 : 1,
      });

      // Animate stars
      setStars((prev) => {
        const now = Date.now();
        return prev
          .map((star) => ({
            ...star,
            x: star.x + star.dx,
            y: star.y + star.dy,
          }))
          .filter((star) => now - star.born < 800 && star.x > -10 && star.x < width + 10);
      });

      frameRef.current = requestAnimationFrame(animate);
    };

    frameRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frameRef.current);
  }, [width, jumping, throwStar]);

  // Track mouse position relative to the container
  useEffect(() => {
    const handleMouse = (e) => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      stateRef.current.mouseX = e.clientX - rect.left;
      stateRef.current.mouseY = e.clientY - (rect.top + height / 2);
    };
    document.addEventListener('mousemove', handleMouse);
    return () => document.removeEventListener('mousemove', handleMouse);
  }, [height]);

  return (
    <div
      ref={containerRef}
      className="relative"
      style={{ width, height, marginLeft: offset, overflow: 'hidden' }}
    >
      {/* Ninja sprite */}
      <div
        className="ninja-buddy"
        style={{
          position: 'absolute',
          top: style.top,
          left: style.left,
          transform: style.transform,
          transition: 'top 0.15s ease-out',
        }}
      />
      {/* Shuriken stars */}
      {stars.map((star) => (
        <div
          key={star.id}
          style={{
            position: 'absolute',
            left: star.x,
            top: star.y,
            fontSize: 7,
            color: '#fbbf24',
            pointerEvents: 'none',
            animation: 'ninja-star-spin 0.3s linear infinite',
          }}
        >
          ✦
        </div>
      ))}
    </div>
  );
}
