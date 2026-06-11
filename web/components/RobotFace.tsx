"use client";

import { useState, useEffect, useRef } from "react";
import "./RobotFace.css";

export type RobotState = "neutral" | "listening" | "thinking" | "talking";

type Props = {
  state?: RobotState;
  theme?: "base" | "colored";
  isBooting?: boolean;
};

export default function RobotFace({ state = "neutral", theme = "base", isBooting = false }: Props) {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [idleState, setIdleState] = useState(""); // '', 'blink', 'look-left', 'look-right', 'hum', 'pong'
  const [isDizzy, setIsDizzy] = useState(false);
  const headRef = useRef<HTMLDivElement>(null);
  const lastActiveTime = useRef(Date.now());

  useEffect(() => {
    lastActiveTime.current = Date.now();
  }, [state]);

  // Mouse-tracking parallax
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      lastActiveTime.current = Date.now();
      if (state !== "neutral" && state !== "listening") {
        setMousePos({ x: 0, y: 0 });
        return;
      }
      if (!headRef.current) return;
      const rect = headRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const x = (e.clientX - centerX) / window.innerWidth;
      const y = (e.clientY - centerY) / window.innerHeight;
      setMousePos({ x, y });
    };
    window.addEventListener("mousemove", handleMouseMove);
    return () => window.removeEventListener("mousemove", handleMouseMove);
  }, [state]);

  // Idle engine (life-like random actions + Pong easter egg)
  useEffect(() => {
    if (state !== "neutral") {
      setIdleState("");
      return;
    }
    let timeoutId: ReturnType<typeof setTimeout>;
    const triggerRandomAction = () => {
      const timeSinceActive = Date.now() - lastActiveTime.current;
      if (timeSinceActive > 10000) {
        setIdleState("pong");
        setTimeout(() => {
          setIdleState("");
          lastActiveTime.current = Date.now();
        }, 5000);
        timeoutId = setTimeout(triggerRandomAction, 7000);
        return;
      }
      const randomWeight = Math.random();
      let chosenAction = "";
      if (randomWeight > 0.9) chosenAction = "hum";
      else if (randomWeight > 0.8) chosenAction = "look-left";
      else if (randomWeight > 0.7) chosenAction = "look-right";
      else if (randomWeight > 0.3) chosenAction = "blink";
      else chosenAction = "";
      setIdleState(chosenAction);
      setTimeout(() => setIdleState(""), chosenAction === "blink" ? 200 : 1500);
      timeoutId = setTimeout(triggerRandomAction, 2000 + Math.random() * 4000);
    };
    timeoutId = setTimeout(triggerRandomAction, 2000);
    return () => clearTimeout(timeoutId);
  }, [state]);

  const MAX_ROTATION_X = 15;
  const MAX_ROTATION_Y = 25;
  const headTransform = `rotateX(${mousePos.y * -MAX_ROTATION_X}deg) rotateY(${mousePos.x * MAX_ROTATION_Y}deg)`;
  const eyeTransform = `translate(${mousePos.x * 12}px, ${mousePos.y * 12}px)`;

  const handleFaceClick = () => {
    if (isBooting) return;
    setIsDizzy(true);
    setTimeout(() => setIsDizzy(false), 1500);
  };

  const currentVisualState = isDizzy ? "glitch" : state;
  const trackable = currentVisualState === "neutral" || currentVisualState === "listening";

  return (
    <div
      className={`robot-face-container ${currentVisualState} ${!isDizzy ? idleState : ""} theme-${theme}`}
      onClick={handleFaceClick}
    >
      <div
        className={`robot-head ${isDizzy ? "shake-head" : ""}`}
        ref={headRef}
        style={{ transform: trackable ? headTransform : "" }}
      >
        <div className="eyes-container">
          <div className="eye left-eye" style={{ transform: eyeTransform }}></div>
          <div className="eye right-eye" style={{ transform: eyeTransform }}></div>
        </div>
        <div className="mouth-container" style={{ transform: eyeTransform }}>
          <div className="mouth"></div>
        </div>
      </div>
    </div>
  );
}
