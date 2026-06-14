import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type TooltipBadgeProps = {
  /** Sichtbares Zeichen im Badge, z. B. "?" oder "!". */
  mark: string;
  /** Tooltip-Inhalt (mehrzeilig erlaubt). */
  tooltip: string;
  ariaLabel: string;
  /** Bestehende Badge-Klasse (`aurora-reasoning-badge` | `info-badge`). */
  className: string;
};

type BubblePosition = { left: number; top: number };

/**
 * Badge mit App-eigenem Tooltip. Die Bubble wird per Portal an `document.body`
 * gerendert und `position: fixed` platziert — so kann sie NICHT vom
 * `overflow`-Container (z. B. dem scrollbaren AURORA-Stream) abgeschnitten
 * werden. Die Position wird aus dem Badge-Rechteck berechnet und horizontal
 * im Viewport gehalten.
 */
export function TooltipBadge({ mark, tooltip, ariaLabel, className }: TooltipBadgeProps) {
  const badgeRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [position, setPosition] = useState<BubblePosition | null>(null);

  function show() {
    const el = badgeRef.current;
    if (el) {
      setAnchor(el.getBoundingClientRect());
    }
  }

  function hide() {
    setAnchor(null);
    setPosition(null);
  }

  // Erst nach dem Messen der echten Bubble-Breite endgültig positionieren.
  // Die Bubble öffnet zur Bildschirmmitte hin: ein Badge in der rechten
  // Viewport-Hälfte klappt nach links auf (rechte Kante am Badge), ein Badge
  // links nach rechts (linke Kante am Badge). So läuft sie an keinem Rand heraus.
  useLayoutEffect(() => {
    if (!anchor || !bubbleRef.current) {
      return;
    }
    const bubble = bubbleRef.current.getBoundingClientRect();
    const margin = 8;
    const badgeCenter = anchor.left + anchor.width / 2;
    const openLeft = badgeCenter > window.innerWidth / 2;
    const rawLeft = openLeft ? anchor.right - bubble.width : anchor.left;
    const left = Math.min(Math.max(margin, rawLeft), window.innerWidth - margin - bubble.width);
    const top = anchor.top - bubble.height - 8;
    setPosition({ left, top: Math.max(margin, top) });
  }, [anchor]);

  return (
    <span
      ref={badgeRef}
      className={className}
      role="img"
      aria-label={ariaLabel}
      tabIndex={0}
      data-tooltip={tooltip}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {mark}
      {anchor
        ? createPortal(
            <span
              ref={bubbleRef}
              className="tooltip-bubble"
              role="tooltip"
              style={{
                left: position?.left ?? anchor.left,
                top: position?.top ?? anchor.top,
                // Bis zur Messung unsichtbar, um ein Springen zu vermeiden.
                visibility: position ? "visible" : "hidden",
              }}
            >
              {tooltip}
            </span>,
            document.body
          )
        : null}
    </span>
  );
}
