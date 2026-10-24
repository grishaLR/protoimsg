import { useEffect, useRef } from 'react';
import styles from './TownJoystick.module.css';

// Inside this much of the throw, the stick reads as centred.
const DEAD = 0.12;

interface TownJoystickProps {
  /** -1..1 each way (x right, y up); 0, 0 when let go. */
  onMove: (x: number, y: number) => void;
}

/**
 * An on-screen thumbstick for touch screens: drag the knob to walk, let go
 * to stop. Pointer capture keeps it tracking one finger while another taps
 * the world. Decorative to assistive tech, which has the arrow keys.
 */
export function TownJoystick({ onMove }: TownJoystickProps) {
  const baseRef = useRef<HTMLDivElement>(null);
  const knobRef = useRef<HTMLDivElement>(null);
  const onMoveRef = useRef(onMove);
  onMoveRef.current = onMove;

  useEffect(() => {
    const base = baseRef.current;
    const knob = knobRef.current;
    if (!base || !knob) return;
    let active: number | null = null;
    let cx = 0;
    let cy = 0;
    let radius = 1;

    const move = (clientX: number, clientY: number): void => {
      let dx = clientX - cx;
      let dy = clientY - cy;
      const d = Math.hypot(dx, dy);
      if (d > radius) {
        dx = (dx / d) * radius;
        dy = (dy / d) * radius;
      }
      knob.style.transform = `translate(${String(dx)}px, ${String(dy)}px)`;
      let x = dx / radius;
      let y = -dy / radius;
      const mag = Math.hypot(x, y);
      if (mag < DEAD) {
        x = 0;
        y = 0;
      } else {
        // Rescale so walking starts smoothly just past the dead zone.
        const k = (mag - DEAD) / (1 - DEAD) / mag;
        x *= k;
        y *= k;
      }
      onMoveRef.current(x, y);
    };

    const release = (): void => {
      active = null;
      base.classList.remove(styles.active ?? '');
      knob.style.transform = '';
      onMoveRef.current(0, 0);
    };

    const onDown = (e: PointerEvent): void => {
      if (active !== null) return;
      active = e.pointerId;
      base.setPointerCapture(e.pointerId);
      const r = base.getBoundingClientRect();
      cx = r.left + r.width / 2;
      cy = r.top + r.height / 2;
      radius = r.width / 2 - knob.offsetWidth / 4;
      base.classList.add(styles.active ?? '');
      move(e.clientX, e.clientY);
      e.preventDefault();
    };
    const onPointerMove = (e: PointerEvent): void => {
      if (e.pointerId === active) move(e.clientX, e.clientY);
    };
    const onUp = (e: PointerEvent): void => {
      if (e.pointerId === active) release();
    };
    const onBlur = (): void => {
      if (active !== null) release();
    };

    base.addEventListener('pointerdown', onDown);
    base.addEventListener('pointermove', onPointerMove);
    base.addEventListener('pointerup', onUp);
    base.addEventListener('pointercancel', onUp);
    window.addEventListener('blur', onBlur);
    return () => {
      base.removeEventListener('pointerdown', onDown);
      base.removeEventListener('pointermove', onPointerMove);
      base.removeEventListener('pointerup', onUp);
      base.removeEventListener('pointercancel', onUp);
      window.removeEventListener('blur', onBlur);
      onMoveRef.current(0, 0);
    };
  }, []);

  return (
    <div ref={baseRef} className={styles.joystick} aria-hidden="true">
      <div ref={knobRef} className={styles.knob} />
    </div>
  );
}
