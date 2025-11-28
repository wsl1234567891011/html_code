import React, { useEffect, useRef, useState, Suspense } from 'react';
import Webcam from 'react-webcam';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { HandLandmarker, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision';
import { Activity, Globe, Cpu } from 'lucide-react';

// --- 配置与常量 ---
const THEME_COLOR = '#00FFFF';
const EARTH_TEXTURE_URL = 'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg'; 
const CONTINENTS = [
  { name: "AFRICA (非洲)", rad: [0, 1.2] },
  { name: "ASIA (亚洲)", rad: [1.2, 2.5] },
  { name: "PACIFIC (太平洋)", rad: [2.5, 4.0] },
  { name: "AMERICAS (美洲)", rad: [4.0, 5.5] },
  { name: "EUROPE (欧洲)", rad: [5.5, 6.28] }
];

// --- 辅助函数 ---
const lerp = (start: number, end: number, t: number) => start * (1 - t) + end * t;
const getDistance = (p1: { x: number, y: number }, p2: { x: number, y: number }) => {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
};

// --- Hook: 语音控制模块 (完整修正版) ---
const useJarvisVoice = (
  earthRotation: React.MutableRefObject<{ x: number; y: number }>,
  setHandStatus: (status: string) => void
) => {
  const [isListening, setIsListening] = useState(false);
  const lastCmdTimeRef = useRef(0); // 记录最后指令时间

  useEffect(() => {
    // @ts-ignore
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.lang = 'zh-CN'; 
    recognition.interimResults = true;

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => { 
        setIsListening(false); 
        setTimeout(() => { try { recognition.start(); } catch(e) {} }, 1000); 
    };

    recognition.onresult = (event: any) => {
      const lastResult = event.results[event.results.length - 1];
      const text = lastResult[0].transcript.trim().toLowerCase();
      
      setHandStatus(`CMD: "${text}"`);

      let matched = false;
      if (text.includes('africa') || text.includes('非洲')) {
        earthRotation.current = { x: 0, y: 0.5 }; matched = true;
      } 
      else if (text.includes('asia') || text.includes('china') || text.includes('亚洲') || text.includes('中国')) {
        earthRotation.current = { x: 0.2, y: 2.0 }; matched = true;
      } 
      else if (text.includes('america') || text.includes('usa') || text.includes('美洲') || text.includes('美国')) {
        earthRotation.current = { x: 0, y: 4.8 }; matched = true;
      } 
      else if (text.includes('europe') || text.includes('欧洲')) {
        earthRotation.current = { x: 0.3, y: 5.8 }; matched = true;
      } 
      else if (text.includes('reset') || text.includes('stop') || text.includes('重置')) {
        earthRotation.current = { x: 0, y: 0 }; matched = true;
      }

      if (matched) {
         lastCmdTimeRef.current = Date.now(); // 更新时间戳
      }
    };

    try { recognition.start(); } catch (e) { console.error(e); }
    return () => recognition.stop();
  }, []);

  return { isListening, lastCmdTimeRef };
};

// --- 组件: 全息地球 ---
const HolographicEarth = ({ rotationRef, scaleRef, setContinent }: any) => {
  const earthRef = useRef<THREE.Group>(null);
  const texture = useLoader(THREE.TextureLoader, EARTH_TEXTURE_URL);

  useFrame(() => {
    if (earthRef.current) {
      // 使用 Lerp 平滑过渡，这样语音指令切换时会慢慢转过去
      earthRef.current.rotation.y = lerp(earthRef.current.rotation.y, rotationRef.current.y, 0.05);
      earthRef.current.rotation.x = lerp(earthRef.current.rotation.x, rotationRef.current.x, 0.05);
      const newScale = lerp(earthRef.current.scale.x, scaleRef.current, 0.1);
      earthRef.current.scale.set(newScale, newScale, newScale);

      const normalizedRot = (earthRef.current.rotation.y % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
      const adjustedRot = (Math.PI * 2) - normalizedRot; 
      const active = CONTINENTS.find(c => adjustedRot >= c.rad[0] && adjustedRot < c.rad[1]);
      if (active) setContinent(active.name);
    }
  });

  return (
    <group ref={earthRef} position={[-1.2, 0, 0]}>
      <mesh>
        <sphereGeometry args={[1, 64, 64]} />
        <meshStandardMaterial map={texture} transparent opacity={0.8} blending={THREE.AdditiveBlending} color={THEME_COLOR} emissive={THEME_COLOR} emissiveIntensity={0.2} />
      </mesh>
      <mesh>
        <sphereGeometry args={[1.05, 32, 32]} />
        <meshBasicMaterial color={THEME_COLOR} wireframe transparent opacity={0.15} />
      </mesh>
    </group>
  );
};

// --- 主应用 ---
export default function JarvisHUD() {
  const webcamRef = useRef<Webcam>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [handStatus, setHandStatus] = useState("INIT VISION...");
  const [activeContinent, setActiveContinent] = useState("SCANNING...");
  const [panelUI, setPanelUI] = useState({ x: window.innerWidth - 320, y: 100 });
  
  const earthRotation = useRef({ x: 0, y: 0 });
  const earthScale = useRef(1);

  // 1. 调用 Hook 并获取 lastCmdTimeRef
  const { isListening: voiceActive, lastCmdTimeRef } = useJarvisVoice(earthRotation, setHandStatus);

  useEffect(() => {
    let vision: HandLandmarker;
    const setupVision = async () => {
      const filesetResolver = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.0/wasm");
      vision = await HandLandmarker.createFromOptions(filesetResolver, {
        baseOptions: { modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`, delegate: "GPU" },
        runningMode: "VIDEO", numHands: 2
      });
      setLoading(false);
      setHandStatus("VISION ONLINE");
      detectLoop();
    };

    const detectLoop = () => {
      if (webcamRef.current?.video && vision && canvasRef.current) {
        const video = webcamRef.current.video;
        if (video.videoWidth > 0) {
          const results = vision.detectForVideo(video, performance.now());
          const ctx = canvasRef.current.getContext('2d');
          if (ctx) {
            canvasRef.current.width = video.videoWidth;
            canvasRef.current.height = video.videoHeight;
            ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
            const drawingUtils = new DrawingUtils(ctx);
            
            if (results.landmarks.length > 0) {
              // setHandStatus(`TARGETS: ${results.landmarks.length}`); // 这一行先注释掉，避免覆盖语音字幕
              
              results.landmarks.forEach((landmarks) => {
                ctx.shadowBlur = 10; ctx.shadowColor = THEME_COLOR;
                drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, { color: THEME_COLOR, lineWidth: 2 });
                drawingUtils.drawLandmarks(landmarks, { color: '#FFFFFF', lineWidth: 1, radius: 2 });

                const wrist = landmarks[0];
                const thumbTip = landmarks[4];
                const indexTip = landmarks[8];
                const midX = landmarks[9].x; const midY = landmarks[9].y;

                // 2. 检查是否处于“语音控制优先期” (3000ms)
                const isVoiceControlling = Date.now() - lastCmdTimeRef.current < 3000;

                // 左手逻辑 (屏幕左侧，通常是镜像后的右手)
                if (wrist.x > 0.5) { 
                   // 只有当语音没在控制时，手势才生效
                   if (!isVoiceControlling) {
                       earthRotation.current.y = (midX - 0.5) * 8; 
                       earthRotation.current.x = (midY - 0.5) * 4;
                       const pinch = getDistance(thumbTip, indexTip);
                       earthScale.current = Math.max(0.5, Math.min(2.5, pinch * 8));
                   }
                } 
                // 右手逻辑 (屏幕右侧) - 始终允许拖拽面板
                else { 
                    if (getDistance(thumbTip, indexTip) < 0.05) {
                        // 注意：这里需要反转 X 坐标以匹配镜像
                        setPanelUI({ x: (1 - indexTip.x) * window.innerWidth, y: indexTip.y * window.innerHeight });
                    }
                }
              });
            }
          }
        }
      }
      requestAnimationFrame(detectLoop);
    };
    setupVision();
  }, []);

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden select-none">
      <Webcam ref={webcamRef} mirrored className="absolute inset-0 w-full h-full object-cover opacity-50 contrast-125 brightness-75 grayscale-[50%]" />
      <div className="absolute inset-0 bg-grid-pattern opacity-30 pointer-events-none"></div>

      <div className="absolute inset-0 z-10 pointer-events-none">
        <Canvas camera={{ position: [0, 0, 5], fov: 45 }}>
            <ambientLight intensity={0.5} />
            <pointLight position={[10, 10, 10]} intensity={1.5} color={THEME_COLOR} />
            <Suspense fallback={null}>
                <HolographicEarth rotationRef={earthRotation} scaleRef={earthScale} setContinent={setActiveContinent} />
            </Suspense>
        </Canvas>
      </div>

      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full z-20 pointer-events-none flip-horizontal" style={{ transform: 'scaleX(-1)' }} />

      <div className="absolute inset-0 z-30 pointer-events-none p-8 text-cyan-400">
        <div className="absolute top-8 left-8">
            <div className="flex items-center gap-2 border-b border-cyan-400 pb-2 mb-2 w-64">
                <Activity className="w-5 h-5 animate-pulse" />
                <span className="font-bold tracking-widest">SYSTEM_READY</span>
            </div>
            {/* 显示当前指令或状态 */}
            <div className="text-xs opacity-80 min-h-[20px]">{handStatus}</div>
            <div className="flex items-center gap-2 mt-2 text-xs">
                 <div className={`w-2 h-2 rounded-full ${voiceActive ? 'bg-red-500 animate-pulse' : 'bg-gray-500'}`}></div>
                 <span>VOICE: {voiceActive ? 'ON' : 'OFF'}</span>
            </div>
        </div>

        <div className="absolute top-8 right-8 text-right">
            <h1 className="text-6xl font-black tracking-tighter drop-shadow-[0_0_10px_rgba(0,255,255,0.8)]">JARVIS</h1>
            <div className="text-xl tracking-[0.5em] mt-2">{new Date().toLocaleTimeString()}</div>
        </div>

        <div className="absolute border border-cyan-400 bg-black/80 backdrop-blur-sm p-4 w-64 transition-transform duration-75 shadow-[0_0_20px_rgba(0,255,255,0.2)]"
             style={{ transform: `translate(${panelUI.x}px, ${panelUI.y}px)`, left: 0, top: 0 }}>
            <div className="flex justify-between border-b border-cyan-400/50 pb-2 mb-2">
                <span className="flex items-center gap-2 font-bold"><Globe size={16}/> SECTOR</span>
                <span className="text-xs px-1 border border-cyan-400">LIVE</span>
            </div>
            <div className="text-2xl font-bold text-white drop-shadow-md">{activeContinent}</div>
            {/* 新增一个小提示 */}
            <div className="text-[10px] text-gray-400 mt-2">PINCH TO MOVE</div>
        </div>

        {loading && (
            <div className="absolute inset-0 bg-black flex flex-col items-center justify-center z-50">
                <Cpu className="w-16 h-16 animate-spin mb-4" />
                <div className="text-2xl font-bold tracking-widest animate-pulse">BOOTING...</div>
            </div>
        )}
      </div>
    </div>
  );
}